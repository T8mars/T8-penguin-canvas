import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, House, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const COTTAGE_URL = 'https://api.seedance.nz/?s=ibVH';

export default function ZhenzhenCottagePromotion({ isPixel, isDark }: { isPixel: boolean; isDark: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const placePanel = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 80)),
      });
    };
    const onOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    placePanel();
    linkRef.current?.focus();
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={t('shell:promotions.cottage.title')}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={isPixel ? 'px-btn px-btn--sm px-btn--mint' : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
          isDark ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20' : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
        }`}
      >
        <House size={14} aria-hidden="true" />
        <span className="text-[11px]">{t('shell:promotions.cottage.label')}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={`${panelId}-heading`}
          className={`fixed z-[60] w-[360px] max-w-[calc(100vw-16px)] overflow-y-auto p-4 shadow-2xl ${isPixel ? 'px-panel rounded-2xl' : `rounded-xl border ${isDark ? 'bg-zinc-900 border-emerald-400/30 text-zinc-100' : 'bg-white border-emerald-200 text-zinc-800'}`}`}
          style={{ left: position.left, top: position.top, maxHeight: `calc(100dvh - ${position.top + 8}px)` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id={`${panelId}-heading`} className="text-sm font-bold">{t('shell:promotionDetails.cottage.heading')}</h2>
            <button type="button" aria-label={t('common:actions.close')} className="rounded p-1 hover:opacity-70" onClick={() => { setOpen(false); buttonRef.current?.focus(); }}><X size={16} /></button>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed">{t('shell:promotionDetails.cottage.description')}</p>
          <a
            ref={linkRef}
            href={COTTAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={isPixel ? 'mt-4 px-btn px-btn--mint w-full justify-center' : 'mt-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700'}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {t('shell:promotionDetails.cottage.open')}
          </a>
        </div>,
        document.body,
      )}
    </>
  );
}
