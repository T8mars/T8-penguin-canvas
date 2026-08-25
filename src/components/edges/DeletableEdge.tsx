// 自定义边组件:鼠标悬停时在中点显示剪刀按钮,点击可断开连线
import { useMemo, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  useStore,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { useThemeStore } from '../../stores/theme';
import { resolveThemeTemplate } from '../../theme/defaultTemplates';
import { getNodeInputs, getNodeOutputs, type PortType } from '../../config/portTypes';

const SLAMDUNK_BASKETBALL_URL = new URL('../../assets/slamdunk-basketball-v2.png', import.meta.url).href;
const SOCCER_BALL_URL = new URL('../../assets/soccer-ball-v2.png', import.meta.url).href;
const DECORATIVE_EDGE_MOTION_LIMIT = 36;
type FarmEdgeKind = 'rope' | 'water' | 'path';

function isNodeSelectedFromStore(state: any, nodeId: string) {
  const fromLookup = state?.nodeLookup?.get?.(nodeId);
  if (fromLookup) return Boolean(fromLookup.selected);
  const fromArray = Array.isArray(state?.nodes) ? state.nodes.find((node: any) => node?.id === nodeId) : null;
  return Boolean(fromArray?.selected);
}

let activeThemeEdgeCountCache: {
  edges: unknown;
  nodes: unknown;
  nodeLookup: unknown;
  count: number;
} | null = null;

function countActiveThemeEdges(state: any) {
  const edges = Array.isArray(state?.edges) ? state.edges : [];
  const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
  const nodeLookup = state?.nodeLookup;
  if (activeThemeEdgeCountCache
    && activeThemeEdgeCountCache.edges === edges
    && activeThemeEdgeCountCache.nodes === nodes
    && activeThemeEdgeCountCache.nodeLookup === nodeLookup) {
    return activeThemeEdgeCountCache.count;
  }
  const selectedNodeIds = new Set<string>();
  if (nodeLookup?.forEach) {
    nodeLookup.forEach((node: any, nodeId: string) => {
      if (node?.selected) selectedNodeIds.add(nodeId || node.id);
    });
  }
  for (const node of nodes) {
    if (node?.selected) selectedNodeIds.add(node.id);
  }
  const count = edges.reduce((total: number, edge: any) => {
    if (!edge) return total;
    return total + (edge.selected || selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target) ? 1 : 0);
  }, 0);
  activeThemeEdgeCountCache = { edges, nodes, nodeLookup, count };
  return count;
}

function edgeDelay(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1400;
  }
  return `${hash / 1000}s`;
}

function farmEdgeKindFromPortType(portType: PortType | null | undefined): FarmEdgeKind {
  if (portType === 'image' || portType === 'video' || portType === 'audio' || portType === 'model3d') return 'water';
  if (portType === 'any' || portType === 'config' || portType === 'metadata') return 'path';
  return 'rope';
}

function inferPortTypeFromNodes(sourceNode: any, targetNode: any): PortType {
  const outputs = getNodeOutputs(sourceNode);
  const inputs = getNodeInputs(targetNode);
  const matched = outputs.find((type) => inputs.includes(type) || type === 'any' || inputs.includes('any'));
  return matched ?? 'any';
}

