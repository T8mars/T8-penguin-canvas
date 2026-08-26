const NODE_ACTION_BAR_GAP = 8;

type ScreenRect = {
  left: number;
  top: number;
  right: number;
};

export function resolveNodeActionBarGeometry({
  nodeX,
  nodeY,
  nodeWidth,
  viewportX,
  viewportY,
  zoom,
}: {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  viewportX: number;
  viewportY: number;
  zoom: number;
}) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    anchorX: nodeX * safeZoom + viewportX + nodeWidth * safeZoom,
    anchorY: nodeY * safeZoom + viewportY - NODE_ACTION_BAR_GAP * safeZoom,
    scale: safeZoom,
  };
}

/**
 * Resolve the floating action bar against the node's actual DOM rectangle.
 * ReactFlow model coordinates can be relative to a parent or temporarily lag
 * behind a resized node; DOM rectangles match the pixels the user sees.
 */
export function resolveNodeActionBarGeometryFromRects({
  nodeRect,
  flowRect,
  zoom,
}: {
  nodeRect: ScreenRect;
  flowRect: Pick<ScreenRect, 'left' | 'top'>;
  zoom: number;
}) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    anchorX: nodeRect.right - flowRect.left,
    anchorY: nodeRect.top - flowRect.top - NODE_ACTION_BAR_GAP * safeZoom,
    scale: safeZoom,
  };
}
