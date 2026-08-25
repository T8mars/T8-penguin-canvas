import { memo, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Video as VideoIcon,
  Music,
  X,
  Link2,
  Pin,
  FileText,
} from 'lucide-react';
import SmartImage from '../SmartImage';
import type { Material } from './useUpstreamMaterials';

/**
 * MaterialThumbnail - 单项素材缩略 (供 MaterialPreviewSection 内部使用)
 *
 * 视觉:
 *   - image  : 直接渲染 <img>, object-cover 填满
 *   - video  : 黑底 + VideoIcon (后续可升级为视频首帧)
 *   - audio  : 黄/teal 底 + Music 图标
 *   - text   : 浅色卡片 + 文本前缀字
 *   - 左上角: 序号 (1/2/3…)
 *   - 右上角: 来源标识 📌 local / 🔗 upstream
 *   - 右下角: 删除 / 排除按钮 (local 真删除, upstream 仅从当前节点排除)
 *
 * 主题:
 *   - isPixel=true  → 黑色像素描边 + 1px 偏移投影 + 高对比黄/青块
 *   - isPixel=false → 圆角 + 半透明描边 + 白/teal 高亮
 *
 * 交互:
 *   - 整个缩略项可作为 MaterialPreviewSection 的 pointer 排序拖把手
 *   - 加 className="nodrag" 让 xyflow 节点拖动不抢事件
 *   - 删除按钮 onPointerDown stopPropagation 避免触发拖动
 */

interface Props {
  material: Material;
  index: number;
  isPixel: boolean;
  isDark: boolean;
  draggable?: boolean;
  removable?: boolean;
  excludeable?: boolean;
  onRemove?: () => void;
  onExclude?: () => void;
  size?: number;
  cursor?: React.CSSProperties['cursor'];
  sortScope?: string;
  isSorting?: boolean;
  isSortOver?: boolean;
  onSortPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}

