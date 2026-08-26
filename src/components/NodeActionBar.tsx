/**
 * NodeActionBar —— 选中可执行节点时的浮动操作栏
 *
 * 设计目标:
 *   选中任意「带生成/执行功能」的节点 (EXECUTABLE_NODE_TYPES) 时,
 *   在节点右上角外侧出现一条快捷操作栏: 执行 / 中止 / 取消选中
 *
 * 设计要点:
 *   - 0 节点侵入: 在 ReactFlow 内部统一渲染, 不需要改每个节点组件
 *   - 跟随 viewport 缩放/平移: 用 useViewport 拿到 (vx, vy, zoom) 计算屏幕坐标
 *   - 双主题适配: 科技风 (深色玻璃 + 圆角) / 像素风 (硬边 + 硬阴影)
 *   - 状态联动: 当前节点正在运行时, ▶ RUN 自动切换为 ■ STOP
 *   - 智能定位: 锚定节点右上角往上偏移, 让按钮组与节点保持 8px 间距
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNodes, useViewport, useReactFlow, type Node } from '@xyflow/react';
import { Play, Square, X } from 'lucide-react';
import { useThemeStore } from '../stores/theme';
import { createCanvasNodeExecutionKey, useRunBusStore } from '../stores/runBus';
import { useCanvasStore } from '../stores/canvas';
import { trackAchievementEvent } from '../stores/achievements';
import { useHiddenFeatureStore, isRhDuckUploadEnabled, isYyhPortraitEnabled } from '../stores/hiddenFeatures';
import { resolveThemeTemplate } from '../theme/defaultTemplates';
import { getMediaItemsFromData } from '../utils/mediaCollection';
import {
  resolveNodeActionBarGeometry,
  resolveNodeActionBarGeometryFromRects,
} from '../utils/nodeActionBarGeometry';
import { EXECUTABLE_NODE_TYPES } from '../config/executableNodeTypes';

const ACTION_COLORS: Record<string, { run: string; stop: string; close: string }> = {
  tech: { run: '#22c55e', stop: '#f97316', close: '#ef4444' },
  pixel: { run: '#4ECDC4', stop: '#FF8F3D', close: '#FF4F6D' },
  op: { run: '#d99b16', stop: '#ff9d42', close: '#cf2f2f' },
  rh: { run: '#9cff4d', stop: '#ff9f43', close: '#ff345f' },
  naruto: { run: '#f4511e', stop: '#f59e0b', close: '#d11d1d' },
  eva: { run: '#78ff4d', stop: '#ff9d00', close: '#ff3046' },
  yyh: { run: '#52ff9a', stop: '#ffb84d', close: '#ff4f7b' },
  'soccer-hero': { run: '#1f9f4a', stop: '#f5d550', close: '#d64242' },
  'dragon-ball': { run: '#ffb000', stop: '#38bdf8', close: '#dc2626' },
  'saint-seiya': { run: '#f8c84a', stop: '#2dd4bf', close: '#b4232f' },
};

interface NodeActionBarProps {
  onRunNode: (nodeId: string) => void | Promise<void>;
  onStopRun: () => void;
}

const NodeActionBar = ({ onRunNode, onStopRun }: NodeActionBarProps) => {
  const nodes = useNodes();
  const { x: vx, y: vy, zoom } = useViewport();
  const { setNodes } = useReactFlow();
  const { theme, style, templateId, customTemplates } = useThemeStore();
  const isDark = theme === 'dark';
  const activeTemplate = useMemo(
    () => resolveThemeTemplate(templateId, customTemplates),
    [templateId, customTemplates],
  );
  const visualStyle = activeTemplate.visuals?.style || style;
  const isPixel = visualStyle === 'pixel';
  const actionColors = ACTION_COLORS[visualStyle] || ACTION_COLORS.tech;
  const isRhDomVisual =
    typeof document !== 'undefined' && document.documentElement.dataset.themeVisual === 'rh';
  const isRhVisual = visualStyle === 'rh' || isRhDomVisual;
  const isYyhDomVisual =
    typeof document !== 'undefined' && document.documentElement.dataset.themeVisual === 'yyh';
  const isYyhVisual = visualStyle === 'yyh' || isYyhDomVisual;

  const activeCanvasId = useCanvasStore((state) => state.activeId);
  const currentRunId = useRunBusStore((s) => s.currentRunId);
  const runningIds = useRunBusStore((s) => s.runningIds);
  const rhDuckUploadIds = useHiddenFeatureStore((s) => s.rhDuckUploadIds);
  const yyhPortraitIds = useHiddenFeatureStore((s) => s.yyhPortraitIds);
  const toggleRhDuckUpload = useHiddenFeatureStore((s) => s.toggleRhDuckUpload);
  const clearRhDuckUpload = useHiddenFeatureStore((s) => s.clearRhDuckUpload);
  const toggleYyhPortrait = useHiddenFeatureStore((s) => s.toggleYyhPortrait);
  const holdTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const anchorHostRef = useRef<HTMLDivElement | null>(null);
  const [holdArmed, setHoldArmed] = useState(false);
  const [measuredGeometry, setMeasuredGeometry] = useState<{
    nodeId: string;
    anchorX: number;
    anchorY: number;
    scale: number;
  } | null>(null);

  // 找选中的可执行节点 (只取第一个; 多选时仅最后选中的那个显示)
  const selectedExe = useMemo<Node | null>(() => {
    // 倒序找让"最近一次选中"优先
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.selected && n.type && EXECUTABLE_NODE_TYPES.has(n.type)) {
        return n;
      }
    }
    return null;
  }, [nodes]);

  const selectedData = (selectedExe?.data || {}) as any;
  const selectedRhDuckData = selectedExe?.data as any;
  const rhDuckPersistedMode = Boolean(
    selectedExe?.type === 'upload' &&
      (selectedRhDuckData?.rhDuckHiddenUpload === false
        ? false
        : selectedRhDuckData?.rhDuckHiddenUpload ||
          selectedRhDuckData?.rhDuckMode ||
          selectedRhDuckData?.rhDuckUploadMode),
  );
  const rhDuckEligible = Boolean(
    isRhVisual &&
      selectedExe?.type === 'upload' &&
      selectedData.uploadType === 'image' &&
      getMediaItemsFromData(selectedData, 'image').length > 0,
  );
  const rhDuckMode = Boolean(
    isRhVisual &&
      selectedExe?.type === 'upload' &&
      (rhDuckPersistedMode || isRhDuckUploadEnabled(rhDuckUploadIds, selectedExe?.id)),
  );
  const yyhPortraitEligible = Boolean(isYyhVisual && selectedExe?.type === 'portrait-master');
  const yyhPortraitMode = isYyhPortraitEnabled(yyhPortraitIds, selectedExe?.id);
  const hiddenHoldEligible = rhDuckMode || rhDuckEligible || yyhPortraitEligible;
  const hiddenModeKind = rhDuckMode
    ? 'rh-duck'
    : yyhPortraitEligible && yyhPortraitMode
      ? 'yyh-portrait'
      : undefined;

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldArmed(false);
  };

  useEffect(
    () => () => {
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    clearHoldTimer();
    suppressClickRef.current = false;
  }, [selectedExe?.id, isRhVisual, isYyhVisual]);

  // 节点宽高 (优先 measured.width, fallback 到 width / 320)
  const nodeW =
    (selectedExe as any)?.measured?.width ||
    (selectedExe as any)?.width ||
    320;

  const fallbackGeometry = selectedExe
    ? resolveNodeActionBarGeometry({
        nodeX: selectedExe.position.x,
        nodeY: selectedExe.position.y,
        nodeWidth: nodeW,
        viewportX: vx,
        viewportY: vy,
        zoom,
      })
    : null;

  useLayoutEffect(() => {
    if (!selectedExe) {
      setMeasuredGeometry(null);
      return;
    }

    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    const findNodeElement = (flowRoot: HTMLElement) => {
      if (typeof window.CSS?.escape === 'function') {
        return flowRoot.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${window.CSS.escape(selectedExe.id)}"]`,
        );
      }
      return (
        Array.from(flowRoot.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')).find(
          (element) => element.dataset.id === selectedExe.id,
        ) || null
      );
    };

    const measure = () => {
      const anchorHost = anchorHostRef.current;
      const flowRoot = anchorHost?.closest<HTMLElement>('.react-flow') || null;
      if (!flowRoot) return;
      const nodeElement = findNodeElement(flowRoot);
      if (!nodeElement) return;

      const geometry = resolveNodeActionBarGeometryFromRects({
        nodeRect: nodeElement.getBoundingClientRect(),
        flowRect: flowRoot.getBoundingClientRect(),
        zoom,
      });
      setMeasuredGeometry((current) => {
        if (
          current?.nodeId === selectedExe.id &&
          Math.abs(current.anchorX - geometry.anchorX) < 0.25 &&
          Math.abs(current.anchorY - geometry.anchorY) < 0.25 &&
          Math.abs(current.scale - geometry.scale) < 0.001
        ) {
          return current;
        }
        return { nodeId: selectedExe.id, ...geometry };
      });
    };

    measure();
    frame = window.requestAnimationFrame(measure);

    const anchorHost = anchorHostRef.current;
    const flowRoot = anchorHost?.closest<HTMLElement>('.react-flow') || null;
    const nodeElement = flowRoot ? findNodeElement(flowRoot) : null;
    if (typeof ResizeObserver !== 'undefined' && flowRoot && nodeElement) {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(flowRoot);
      resizeObserver.observe(nodeElement);
    }
    window.addEventListener('resize', measure);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    selectedExe?.id,
    selectedExe?.position.x,
    selectedExe?.position.y,
    (selectedExe as any)?.measured?.width,
    (selectedExe as any)?.measured?.height,
    nodeW,
    vx,
    vy,
    zoom,
  ]);

  if (!selectedExe || !fallbackGeometry) return null;

  // The DOM rectangle is authoritative; model coordinates cover the first frame.
  const geometry =
    measuredGeometry?.nodeId === selectedExe.id ? measuredGeometry : fallbackGeometry;
  const {
    anchorX: rightX,
    anchorY: topY,
    scale: actionBarScale,
  } = geometry;

  const selectedStatus = String(selectedData?.status || '');
  const selectedNodeBusy = selectedStatus === 'submitting' || selectedStatus === 'polling';
  const selectedExecutionNodeId = createCanvasNodeExecutionKey(activeCanvasId, selectedExe.id);
  const isRunning = currentRunId === selectedExecutionNodeId || runningIds.includes(selectedExecutionNodeId) || selectedNodeBusy;

  // === 主题派生样式 ===
  // 科技风: 深色玻璃面板 + 圆角  /  像素风: 硬边 + 硬阴影
  const barBg = isPixel
    ? '#FFFFFF'
    : 'var(--t8-actionbar-bg, rgba(28,28,32,0.92))';
  const barBorder = isPixel
    ? '2px solid #1A1410'
    : 'var(--t8-actionbar-border, 1px solid rgba(255,255,255,0.1))';
  const barRadius = isPixel ? 8 : 10;
  const barShadow = isPixel
    ? '3px 3px 0 #1A1410'
    : 'var(--t8-actionbar-shadow, 0 6px 24px rgba(0,0,0,0.4))';

  const onRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (isRunning) return;
    void onRunNode(selectedExe.id);
  };
  const onRunPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || isRunning || !hiddenHoldEligible || !selectedExe) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    clearHoldTimer();
    setHoldArmed(true);
    holdTimerRef.current = window.setTimeout(() => {
      if (rhDuckMode || rhDuckEligible) {
        const enabled = !rhDuckMode;
        if (enabled && !isRhDuckUploadEnabled(rhDuckUploadIds, selectedExe.id)) toggleRhDuckUpload(selectedExe.id);
        if (!enabled) clearRhDuckUpload(selectedExe.id);
        setNodes((nds) =>
          nds.map((node) =>
            node.id === selectedExe.id
              ? {
                  ...node,
                  data: {
                    ...(node.data || {}),
                    rhDuckHiddenUpload: enabled,
                    uploadType: enabled ? 'image' : (node.data as any)?.uploadType,
                  },
                }
              : node,
          ),
        );
        if (enabled) trackAchievementEvent({ type: 'hidden_mode.enabled', theme: visualStyle, kind: 'rh-duck', mode: 'enabled', nodeType: 'upload' });
      } else if (yyhPortraitEligible) {
        const enabled = toggleYyhPortrait(selectedExe.id);
        if (enabled) trackAchievementEvent({ type: 'hidden_mode.enabled', theme: visualStyle, kind: 'yyh-portrait', mode: 'enabled', nodeType: 'portrait-master' });
      }
      suppressClickRef.current = true;
      holdTimerRef.current = null;
      setHoldArmed(false);
    }, 3000);
  };
  const onRunPointerEnd = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    clearHoldTimer();
  };
  const onStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStopRun();
  };
  const onClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((nds) => nds.map((n) => (n.id === selectedExe.id ? { ...n, selected: false } : n)));
  };

  const runColor = rhDuckMode
    ? '#ff345f'
    : yyhPortraitEligible && yyhPortraitMode
      ? '#ff4fd8'
    : holdArmed
      ? yyhPortraitEligible
        ? '#ff8be8'
        : '#fb7185'
      : actionColors.run;

  // 按钮通用样式生成器
  const mkBtn = (kind: 'run' | 'stop' | 'close'): React.CSSProperties => {
    const color =
      kind === 'run'
        ? runColor
        : kind === 'stop'
          ? actionColors.stop
          : actionColors.close;
    if (isPixel) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: kind === 'run' ? '4px 10px' : '4px 6px',
        height: 28,
        background: kind === 'run' ? color : '#FFFFFF',
        color: kind === 'run' ? '#FFFFFF' : color,
        border: `2px solid ${kind === 'run' ? '#1A1410' : color}`,
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 700,
        boxShadow: `2px 2px 0 ${kind === 'run' ? '#1A1410' : color}`,
        userSelect: 'none' as const,
      };
    }
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: kind === 'run' ? '4px 10px' : '4px 6px',
      height: 26,
      background: kind === 'run'
        ? `${color}22`
        : isDark
          ? 'rgba(255,255,255,0.05)'
          : 'rgba(0,0,0,0.04)',
      color,
      border: `1px solid ${color}66`,
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
      transition: 'background 0.12s, border-color 0.12s',
      userSelect: 'none' as const,
    };
  };

  // hover 增强
  const onEnter = (e: React.MouseEvent, kind: 'run' | 'stop' | 'close') => {
    const color =
      kind === 'run' ? runColor : kind === 'stop' ? actionColors.stop : actionColors.close;
    if (isPixel) return;
    (e.currentTarget as HTMLElement).style.background = `${color}33`;
    (e.currentTarget as HTMLElement).style.borderColor = color;
  };
  const onLeave = (e: React.MouseEvent, kind: 'run' | 'stop' | 'close') => {
    const color =
      kind === 'run' ? runColor : kind === 'stop' ? actionColors.stop : actionColors.close;
    if (isPixel) return;
    (e.currentTarget as HTMLElement).style.background =
      kind === 'run'
        ? `${color}22`
        : isDark
          ? 'rgba(255,255,255,0.05)'
          : 'rgba(0,0,0,0.04)';
    (e.currentTarget as HTMLElement).style.borderColor = `${color}66`;
  };

  return (
    <div
      ref={anchorHostRef}
      data-node-action-bar-anchor={selectedExe.id}
      // pointer-events: none 让外层不阻挡画布交互; 子按钮独立 enable
      style={{
        position: 'absolute',
        left: rightX,
        top: topY,
        width: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      <div
        // 真正的浮动条
        data-node-action-bar
        data-theme-visual={visualStyle}
        data-hidden-mode={hiddenModeKind}
        className={`nodrag nopan t8-node-action-bar t8-node-action-bar--${visualStyle}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate(-100%, -100%) scale(${actionBarScale})`,
          transformOrigin: 'bottom right',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          background: barBg,
          border: barBorder,
          borderRadius: barRadius,
          boxShadow: barShadow,
          backdropFilter: isPixel ? 'none' : 'blur(6px)',
          pointerEvents: 'all',
          whiteSpace: 'nowrap',
        }}
      >
        {/* 执行 / 中止 (互斥) */}
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            onMouseEnter={(e) => onEnter(e, 'stop')}
            onMouseLeave={(e) => onLeave(e, 'stop')}
            title="中止当前运行"
            style={mkBtn('stop')}
          >
            <Square size={12} fill="currentColor" />
            <span>STOP</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            onPointerDown={onRunPointerDown}
            onPointerUp={onRunPointerEnd}
            onPointerLeave={onRunPointerEnd}
            onPointerCancel={onRunPointerEnd}
            onMouseEnter={(e) => onEnter(e, 'run')}
            onMouseLeave={(e) => onLeave(e, 'run')}
            title="执行此节点"
            style={mkBtn('run')}
          >
            <Play size={12} fill="currentColor" />
            <span>RUN</span>
          </button>
        )}

        {/* 取消选中 (关闭操作栏) */}
        <button
          type="button"
          onClick={onClose}
          onMouseEnter={(e) => onEnter(e, 'close')}
          onMouseLeave={(e) => onLeave(e, 'close')}
          title="取消选中 (隐藏操作栏)"
          style={mkBtn('close')}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};

export default NodeActionBar;
