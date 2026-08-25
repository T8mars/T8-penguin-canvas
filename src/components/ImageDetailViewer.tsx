import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type ImageDetailViewerProps = {
  images: readonly string[];
  index: number;
  open: boolean;
  title?: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

type NaturalSize = { width: number; height: number };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

export default function ImageDetailViewer({
  images,
  index,
  open,
  title = '原图细节',
  onClose,
  onIndexChange,
}: ImageDetailViewerProps) {
  const { t } = useTranslation(['nodes', 'common']);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const zoomRef = useRef(1);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, images.length - 1));
  const src = images[safeIndex] || '';

  const setZoomed = useCallback((next: number) => {
    setFit(false);
    const normalized = clampZoom(next);
    zoomRef.current = normalized;
    setZoom(normalized);
  }, []);

  const resetFit = useCallback(() => {
    setFit(true);
    zoomRef.current = 1;
    setZoom(1);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    setNaturalSize(null);
    resetFit();
  }, [resetFit, src]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoomed(zoomRef.current * 1.25);
      } else if (event.key === '-') {
        event.preventDefault();
        setZoomed(zoomRef.current / 1.25);
      } else if (event.key === '0') {
        event.preventDefault();
        resetFit();
      } else if (event.key === 'ArrowLeft' && images.length > 1) {
        event.preventDefault();
        onIndexChange((safeIndex - 1 + images.length) % images.length);
      } else if (event.key === 'ArrowRight' && images.length > 1) {
        event.preventDefault();
        onIndexChange((safeIndex + 1) % images.length);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
      previousFocusRef.current = null;
    };
  }, [images.length, onClose, onIndexChange, open, resetFit, safeIndex, setZoomed]);

  const imageStyle = useMemo(() => {
    if (fit || !naturalSize) {
      return {
        maxWidth: '100%',
        maxHeight: '100%',
        width: 'auto',
        height: 'auto',
      } as const;
    }
    return {
      width: Math.max(1, Math.round(naturalSize.width * zoom)),
      height: Math.max(1, Math.round(naturalSize.height * zoom)),
      maxWidth: 'none',
      maxHeight: 'none',
    } as const;
  }, [fit, naturalSize, zoom]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fit || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    viewportRef.current?.releasePointerCapture(event.pointerId);
  };

  if (!open || !src || typeof document === 'undefined') return null;

  const move = (delta: number) => {
    if (images.length <= 1) return;
    onIndexChange((safeIndex + delta + images.length) % images.length);
  };

  return createPortal(
    <div
      ref={dialogRef}
      className="t8-image-detail-viewer"
      data-canvas-floating-ui="image-detail-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="t8-image-detail-viewer__toolbar nodrag nopan">
        <strong>{title}</strong>
        <span className="t8-image-detail-viewer__counter">
          {safeIndex + 1} / {images.length}
        </span>
        <button type="button" onClick={() => setZoomed(zoom / 1.25)} title={t('nodes:output.viewer.zoomOut')} aria-label={t('nodes:output.viewer.zoomOut')}>
          <ZoomOut size={16} />
        </button>
        <button type="button" onClick={() => setZoomed(1)} title="100%" aria-label={t('nodes:output.viewer.actualSize')}>
          100%
        </button>
        <button type="button" onClick={() => setZoomed(zoom * 1.25)} title={t('nodes:output.viewer.zoomIn')} aria-label={t('nodes:output.viewer.zoomIn')}>
          <ZoomIn size={16} />
        </button>
        <button type="button" onClick={resetFit} title={t('nodes:output.viewer.fit')} aria-label={t('nodes:output.viewer.fit')}>
          <Maximize2 size={16} />
        </button>
        <button type="button" onClick={resetFit} title={t('nodes:output.viewer.reset')} aria-label={t('nodes:output.viewer.reset')}>
          <RotateCcw size={16} />
        </button>
        <a href={src} target="_blank" rel="noopener noreferrer" download title={t('nodes:output.viewer.download')} aria-label={t('nodes:output.viewer.download')}>
          <Download size={16} />
        </a>
        <button type="button" onClick={onClose} title={t('common:actions.close')} aria-label={t('common:actions.close')}>
          <X size={18} />
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`t8-image-detail-viewer__viewport${fit ? ' is-fit' : ' is-zoomed'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
        onWheel={(event) => {
          event.stopPropagation();
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setZoomed(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
        }}
      >
        <img
          key={src}
          src={src}
          alt={`${title} ${safeIndex + 1}`}
          draggable={false}
          decoding="async"
          style={imageStyle}
          onLoad={(event) => {
            setNaturalSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
          }}
        />
      </div>

      {images.length > 1 ? (
        <>
          <button
            type="button"
            className="t8-image-detail-viewer__nav is-prev nodrag nopan"
            onClick={() => move(-1)}
            title={t('nodes:output.viewer.previous')}
            aria-label={t('nodes:output.viewer.previous')}
          >
            <ChevronLeft size={28} />
          </button>
          <button
            type="button"
            className="t8-image-detail-viewer__nav is-next nodrag nopan"
            onClick={() => move(1)}
            title={t('nodes:output.viewer.next')}
            aria-label={t('nodes:output.viewer.next')}
          >
            <ChevronRight size={28} />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
