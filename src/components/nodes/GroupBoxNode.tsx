import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useReactFlow, useNodes, Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Play, X, Edit2, Maximize2, Minimize2 } from 'lucide-react';
import { useThemeStore } from '../../stores/theme';
import { resolveThemeTemplate } from '../../theme/defaultTemplates';
import { useGroupBusStore, GROUP_COLORS } from '../../stores/groupBus';
import { shouldCollectNodeTextOutput } from '../../utils/imageNodeOutputMode';

// 文件名后缀识别(与 OutputNode 一致): 剑中低代价修正「上游用 imageUrl 装视频/音频」兑底
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(u);
const isAudioUrl = (u: string) => /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i.test(u);
export interface GroupBoxData {
  name: string;
  color: string;
  memberIds: string[];
  width: number;
  height: number;
  /** Explicit view-only collapse. Member components remain mounted for runBus. */
  performanceCollapsed?: boolean;
}

const HEADER_H = 40;

/**
 * GroupBoxNode —— 节点组(打组容器)
 * - 半透明圆角矩形,头部带标题栏 + 双击改名 + 颜色指示点 + 右上角执行/删除按钮
 * - 双主题适配: 科技风(深浅) / 像素糖果风
 * - zIndex 通过节点配置压在普通节点之下
 * - 拖动该节点时由 Canvas.onNodeDrag 联动 memberIds 节点位置
 */
const GroupBoxNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation(['nodes', 'common']);
  const d = data as unknown as GroupBoxData;
  const name = d?.name ?? 'Group';
  const color = d?.color ?? GROUP_COLORS[0];
  const width = d?.width ?? 320;
  const height = d?.height ?? 200;
  const performanceCollapsed = d?.performanceCollapsed === true;

  const { theme, style, templateId, customTemplates } = useThemeStore();
  const currentTemplate = useMemo(
    () => resolveThemeTemplate(templateId, customTemplates),
    [templateId, customTemplates],
  );
  const visualStyle = currentTemplate.visuals?.style || style;
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';

  const { setNodes, getNodes, getZoom } = useReactFlow();
  const requestExecute = useGroupBusStore((s) => s.requestExecute);
  const requestDelete = useGroupBusStore((s) => s.requestDelete);

  // 实时几何成员计算: 节点中心点在组 bbox 内 → 视为当前成员
  // (不依赖创组时的静态快照 data.memberIds, 节点拖出/拖入后会自动同步)
  // 使用 useNodes() 订阅 ReactFlow store, 节点位置变化会触发重新计算
  const allNodes = useNodes();
  const liveMemberIds = useMemo<string[]>(() => {
    const self = allNodes.find((n) => n.id === id);
    if (!self) return [];
    const gx = self.position.x;
    const gy = self.position.y;
    const gw =
      (self.data as any)?.width ||
      (self as any).width ||
      (self as any).measured?.width ||
      width;
    const gh =
      (self.data as any)?.height ||
      (self as any).height ||
      (self as any).measured?.height ||
      height;
    const ids: string[] = [];
    for (const n of allNodes as Node[]) {
      if (n.id === id) continue;
      if (n.type === 'groupBox') continue; // 不嵌套组
      const nw = (n as any).width || (n as any).measured?.width || 200;
      const nh = (n as any).height || (n as any).measured?.height || 100;
      const cx = n.position.x + nw / 2;
      const cy = n.position.y + nh / 2;
      if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
        ids.push(n.id);
      }
    }
    return ids;
  }, [allNodes, id, width, height]);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [hoverCorner, setHoverCorner] = useState<
    'tl' | 'tr' | 'bl' | 'br' | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // === 聚合组内所有节点的输出供右侧 source handle 传出 ===
  // 计算逻辑与 OutputNode 中继透传保持一致(同一组字段/同一组兼容性)
  type Collected = { texts: string[]; images: string[]; videos: string[]; audios: string[] };
  const collected = useMemo<Collected>(() => {
    const out: Collected = { texts: [], images: [], videos: [], audios: [] };
    const pushUnique = (arr: string[], v: any) => {
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (!s) return;
      if (arr.indexOf(s) === -1) arr.push(s);
    };
    const memberSet = new Set(liveMemberIds);
    for (const n of allNodes as Node[]) {
      if (!memberSet.has(n.id)) continue;
      if (n.type === 'groupBox') continue;
      const ud: any = n.data || {};
      if (shouldCollectNodeTextOutput(n.type, n.data)) {
        // 文本
        pushUnique(out.texts, ud.outputText);
        pushUnique(out.texts, ud.reply);
        pushUnique(out.texts, ud.prompt);
        pushUnique(out.texts, ud.text);
      }
      // 图像 - 单
      pushUnique(out.images, ud.imageUrl);
      // 图像 - 多
      for (const f of ['imageUrls', 'urls', 'generatedImages']) {
        const v = ud[f];
        if (Array.isArray(v)) v.forEach((u: any) => pushUnique(out.images, u));
      }
      // 视频 / 音频
      pushUnique(out.videos, ud.videoUrl);
      pushUnique(out.audios, ud.audioUrl);
    }
    // 后缀净化: image 里装了视频/音频 → 调整到对应桶
    out.images = out.images.filter((u) => {
      if (isVideoUrl(u)) { if (out.videos.indexOf(u) === -1) out.videos.push(u); return false; }
      if (isAudioUrl(u)) { if (out.audios.indexOf(u) === -1) out.audios.push(u); return false; }
      return true;
    });
    return out;
  }, [allNodes, liveMemberIds]);

  const aggregateText = collected.texts.join('\n\n──────\n\n');
  const memberRuntimeSummary = useMemo(() => {
    const memberSet = new Set(liveMemberIds);
    let running = 0;
    let errors = 0;
    for (const node of allNodes as Node[]) {
      if (!memberSet.has(node.id)) continue;
      const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {};
      const status = String(data.status || data.runStatus || data.taskStatus || '').toLowerCase();
      if (data.running === true || data.isRunning === true || ['running', 'queued', 'pending', 'waiting'].includes(status)) running += 1;
      if (['error', 'failed'].includes(status)) errors += 1;
    }
    return { running, errors };
  }, [allNodes, liveMemberIds]);

  // 透传到自身 data 供下游节点读取 (与 OutputNode 同样手式 cur/next 比较防循环)
  useEffect(() => {
    const next: any = {
      prompt: aggregateText,
      text: aggregateText,
      reply: aggregateText,
      imageUrl: collected.images[0] || '',
      imageUrls: collected.images.slice(),
      urls: collected.images.slice(),
      videoUrl: collected.videos[0] || '',
      audioUrl: collected.audios[0] || '',
    };
    const cur: any = {
      prompt: (d as any).prompt || '',
      text: (d as any).text || '',
      reply: (d as any).reply || '',
      imageUrl: (d as any).imageUrl || '',
      imageUrls: Array.isArray((d as any).imageUrls) ? (d as any).imageUrls : [],
      urls: Array.isArray((d as any).urls) ? (d as any).urls : [],
      videoUrl: (d as any).videoUrl || '',
      audioUrl: (d as any).audioUrl || '',
    };
    const changed =
      cur.prompt !== next.prompt ||
      cur.text !== next.text ||
      cur.reply !== next.reply ||
      cur.imageUrl !== next.imageUrl ||
      cur.videoUrl !== next.videoUrl ||
      cur.audioUrl !== next.audioUrl ||
      JSON.stringify(cur.imageUrls) !== JSON.stringify(next.imageUrls) ||
      JSON.stringify(cur.urls) !== JSON.stringify(next.urls);
    if (changed) updateData(next as Partial<GroupBoxData>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregateText, collected]);

  // 同步 liveMemberIds 回写 data.memberIds, 供 Canvas.onConnect 等外部逻辑读到「实时成员集」
  // (节点拖入/拖出组后会随之更新)
  useEffect(() => {
    const prev: string[] = Array.isArray((d as any).memberIds) ? (d as any).memberIds : [];
    if (
      prev.length !== liveMemberIds.length ||
      prev.some((pid, i) => pid !== liveMemberIds[i])
    ) {
      updateData({ memberIds: liveMemberIds });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMemberIds]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const updateData = useCallback(
    (patch: Partial<GroupBoxData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...(n.data as object), ...patch } } : n
        )
      );
    },
    [id, setNodes]
  );

  const saveName = useCallback(() => {
    const v = editValue.trim();
    if (v && v !== name) updateData({ name: v });
    else setEditValue(name);
    setIsEditing(false);
  }, [editValue, name, updateData]);

  // 4 角缩放: 鼠标按下后监听全局 mousemove/mouseup实时改 width/height
  // 左/上角拖动需同步调 position；dx/dy / zoom 进行画布坐标换算
  const startResize = useCallback(
    (corner: 'tl' | 'tr' | 'bl' | 'br') => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = width;
      const startH = height;
      const cur = getNodes().find((n) => n.id === id);
      if (!cur) return;
      const startPosX = cur.position.x;
      const startPosY = cur.position.y;
      const zoom = getZoom() || 1;
      const MIN_W = 160;
      const MIN_H = 100;

      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let newW = startW;
        let newH = startH;
        let newX = startPosX;
        let newY = startPosY;

        if (corner === 'br') {
          newW = startW + dx;
          newH = startH + dy;
        } else if (corner === 'bl') {
          newW = startW - dx;
          newH = startH + dy;
          newX = startPosX + dx;
        } else if (corner === 'tr') {
          newW = startW + dx;
          newH = startH - dy;
          newY = startPosY + dy;
        } else if (corner === 'tl') {
          newW = startW - dx;
          newH = startH - dy;
          newX = startPosX + dx;
          newY = startPosY + dy;
        }

        // 最小尺寸保护 (需同步修正 position，避免拖过小后反向跳动)
        if (newW < MIN_W) {
          if (corner === 'bl' || corner === 'tl') {
            newX = startPosX + (startW - MIN_W);
          }
          newW = MIN_W;
        }
        if (newH < MIN_H) {
          if (corner === 'tl' || corner === 'tr') {
            newY = startPosY + (startH - MIN_H);
          }
          newH = MIN_H;
        }

        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? {
                  ...n,
                  position: { x: newX, y: newY },
                  data: {
                    ...(n.data as object),
                    width: newW,
                    height: newH,
                  },
                }
              : n
          )
        );
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [id, width, height, getNodes, getZoom, setNodes]
  );

  // 主题派生颜色
  const headerBg = isPixel
    ? '#FFFFFF'
    : isDark
      ? 'rgba(28,28,32,0.92)'
      : 'rgba(255,255,255,0.92)';
  // 半透明底色: 15% alpha (科技风透明度正好)
  // (节点本身 zIndex 在 groupBox 之上，groupBox zIndex=-1000 + elevateNodesOnSelect=false 保证不被遮挡)
  // 像素风需在 theme-pixel.css 排除 .react-flow__node-groupBox，避免全局白底规则覆盖
  const bodyBg = `${color}26`; // 15% alpha
  const borderColor = selected ? '#3B82F6' : color;
  const textColor = isPixel ? '#1A1410' : isDark ? '#fafafa' : '#18181b';
  const subTextColor = isPixel
    ? '#5C4D3E'
    : isDark
      ? 'rgba(255,255,255,0.5)'
      : 'rgba(0,0,0,0.5)';
  const btnBg = isPixel
    ? '#FFE08A'
    : isDark
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(0,0,0,0.05)';
  const btnHoverBg = isPixel
    ? '#FFD45F'
    : isDark
      ? 'rgba(255,255,255,0.16)'
      : 'rgba(0,0,0,0.1)';

  // 像素风:2px 黑边 + 硬阴影
  const outerStyle: React.CSSProperties = isPixel
    ? {
        width,
        height,
        background: bodyBg,
        border: `3px solid ${selected ? '#3B82F6' : '#1A1410'}`,
        borderRadius: 14,
        boxShadow: `4px 4px 0 ${color}`,
        position: 'relative',
        overflow: 'visible',
      }
    : {
        width,
        height,
        background: bodyBg,
        border: `2px solid ${borderColor}`,
        borderRadius: 16,
        boxShadow: selected
          ? `0 0 0 2px ${borderColor}33, 0 8px 32px rgba(0,0,0,0.18)`
          : `0 4px 18px rgba(0,0,0,0.14)`,
        position: 'relative',
        overflow: 'visible',
        backdropFilter: 'blur(2px)',
      };

  return (
    <div
      className="t8-group-box"
      data-theme-visual={visualStyle}
      data-selected={selected ? 'true' : 'false'}
      style={outerStyle}
    >
      {/* === 右侧 source Handle: 聚合组内所有节点输出一次性向组外传出 === */}
      {/*  - 主题适配: 科技风使用组颜色圆形, 像素风使用方形+黑边+硬阴影  */}
      {/*  - title 提示实时聚合数量, 让用户一眼看到能传出多少资源 */}
      <Handle
        type="source"
        position={Position.Right}
        id="group-out"
        isConnectableStart={true}
        isConnectableEnd={false}
        className="t8-group-box__handle"
        style={{
          background: isPixel ? '#1A1410' : color,
          width: isPixel ? 14 : 14,
          height: isPixel ? 14 : 14,
          minWidth: 14,
          minHeight: 14,
          top: '50%',
          right: -7,
          transform: 'translateY(-50%)',
          borderRadius: isPixel ? 3 : '50%',
          border: isPixel ? `2px solid ${color}` : `2px solid #FFFFFF`,
          boxShadow: isPixel
            ? `2px 2px 0 ${color}`
            : `0 0 0 2px ${color}55, 0 1px 4px rgba(0,0,0,0.3)`,
          zIndex: 12,
          pointerEvents: 'all',
        }}
        title={`组输出: ${collected.texts.length}文本 / ${collected.images.length}图 / ${collected.videos.length}视频 / ${collected.audios.length}音频`}
      />
      {/* 顶部标题栏 */}
      <div
        className="t8-group-box__header"
        style={{
          height: HEADER_H,
          background: headerBg,
          borderBottom: isPixel
            ? `2px solid #1A1410`
            : `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          borderTopLeftRadius: isPixel ? 11 : 13,
          borderTopRightRadius: isPixel ? 11 : 13,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          gap: 8,
          color: textColor,
          fontWeight: 700,
        }}
      >
        {/* 颜色指示点(点击切色) */}
        <button
          className="nodrag t8-group-box__swatch"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setShowColorPicker((v) => !v);
          }}
          title="切换组颜色"
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: color,
            border: isPixel
              ? '2px solid #1A1410'
              : `2px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)'}`,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />

        {/* 名字: 单击 / 双击都可编辑 */}
        {isEditing ? (
          <input
            ref={inputRef}
            className="nodrag nopan"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') {
                setEditValue(name);
                setIsEditing(false);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              minWidth: 0,
              height: 26,
              background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
              border: `2px solid ${color}`,
              borderRadius: isPixel ? 6 : 6,
              padding: '0 8px',
              fontSize: 13,
              fontWeight: 700,
              color: textColor,
              outline: 'none',
            }}
          />
        ) : (
          <div
            className="nodrag t8-group-box__title"
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditValue(name);
              setIsEditing(true);
            }}
            title="双击修改组名"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              fontWeight: 700,
              color: textColor,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: 'text',
              userSelect: 'none',
            }}
          >
            {name}
          </div>
        )}

        {/* 节点数 (实时计算: 当前几何上在组内的节点数) */}
        <span
          className="t8-group-box__count"
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: subTextColor,
            flexShrink: 0,
          }}
        >
          {t('common:units.nodes', { count: liveMemberIds.length })}
        </span>

        <button
          className="nodrag t8-group-box__button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateData({ performanceCollapsed: !performanceCollapsed });
          }}
          title={performanceCollapsed ? t('nodes:group.expand') : t('nodes:group.collapse')}
          aria-label={performanceCollapsed ? t('nodes:group.expand') : t('nodes:group.collapse')}
          aria-pressed={performanceCollapsed}
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: performanceCollapsed ? color : btnBg,
            border: isPixel ? '2px solid #1A1410' : 'none',
            borderRadius: 6,
            cursor: 'pointer',
            flexShrink: 0,
            color: performanceCollapsed ? '#fff' : subTextColor,
          }}
        >
          {performanceCollapsed ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
        </button>

        {/* 编辑按钮 */}
        {!isEditing && (
          <button
            className="nodrag t8-group-box__button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setEditValue(name);
              setIsEditing(true);
            }}
            title="重命名"
            style={{
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: btnBg,
              border: isPixel ? '2px solid #1A1410' : 'none',
              borderRadius: isPixel ? 6 : 6,
              cursor: 'pointer',
              flexShrink: 0,
              color: subTextColor,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = btnHoverBg;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = btnBg;
            }}
          >
            <Edit2 size={12} />
          </button>
        )}

        {/* 执行按钮(右上角) */}
        <button
          className="nodrag t8-group-box__button t8-group-box__button--run"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            // 按“当前几何包含关系”重新计算成员 → 节点拖入/拖出后执行也以实际为准
            requestExecute(id, liveMemberIds);
          }}
          title="执行组内所有节点"
          style={{
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: color,
            border: isPixel ? '2px solid #1A1410' : 'none',
            borderRadius: isPixel ? 6 : 7,
            color: '#fff',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: isPixel ? '2px 2px 0 #1A1410' : 'none',
          }}
        >
          <Play size={13} fill="currentColor" />
        </button>

        {/* 删除按钮(仅删除组本身,不删成员) */}
        <button
          className="nodrag t8-group-box__button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            requestDelete(id);
          }}
          title="解散组(成员节点保留)"
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: btnBg,
            border: isPixel ? '2px solid #1A1410' : 'none',
            borderRadius: isPixel ? 6 : 6,
            cursor: 'pointer',
            flexShrink: 0,
            color: subTextColor,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = btnHoverBg;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = btnBg;
          }}
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      </div>

      {performanceCollapsed ? (
        <div className="t8-group-box__performance-proxy" aria-live="polite">
          <strong>{name}</strong>
          <span>
            {liveMemberIds.length} 节点 · {collected.images.length} 图 · {collected.videos.length} 视频 · {collected.audios.length} 音频
          </span>
          <span>
            {memberRuntimeSummary.running > 0
              ? t('nodes:group.running', { count: memberRuntimeSummary.running })
              : t('nodes:group.noRunning')}
            {memberRuntimeSummary.errors > 0 ? ` · ${t('nodes:group.errors', { count: memberRuntimeSummary.errors })}` : ''}
          </span>
          <small>{t('nodes:group.proxyNote')}</small>
        </div>
      ) : null}

      {/* 颜色选择器 */}
      {showColorPicker && (
        <>
          <div
            className="nodrag"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowColorPicker(false);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9998,
              background: 'transparent',
            }}
          />
          <div
            className="nodrag"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 6,
              top: HEADER_H + 6,
              zIndex: 9999,
              padding: 8,
              background: isPixel
                ? '#FFFFFF'
                : isDark
                  ? 'rgba(28,28,32,0.98)'
                  : 'rgba(255,255,255,0.98)',
              border: isPixel
                ? '2px solid #1A1410'
                : `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
              borderRadius: isPixel ? 10 : 8,
              boxShadow: isPixel
                ? '4px 4px 0 #1A1410'
                : '0 8px 24px rgba(0,0,0,0.3)',
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 6,
            }}
          >
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                onClick={(e) => {
                  e.stopPropagation();
                  updateData({ color: c });
                  setShowColorPicker(false);
                }}
                style={{
                  width: 22,
                  height: 22,
                  background: c,
                  border:
                    c === color
                      ? `2.5px solid ${isPixel ? '#1A1410' : '#fff'}`
                      : isPixel
                        ? '2px solid #1A1410'
                        : '2px solid transparent',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  padding: 0,
                  boxShadow:
                    c === color && !isPixel
                      ? `0 0 0 2px ${c}80`
                      : 'none',
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* 主体区(空,仅作视觉容器) */}
      <div
        style={{
          width: '100%',
          height: height - HEADER_H,
          pointerEvents: 'none',
        }}
      />

      {/* 4 角缩放手柄: 默认弱可见，悬停/选中时高亮；nodrag 防止 ReactFlow 抓取为节点拖拽 */}
      {(
        [
          { c: 'tl' as const, style: { left: -7, top: -7, cursor: 'nwse-resize' } },
          { c: 'tr' as const, style: { right: -7, top: -7, cursor: 'nesw-resize' } },
          { c: 'bl' as const, style: { left: -7, bottom: -7, cursor: 'nesw-resize' } },
          { c: 'br' as const, style: { right: -7, bottom: -7, cursor: 'nwse-resize' } },
        ]
      ).map(({ c, style: posStyle }) => {
        const active = hoverCorner === c || selected;
        const dotBg = isPixel ? '#1A1410' : color;
        const dotBorder = isPixel ? color : '#FFFFFF';
        return (
          <div
            key={c}
            className="nodrag"
            onMouseDown={startResize(c)}
            onMouseEnter={() => setHoverCorner(c)}
            onMouseLeave={() => setHoverCorner(null)}
            title="拖动缩放组范围"
            style={{
              position: 'absolute',
              width: 16,
              height: 16,
              zIndex: 10,
              ...posStyle,
              // 热区透明，小色块在中间
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: active ? 12 : 8,
                height: active ? 12 : 8,
                background: dotBg,
                border: `2px solid ${dotBorder}`,
                borderRadius: isPixel ? 2 : '50%',
                boxShadow: isPixel
                  ? `1px 1px 0 ${color}`
                  : `0 1px 4px rgba(0,0,0,0.3)`,
                transition: 'width 0.12s, height 0.12s, opacity 0.12s',
                opacity: active ? 1 : 0.55,
                pointerEvents: 'none',
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export default GroupBoxNode;
