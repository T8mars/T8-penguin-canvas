import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import freeOnlineInfiniteCanvasPoster from '../assets/startup-posters/free-online-infinite-canvas.png';
import {
  advanceStartupPosterIndex,
  buildStartupPosterAppVersion,
  evaluateStartupPosterVisibility,
  openStartupPosterExternalTarget,
  persistStartupPosterDismissal,
  preloadStartupPosterImages,
  resolveStartupPosterAppVersion,
  startupPosterStackPosition,
  waitForStartupPosterCanvasSurface,
  type StartupPosterStorage,
} from '../utils/startupPoster';
import './StartupPosterCarousel.css';

export interface StartupPosterItem {
  id: string;
  imageUrl: string;
  targetUrl: string;
  altKey: string;
}

export const STARTUP_POSTER_CAMPAIGN_ID = 'free-online-canvas-2026-09';
export const STARTUP_POSTERS: readonly StartupPosterItem[] = [
  {
    id: 'free-online-infinite-canvas',
    imageUrl: freeOnlineInfiniteCanvasPoster,
    targetUrl: 'https://api.seedance.nz/canvas',
    altKey: 'startupPoster.posterAlt',
  },
];

interface StartupPosterCarouselProps {
  ready: boolean;
  expectedNodeCount?: number;
  posters?: readonly StartupPosterItem[];
  campaignId?: string;
}

interface PointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

let dismissedInCurrentRenderer = false;

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): StartupPosterStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window[kind];
  } catch {
    return null;
  }
}

function focusableElements(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute('aria-hidden') !== 'true');
}