const MaterialThumbnail = ({
  material,
  index,
  isPixel,
  isDark,
  draggable = true,
  removable = false,
  excludeable = false,
  onRemove,
  onExclude,
  size = 56,
  cursor,
  sortScope,
  isSorting = false,
  isSortOver = false,
  onSortPointerDown,
}: Props) => {
  const { t } = useTranslation('nodes');
  const stopFlowPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (onSortPointerDown) {
      onSortPointerDown(event);
      return;
    }
    event.stopPropagation();
  };
  const stopFlowMouse = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  const noNativeDragStyle = {
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as unknown as React.CSSProperties;
  const title = material.rhNodeId
    ? `${material.label || material.url}\nRH#${material.rhNodeId}`
    : (material.label || material.url);
  const externalFileName = material.kind !== 'text'
    ? (material.url.split(/[?#]/)[0].split('/').pop() || material.label)
    : undefined;

  const wrapStyle: React.CSSProperties = {
    opacity: isSorting ? 0.58 : 1,
    width: size,
    height: size,
    cursor: cursor || (isSorting ? 'grabbing' : draggable ? 'grab' : 'default'),
    touchAction: 'none',
    ...noNativeDragStyle,
    position: 'relative',
    overflow: 'hidden',
    flex: '0 0 auto',
    outline: isSortOver ? '2px solid var(--t8-accent, #22c55e)' : 'none',
    outlineOffset: 2,
    transition: 'opacity 120ms ease, outline-color 120ms ease',
    ...(isPixel
      ? { border: '1.5px solid var(--px-ink, #1a1a1a)', boxShadow: '1px 1px 0 var(--px-ink, #1a1a1a)' }
      : { borderRadius: 6, border: `1px solid ${isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'}` }),
  };

  const cornerCommon: React.CSSProperties = {
    position: 'absolute',
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 14,
    height: 14,
    pointerEvents: 'none',
  };

  return (
    <div
      style={wrapStyle}
      className="nodrag nopan"
      data-material-preview-section={sortScope || undefined}
      data-material-preview-thumb-id={sortScope ? material.id : undefined}
      data-drag-source={material.kind !== 'text' ? true : undefined}
      data-drag-kind={material.kind !== 'text' ? material.kind : undefined}
      data-drag-url={material.kind !== 'text' ? material.url : undefined}
      data-drag-preview={material.kind !== 'text' ? material.url : undefined}
      data-drag-node-id={material.sourceNodeId}
      data-resource-title={externalFileName}
      draggable={material.kind !== 'text' && draggable}
      onPointerDownCapture={stopFlowPointer}
      onMouseDown={stopFlowMouse}
      title={title}
    >
      {/* 内容主体 */}
      {material.kind === 'image' ? (
        <SmartImage
          src={material.url}
          alt={material.label || ''}
          draggable={false}
          thumbSize={Math.max(160, size * 3)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            pointerEvents: 'none',
            ...noNativeDragStyle,
          }}
        />
      ) : material.kind === 'video' ? (
        <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <VideoIcon size={20} color="#cbd5e1" />
        </div>
      ) : material.kind === 'audio' ? (
        <div style={{
          width: '100%', height: '100%',
          background: isPixel ? 'var(--px-yellow, #fde047)' : isDark ? 'rgba(20,184,166,.18)' : 'rgba(20,184,166,.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Music size={20} color={isPixel ? '#1a1a1a' : '#5eead4'} />
        </div>
      ) : (
        <div style={{
          width: '100%', height: '100%',
          padding: '4px 4px',
          fontSize: 9, lineHeight: 1.25,
          display: 'flex', alignItems: 'flex-start',
          background: isPixel ? 'var(--px-card, #fefce8)' : isDark ? 'rgba(99,102,241,.14)' : 'rgba(99,102,241,.10)',
          color: isPixel ? '#1a1a1a' : isDark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.78)',
          overflow: 'hidden',
        }}>
          <FileText size={9} style={{ marginRight: 2, flexShrink: 0, marginTop: 1 }} />
          <span style={{
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-all',
          }}>
            {material.label || material.url}
          </span>
        </div>
      )}

      {/* 序号角标 - 左上 */}
      <div
        style={{
          ...cornerCommon,
          top: 0,
          left: 0,
          padding: '0 3px',
          background: isPixel ? 'var(--px-yellow, #fde047)' : 'rgba(0,0,0,.6)',
          color: isPixel ? '#1a1a1a' : '#fff',
          ...(isPixel ? { borderRight: '1.5px solid #1a1a1a', borderBottom: '1.5px solid #1a1a1a' } : {}),
        }}
      >
        {index + 1}
      </div>

      {/* 来源角标 - 右上 */}
      <div
        style={{
          ...cornerCommon,
          top: 0,
          right: 0,
          width: 14,
          background: material.origin === 'local'
            ? (isPixel ? 'var(--px-card, #fefce8)' : 'rgba(0,0,0,.6)')
            : (isPixel ? 'var(--px-cyan, #67e8f9)' : 'rgba(20,184,166,.85)'),
          color: isPixel ? '#1a1a1a' : '#fff',
          ...(isPixel ? { borderLeft: '1.5px solid #1a1a1a', borderBottom: '1.5px solid #1a1a1a' } : {}),
        }}
      >
        {material.origin === 'local' ? <Pin size={8} /> : <Link2 size={8} />}
      </div>

      {material.kind === 'text' && material.rhNodeId && (
        <div
          style={{
            ...cornerCommon,
            bottom: 0,
            left: 0,
            height: 13,
            padding: '0 3px',
            minWidth: 26,
            fontSize: 8,
            background: isPixel ? 'var(--px-yellow, #fde047)' : 'rgba(14,165,233,.88)',
            color: isPixel ? '#1a1a1a' : '#fff',
            ...(isPixel ? { borderRight: '1.5px solid #1a1a1a', borderTop: '1.5px solid #1a1a1a' } : {}),
          }}
        >
          RH#{material.rhNodeId}
        </div>
      )}

      {/* 删除 / 排除按钮 - 右下 */}
      {((removable && onRemove) || (excludeable && onExclude)) && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (removable && onRemove) onRemove();
            else if (excludeable && onExclude) onExclude();
          }}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isPixel ? 'var(--px-red, #ef4444)' : 'rgba(239,68,68,.92)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            ...(isPixel ? { borderLeft: '1.5px solid #1a1a1a', borderTop: '1.5px solid #1a1a1a' } : {}),
          }}
          title={removable ? t('shared.removeLocal') : t('shared.excludeUpstream')}
        >
          <X size={9} />
        </button>
      )}
    </div>
  );
};

export default memo(MaterialThumbnail);
