import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';

/**
 * Large-canvas edge renderer. It preserves selection and the hover cut action
 * without mounting per-edge theme subscriptions or permanent label DOM.
 */
export default function PerformanceEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const { t } = useTranslation('common');
  const { setEdges } = useReactFlow();
  const [hover, setHover] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const show = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setHover(true);
  };
  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(false), 80);
  };
  const cut = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setEdges((current) => current.filter((edge) => edge.id !== id));
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        className="t8-edge-performance"
        interactionWidth={24}
      />
      <path
        className="t8-edge-performance-hit"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        pointerEvents="stroke"
        style={{ cursor: 'pointer' }}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onDoubleClick={cut}
      />
      {(hover || selected) && (
        <EdgeLabelRenderer>
          <div
            className="t8-edge-cut-label nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              opacity: 1,
              zIndex: 1000,
            }}
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
          >
            <button
              type="button"
              className="t8-edge-cut-button"
              onClick={cut}
              onMouseDown={(event) => event.stopPropagation()}
              title={t('actions.disconnectHint')}
              aria-label={t('actions.disconnect')}
            >
              <span className="t8-edge-cut-glyph" aria-hidden="true" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