export default function StartupPosterCarousel({
  ready,
  expectedNodeCount = 0,
  posters = STARTUP_POSTERS,
  campaignId = STARTUP_POSTER_CAMPAIGN_ID,
}: StartupPosterCarouselProps) {
  const { t } = useTranslation('canvas');
  const titleId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const suppressClickRef = useRef(false);
  const wheelAccumulatorRef = useRef(0);
  const wheelResetTimerRef = useRef<number | null>(null);
  const wheelCooldownUntilRef = useRef(0);
  const dismissRef = useRef<() => void>(() => {});
  const moveRef = useRef<(delta: number) => void>(() => {});
  const [appVersion, setAppVersion] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suppressForSevenDays, setSuppressForSevenDays] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [openingTarget, setOpeningTarget] = useState(false);
  const [openError, setOpenError] = useState('');
  const [canvasSettleMs, setCanvasSettleMs] = useState(0);

  const posterCount = posters.length;
  const multiple = posterCount > 1;
  const activePoster = posters[Math.min(activeIndex, Math.max(0, posterCount - 1))] || null;

  useEffect(() => {
    if (!ready || posterCount === 0 || dismissedInCurrentRenderer || typeof window === 'undefined') {
      setOpen(false);
      return undefined;
    }
    const abortController = new AbortController();
    setOpen(false);
    setCanvasSettleMs(0);
    void (async () => {
      const version = await resolveStartupPosterAppVersion({
        buildVersion: buildStartupPosterAppVersion(),
        getRuntimeInfo: typeof window.t8pc?.getInfo === 'function'
          ? () => window.t8pc!.getInfo()
          : null,
      });
      if (abortController.signal.aborted) return;
      const decision = evaluateStartupPosterVisibility({
        appVersion: version,
        campaignId,
        now: Date.now(),
        persistentStorage: getBrowserStorage('localStorage'),
        sessionStorage: getBrowserStorage('sessionStorage'),
      });
      setAppVersion(version);
      if (!decision.visible) return;

      const [surface, posterAssetsReady] = await Promise.all([
        waitForStartupPosterCanvasSurface({
          expectedNodeCount,
          signal: abortController.signal,
        }),
        preloadStartupPosterImages(
          posters.map((poster) => poster.imageUrl),
          abortController.signal,
        ),
      ]);
      if (abortController.signal.aborted || !surface.ready || !posterAssetsReady) return;

      // Re-check after the readiness wait in case another window set the preference.
      const finalDecision = evaluateStartupPosterVisibility({
        appVersion: version,
        campaignId,
        now: Date.now(),
        persistentStorage: getBrowserStorage('localStorage'),
        sessionStorage: getBrowserStorage('sessionStorage'),
      });
      if (!finalDecision.visible) return;
      setCanvasSettleMs(surface.waitedMs);
      setOpen(true);
    })();
    return () => {
      abortController.abort();
    };
  }, [campaignId, expectedNodeCount, posterCount, posters, ready]);

  useEffect(() => {
    setActiveIndex((current) => posterCount > 0 ? Math.min(current, posterCount - 1) : 0);
  }, [posterCount]);

  const move = useCallback((delta: number) => {
    if (posterCount <= 1) return;
    setActiveIndex((current) => advanceStartupPosterIndex(current, delta, posterCount));
    setDragOffset(0);
    setOpenError('');
  }, [posterCount]);
  moveRef.current = move;

  const dismiss = useCallback(() => {
    if (!appVersion) return;
    persistStartupPosterDismissal({
      appVersion,
      campaignId,
      now: Date.now(),
      suppressForSevenDays,
      persistentStorage: getBrowserStorage('localStorage'),
      sessionStorage: getBrowserStorage('sessionStorage'),
    });
    dismissedInCurrentRenderer = true;
    setOpen(false);
  }, [appVersion, campaignId, suppressForSevenDays]);
  dismissRef.current = dismiss;

  const openTarget = useCallback(async () => {
    if (!activePoster || openingTarget) return;
    setOpenError('');
    setOpeningTarget(true);
    const result = await openStartupPosterExternalTarget({
      url: activePoster.targetUrl,
      electronOpen: typeof window.t8pc?.openExternal === 'function'
        ? (url) => window.t8pc!.openExternal(url)
        : null,
      openWindow: (url, target) => window.open(url, target),
    });
    if (result.opened) dismiss();
    else if (result.reason === 'popup-blocked') setOpenError(t('startupPoster.popupBlocked'));
    else setOpenError(t('startupPoster.openSystemFailed'));
    setOpeningTarget(false);
  }, [activePoster, dismiss, openingTarget, t]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (multiple && event.key === 'ArrowLeft') {
        event.preventDefault();
        moveRef.current(-1);
        return;
      }
      if (multiple && event.key === 'ArrowRight') {
        event.preventDefault();
        moveRef.current(1);
        return;
      }
      if (multiple && event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (multiple && event.key === 'End') {
        event.preventDefault();
        setActiveIndex(posterCount - 1);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (activeElement === dialogRef.current || !dialogRef.current.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [multiple, open, posterCount]);

  useEffect(() => () => {
    if (wheelResetTimerRef.current != null) window.clearTimeout(wheelResetTimerRef.current);
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!multiple) return;
    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now < wheelCooldownUntilRef.current) return;
    wheelAccumulatorRef.current += dominantDelta;
    if (wheelResetTimerRef.current != null) window.clearTimeout(wheelResetTimerRef.current);
    wheelResetTimerRef.current = window.setTimeout(() => {
      wheelAccumulatorRef.current = 0;
    }, 180);
    if (Math.abs(wheelAccumulatorRef.current) < 32) return;
    move(wheelAccumulatorRef.current > 0 ? 1 : -1);
    wheelAccumulatorRef.current = 0;
    wheelCooldownUntilRef.current = now + 420;
  }, [move, multiple]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!multiple || event.button !== 0) return;
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setDragOffset(0);
  }, [multiple]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const x = event.clientX - gesture.startX;
    const y = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(x, y) > 7) {
      gesture.moved = true;
      suppressClickRef.current = true;
    }
    setDragOffset(Math.max(-120, Math.min(120, x)));
  }, []);

  const finishPointerGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const x = event.clientX - gesture.startX;
    pointerGestureRef.current = null;
    setDragging(false);
    setDragOffset(0);
    if (Math.abs(x) >= 56) move(x < 0 ? 1 : -1);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, [move]);

  const cancelPointerGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGestureRef.current = null;
    setDragging(false);
    setDragOffset(0);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  if (!open || !activePoster || typeof document === 'undefined') return null;

  const activeCardStyle = {
    '--t8-startup-poster-drag-x': `${dragOffset}px`,
  } as CSSProperties;

  return createPortal(
    <div
      className="t8-startup-poster-overlay"
      data-canvas-floating-ui="startup-poster-carousel"
      data-testid="startup-poster-carousel"
      data-canvas-surface-ready="true"
      data-poster-assets-ready="true"
      data-canvas-settle-ms={canvasSettleMs}
      data-expected-node-count={Math.max(0, Math.trunc(expectedNodeCount))}
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        tabIndex={-1}
        className="t8-startup-poster"
        data-multiple={multiple ? 'true' : 'false'}
      >
        <h2 id={titleId} className="t8-startup-poster__sr-only">{t('startupPoster.title')}</h2>
        <p id={hintId} className="t8-startup-poster__sr-only">
          {multiple ? t('startupPoster.multiHint') : t('startupPoster.singleHint')}
        </p>

        <button
          type="button"
          className="t8-startup-poster__close"
          aria-label={t('startupPoster.close')}
          onClick={dismiss}
        >
          <X aria-hidden="true" size={21} strokeWidth={2.25} />
        </button>

        <div className="t8-startup-poster__stage">
          {multiple && (
            <button
              type="button"
              className="t8-startup-poster__nav is-previous"
              aria-label={t('startupPoster.previous')}
              onClick={() => move(-1)}
            >
              <ChevronLeft aria-hidden="true" size={24} />
            </button>
          )}

          <div
            className={`t8-startup-poster__deck${multiple ? '' : ' is-single'}${dragging ? ' is-dragging' : ''}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerGesture}
            onPointerCancel={cancelPointerGesture}
          >
            {posters.map((poster, index) => {
              const stackPosition = startupPosterStackPosition(index, activeIndex, posterCount);
              const positionClass = `is-${stackPosition}`;
              const current = stackPosition === 'current';
              return (
                <article
                  key={poster.id}
                  className={`t8-startup-poster__card ${positionClass}`}
                  aria-hidden={current ? undefined : 'true'}
                  style={current ? activeCardStyle : undefined}
                >
                  <button
                    type="button"
                    className="t8-startup-poster__image-button"
                    tabIndex={current ? 0 : -1}
                    aria-label={t('startupPoster.openPoster', { index: index + 1 })}
                    onClick={() => {
                      if (suppressClickRef.current) return;
                      void openTarget();
                    }}
                  >
                    <img
                      src={poster.imageUrl}
                      alt={t(poster.altKey)}
                      width={2048}
                      height={1536}
                      draggable={false}
                    />
                  </button>
                </article>
              );
            })}
          </div>

          {multiple && (
            <>
              <button
                type="button"
                className="t8-startup-poster__nav is-next"
                aria-label={t('startupPoster.next')}
                onClick={() => move(1)}
              >
                <ChevronRight aria-hidden="true" size={24} />
              </button>
              <div className="t8-startup-poster__progress" aria-live="polite" aria-atomic="true">
                <strong>{activeIndex + 1}</strong>
                <span aria-hidden="true" />
                <small>{posterCount}</small>
              </div>
            </>
          )}
        </div>

        {multiple && <p className="t8-startup-poster__gesture-hint">{t('startupPoster.gestureHint')}</p>}

        <footer className="t8-startup-poster__footer">
          <label className="t8-startup-poster__suppression">
            <input
              type="checkbox"
              checked={suppressForSevenDays}
              onChange={(event) => setSuppressForSevenDays(event.target.checked)}
            />
            <span aria-hidden="true" className="t8-startup-poster__checkmark" />
            <span>{t('startupPoster.suppressSevenDays')}</span>
          </label>
          <button
            type="button"
            className="t8-startup-poster__cta"
            disabled={openingTarget}
            onClick={() => void openTarget()}
          >
            <span>{openingTarget ? t('startupPoster.opening') : t('startupPoster.cta')}</span>
            <ExternalLink aria-hidden="true" size={18} />
          </button>
        </footer>
        {openError && <p className="t8-startup-poster__error" role="alert">{openError}</p>}
      </section>
    </div>,
    document.body,
  );
}
