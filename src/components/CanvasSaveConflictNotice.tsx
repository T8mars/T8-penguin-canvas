import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export function CanvasSaveConflictNotice(props: {
  onExport: () => void;
  onRetry: () => Promise<void>;
  onResolve: (resolution: 'keep-local' | 'use-authoritative') => Promise<void>;
}) {
  const { t } = useTranslation('canvasSave');
  const [choice, setChoice] = useState<'keep-local' | 'use-authoritative' | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const flight = useRef(false);
  const run = async (work: () => Promise<void>, retry = false) => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setFeedback('');
    try { await work(); setChoice(null); if (retry) setFeedback(t('retryHint')); }
    catch { setFeedback(t('failed')); }
    finally { flight.current = false; setBusy(false); }
  };
  const button = 'nodrag nowheel rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-xs disabled:opacity-50';
  return createPortal(<section data-canvas-save-conflict="true" role="alert" aria-label={t('title')}
    className="fixed left-1/2 top-20 z-[10000] max-h-[70vh] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-auto rounded-xl border border-amber-500 bg-[var(--bg-secondary)] p-3 text-[var(--text-primary)] shadow-xl"
    onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <h2 className="font-bold text-amber-600">{t('title')}</h2>
    <p className="my-2 text-xs leading-5">{t('detail')}</p>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => void run(props.onRetry, true)}>{busy ? t('working') : t('retry')}</button>
      <button className={button} disabled={busy} onClick={props.onExport}>{t('export')}</button>
      <button className={button} disabled={busy} onClick={() => { setChoice('keep-local'); setFeedback(''); }}>{t('local')}</button>
      <button className={button} disabled={busy} onClick={() => { setChoice('use-authoritative'); setFeedback(''); }}>{t('server')}</button>
    </div>
    {choice && <div className="mt-3 rounded border border-amber-500 p-2" role="group" aria-label={t('confirm')}>
      <p className="mb-2 text-xs leading-5">{t(choice === 'keep-local' ? 'localConfirm' : 'serverConfirm')}</p>
      <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => { const resolution = choice; void run(() => props.onResolve(resolution)); }}>{t('confirm')}</button>
        <button className={button} disabled={busy} onClick={() => setChoice(null)}>{t('cancel')}</button></div>
    </div>}
    {feedback && <p role="status" className="mt-2 text-xs">{feedback}</p>}
  </section>, document.body);
}