export default function DeletableEdge(props: EdgeProps) {
  const {
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
    source,
    target,
    data,
  } = props;
  const { setEdges, getNode } = useReactFlow();
  const sourceSelected = useStore((state: any) => isNodeSelectedFromStore(state, source));
  const targetSelected = useStore((state: any) => isNodeSelectedFromStore(state, target));
  const activeThemeEdgeCount = useStore(countActiveThemeEdges);
  const { style: themeStyle, templateId, customTemplates } = useThemeStore();
  const visualStyle = useMemo(
    () => resolveThemeTemplate(templateId, customTemplates).visuals?.style || themeStyle,
    [customTemplates, templateId, themeStyle],
  );
  const sourceNode = getNode(source);
  const targetNode = getNode(target);
  const portType = ((data as any)?.portType || inferPortTypeFromNodes(sourceNode, targetNode)) as PortType;
  const farmEdgeKind = farmEdgeKindFromPortType(portType);
  const farmEdgeKindClass = `t8-edge-kind-${farmEdgeKind}`;
  const isRhDuckEdge = Boolean((data as any)?.rhDuckEdge || (targetNode?.data as any)?.rhDuckDecoded);
  const isYyhPortraitHiddenEdge = Boolean(
    (data as any)?.yyhPortraitHiddenEdge ||
      (sourceNode?.data as any)?.yyhPortraitHidden ||
      (targetNode?.data as any)?.yyhPortraitHidden,
  );
  const [hover, setHover] = useState(false);
  const edgeDirectlyFocused = Boolean(selected || hover);
  const nodeRelatedEdgeFocused = Boolean(sourceSelected || targetSelected);
  const selectedNodeMotionWithinBudget =
    activeThemeEdgeCount > 0 && activeThemeEdgeCount <= DECORATIVE_EDGE_MOTION_LIMIT;
  const isThemeMotionActive =
    edgeDirectlyFocused || (nodeRelatedEdgeFocused && selectedNodeMotionWithinBudget);
  const themeActiveClass = isThemeMotionActive ? 't8-edge-theme-active' : '';
  const edgeClassName = [
    isRhDuckEdge ? 'rh-duck-edge' : '',
    isYyhPortraitHiddenEdge ? 'yyh-portrait-hidden-edge' : '',
    farmEdgeKindClass,
    themeActiveClass,
  ].filter(Boolean).join(' ') || undefined;

  const edgePathOptions = {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  };
  const [edgePath, labelX, labelY] =
    visualStyle === 'tetris'
      ? getSmoothStepPath({ ...edgePathOptions, borderRadius: 0, offset: 34 })
      : getBezierPath(edgePathOptions);

  // 用延迟关闭避免鼠标从 path 切到按钮的瞬间闪烁
  const hideTimer = useRef<number | null>(null);
  const show = () => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHover(true);
  };
  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(false), 80);
  };

  const visible = hover || !!selected;
  const canRenderDecorativeMotion = isThemeMotionActive;
  const shouldRenderPassBall = visualStyle === 'slamdunk' && canRenderDecorativeMotion;
  const shouldRenderSoccerBall = visualStyle === 'soccer-hero' && canRenderDecorativeMotion;
  const passBallDelay = (shouldRenderPassBall || shouldRenderSoccerBall) ? edgeDelay(id) : '0s';

  const handleCut = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('penguin:edge-cut-feedback', {
        detail: {
          x: e.clientX,
          y: e.clientY,
          count: 1,
          edgeKind: farmEdgeKind,
          source: 'button',
        },
      }));
    }
    setEdges((eds) => eds.filter((ed) => ed.id !== id));
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        className={edgeClassName}
        data-t8-edge-kind={farmEdgeKind}
        data-t8-port-type={portType}
        markerEnd={markerEnd}
        interactionWidth={24}
      />
      {!isYyhPortraitHiddenEdge && (
        <path
          className={`t8-edge-yyh-red-segment ${farmEdgeKindClass} ${themeActiveClass}`.trim()}
          data-t8-edge-kind={farmEdgeKind}
          data-t8-port-type={portType}
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={0}
          pointerEvents="none"
          aria-hidden="true"
        />
      )}
      {shouldRenderPassBall && (
        <g className={`t8-edge-pass-ball ${themeActiveClass}`.trim()} aria-hidden="true">
          <g className="t8-edge-pass-ball__sprite">
            <animateMotion
              dur="1.9s"
              repeatCount="indefinite"
              path={edgePath}
              begin={passBallDelay}
            />
            <image
              className="t8-edge-pass-ball__image"
              href={SLAMDUNK_BASKETBALL_URL}
              x={-11}
              y={-11}
              width={22}
              height={22}
              preserveAspectRatio="xMidYMid meet"
            />
          </g>
        </g>
      )}
      {shouldRenderSoccerBall && (
        <g className={`t8-edge-soccer-ball ${themeActiveClass}`.trim()} aria-hidden="true">
          <g className="t8-edge-soccer-ball__sprite">
            <animateMotion
              dur="2.05s"
              repeatCount="indefinite"
              path={edgePath}
              begin={passBallDelay}
            />
            <image
              className="t8-edge-soccer-ball__image"
              href={SOCCER_BALL_URL}
              x={-11}
              y={-11}
              width={22}
              height={22}
              preserveAspectRatio="xMidYMid meet"
            />
          </g>
        </g>
      )}
      {/* 透明的加宽 hit area,捕捉鼠标 hover (BaseEdge 的 interactionWidth 已自带,这里再补一层,确保事件有响应) */}
      <path
        className={`t8-edge-interaction-path ${farmEdgeKindClass}`.trim()}
        data-t8-edge-kind={farmEdgeKind}
        data-t8-port-type={portType}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        style={{ cursor: 'pointer' }}
        pointerEvents="stroke"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      />
      <EdgeLabelRenderer>
        <div
          className={`t8-edge-theme-marker ${farmEdgeKindClass} nodrag nopan`}
          data-t8-edge-kind={farmEdgeKind}
          data-t8-port-type={portType}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
            zIndex: 998,
          }}
          aria-hidden="true"
        />
        <div
          className="t8-edge-cut-label nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: visible ? 'all' : 'none',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.15s, transform 0.15s',
            zIndex: 1000,
          }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <button
            type="button"
            className={`t8-edge-cut-button ${farmEdgeKindClass}`}
            data-t8-edge-kind={farmEdgeKind}
            onClick={handleCut}
            onMouseDown={(e) => e.stopPropagation()}
            title="点击断开连线"
            aria-label="断开连线"
          >
            <span className="t8-edge-cut-glyph" aria-hidden="true" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
