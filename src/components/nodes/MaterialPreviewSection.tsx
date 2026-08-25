import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  Type as TypeIcon,
  Plus,
  Layers,
} from 'lucide-react';
import MaterialThumbnail from './MaterialThumbnail';
import type { Material } from './useUpstreamMaterials';

/**
 * MaterialPreviewSection - 上游素材聚合预览区
 *
 * 职责:
 *   1. 分组渲染 (text / image / video / audio) 上游聚合素材 + 本地上传素材
 *   2. pointer 跨类型自由排序, onReorder 回调输出新 order 数组 (写到 data.materialOrder)
 *   3. 始终展开显示 (取消折叠功能, 头条仅作为分组标识 + 数量徽章)
 *   4. 双主题适配 (科技风 dark / 像素风 pixel-light), 通过 isDark + isPixel props 切换
 *
 * 调用方:
 *   - ImageNode (主战场, 含本地上传 + 多张参考图)
 *   - 后续 VideoNode / SeedanceNode / AudioNode / LLMNode / RunningHubNode 复用
 *
 * 与 xyflow 的协同:
 *   - 顶层 onMouseDown stopPropagation 防止触发节点拖动
 *   - 内部缩略加 className="nodrag"，并在 pointer 捕获阶段拦截 ReactFlow 节点拖动
 */

interface UploadAction {
  onClick: () => void;
  title?: string;
  remaining?: number;
}

interface Props {
  texts?: Material[];
  images?: Material[];
  videos?: Material[];
  audios?: Material[];
  /** 当前显示顺序 (data.materialOrder) */
  order: string[];
  /** 用户拖动后, 输出新 order */
  onReorder: (newOrder: string[]) => void;
  /** 仅 origin='local' 的素材会显示删除按钮, 点击触发本回调 */
  onRemoveLocal?: (m: Material) => void;
  /** origin='upstream' 的素材可从当前节点排除, 不会断开连线 */
  onExcludeUpstream?: (m: Material) => void;
  /** 当前节点已排除但仍存在的上游素材数量 */
  excludedCount?: number;
  /** 一键恢复当前节点排除的上游素材 */
  onRestoreExcluded?: () => void;
  /** 节点是否被 selected (兼容保留, 已不再用于折叠逻辑) */
  selected?: boolean;
  isDark: boolean;
  isPixel: boolean;
  /** 显示的分组及顺序, 默认 ['text','image','video','audio'] */
  groups?: ReadonlyArray<'text' | 'image' | 'video' | 'audio'>;
  /** 在 image 分组末尾追加 [+] 上传按钮 (仅 ImageNode 等需要本地上传的节点用) */
  imageUploadAction?: UploadAction;
  /** 自定义头部标题, 默认「上游素材」 */
  title?: string;
}

const ICON_MAP = {
  text: TypeIcon,
  image: ImageIcon,
  video: VideoIcon,
  audio: Music,
};
const MaterialPreviewSection = ({
  texts = [],
  images = [],
  videos = [],
  audios = [],
  order,
  onReorder,
  onRemoveLocal,
  onExcludeUpstream,
  excludedCount = 0,
  onRestoreExcluded,
  isDark,
  isPixel,
  groups = ['text', 'image', 'video', 'audio'],
  imageUploadAction,
  title,
}: Props) => {
  const { t } = useTranslation('nodes');
  const resolvedTitle = title || t('shared.upstreamMaterials');
  const labelMap = {
    text: t('shared.materialText'),
    image: t('shared.materialImage'),
    video: t('shared.materialVideo'),
    audio: t('shared.materialAudio'),
  };
  const total = texts.length + images.length + videos.length + audios.length;
  const sortScopeRef = useRef(`material-preview-${Math.random().toString(36).slice(2)}`);
  const [sortDrag, setSortDrag] = useState<{ activeId: string; overId: string | null; moved: boolean } | null>(null);
  const sortDragRef = useRef<{ activeId: string; overId: string | null; moved: boolean } | null>(null);
  const sortStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const sortWindowCleanupRef = useRef<(() => void) | null>(null);

  const allItems = useMemo(() => {
    const m: Record<string, Material[]> = {
      text: texts,
      image: images,
      video: videos,
      audio: audios,
    };
    return groups.flatMap((g) => m[g] || []);
  }, [groups, texts, images, videos, audios]);

  const setSortDragState = (next: typeof sortDrag) => {
    sortDragRef.current = next;
    setSortDrag(next);
  };

  const cleanupSortWindowListeners = () => {
    sortWindowCleanupRef.current?.();
    sortWindowCleanupRef.current = null;
  };

  const findSortOverId = (clientX: number, clientY: number): string | null => {
    const scope = sortScopeRef.current;
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      const thumb = el.closest(`[data-material-preview-section="${scope}"][data-material-preview-thumb-id]`) as HTMLElement | null;
      if (thumb) return thumb.dataset.materialPreviewThumbId || null;
    }
    return null;
  };

  const finishSortDrag = () => {
    const current = sortDragRef.current;
    if (!current) return;
    cleanupSortWindowListeners();
    if (current.moved && current.overId && current.activeId !== current.overId) {
      const ids = allItems.map((it) => it.id);
      const oldIdx = ids.indexOf(current.activeId);
      const newIdx = ids.indexOf(current.overId);
      if (oldIdx >= 0 && newIdx >= 0) {
        const moved = ids.slice();
        const [item] = moved.splice(oldIdx, 1);
        moved.splice(newIdx, 0, item);
        onReorder(moved);
      }
    }
    sortStartRef.current = null;
    setSortDragState(null);
  };

  const beginSortDrag = (event: PointerEvent<HTMLDivElement>, itemId: string) => {
    if (allItems.length <= 1) return;
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    event.stopPropagation();
    cleanupSortWindowListeners();
    sortStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    setSortDragState({ activeId: itemId, overId: itemId, moved: false });

    const onWindowMove = (nativeEvent: globalThis.PointerEvent) => {
      const current = sortDragRef.current;
      const start = sortStartRef.current;
      if (!current || !start) return;
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      const moved = current.moved || Math.hypot(nativeEvent.clientX - start.x, nativeEvent.clientY - start.y) >= 3;
      const overId = findSortOverId(nativeEvent.clientX, nativeEvent.clientY) || current.overId;
      if (moved !== current.moved || overId !== current.overId) {
        setSortDragState({ ...current, moved, overId });
      }
    };
    const onWindowUp = (nativeEvent: globalThis.PointerEvent) => {
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      finishSortDrag();
    };
    window.addEventListener('pointermove', onWindowMove, true);
    window.addEventListener('pointerup', onWindowUp, true);
    window.addEventListener('pointercancel', onWindowUp, true);
    sortWindowCleanupRef.current = () => {
      window.removeEventListener('pointermove', onWindowMove, true);
      window.removeEventListener('pointerup', onWindowUp, true);
      window.removeEventListener('pointercancel', onWindowUp, true);
    };
  };

  useEffect(() => () => cleanupSortWindowListeners(), []);

  // 没有任何素材也没有上传入口 → 不渲染
  if (total === 0 && !imageUploadAction && excludedCount <= 0) return null;

  // ============== 主题样式 ==============
  const headerStyle: React.CSSProperties = isPixel
    ? {
        background: '#67e8f9',
        color: '#1a1a1a',
        border: '1.5px solid #1a1a1a',
        boxShadow: '1px 1px 0 #1a1a1a',
        padding: '4px 8px',
        fontWeight: 700,
        fontSize: 11,
      }
    : {
        background: isDark ? 'rgba(20,184,166,.20)' : 'rgba(20,184,166,.15)',
        color: isDark ? '#5eead4' : '#0d9488',
        border: `1px solid ${isDark ? 'rgba(94,234,212,.35)' : 'rgba(13,148,136,.35)'}`,
        borderRadius: 6,
        padding: '4px 8px',
        fontWeight: 600,
        fontSize: 11,
      };
  const headerCountStyle: React.CSSProperties = isPixel
    ? {
        background: '#fde047',
        border: '1.5px solid #1a1a1a',
        color: '#1a1a1a',
        padding: '0 4px',
        fontSize: 10,
        lineHeight: '14px',
      }
    : {
        background: isDark ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.6)',
        borderRadius: 4,
        padding: '0 5px',
        fontSize: 10,
        lineHeight: '14px',
      };
  const restoreStyle: React.CSSProperties = isPixel
    ? {
        background: 'var(--px-card, #fefce8)',
        border: '1.5px solid var(--px-ink, #1a1a1a)',
        color: 'var(--px-ink, #1a1a1a)',
        padding: '1px 5px',
        fontSize: 10,
        fontWeight: 700,
        cursor: 'pointer',
      }
    : {
        background: isDark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.7)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'}`,
        borderRadius: 4,
        color: isDark ? 'rgba(255,255,255,.78)' : 'rgba(0,0,0,.7)',
        padding: '1px 6px',
        fontSize: 10,
        cursor: 'pointer',
      };

  const groupLabelStyle: React.CSSProperties = isPixel
    ? { color: '#1a1a1a', fontWeight: 700, fontSize: 10 }
    : { color: isDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)', fontSize: 10 };

  const uploadBtnStyle: React.CSSProperties = isPixel
    ? {
        width: 56,
        height: 56,
        background: '#fefce8',
        border: '1.5px dashed #1a1a1a',
        boxShadow: '1px 1px 0 #1a1a1a',
        color: '#1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }
    : {
        width: 56,
        height: 56,
        background: isDark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)',
        border: `2px dashed ${isDark ? 'rgba(255,255,255,.20)' : 'rgba(0,0,0,.20)'}`,
        borderRadius: 6,
        color: isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      };

  return (
    <div
      className="space-y-1.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ============== 标题头 (仅作为分组标识 + 数量徽章, 不再可折叠) ============== */}
      <div
        className="t8-material-preview-header w-full flex items-center gap-1.5 select-none"
        style={headerStyle}
      >
        <Layers size={12} />
        <span style={{ flex: 1, textAlign: 'left' }}>{resolvedTitle}</span>
        {excludedCount > 0 && onRestoreExcluded && (
          <button
            type="button"
            className="nodrag nopan"
            style={restoreStyle}
            title={t('shared.restoreExcluded')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRestoreExcluded();
            }}
          >
            {t('shared.restoreCount', { count: excludedCount })}
          </button>
        )}
        <span className="t8-material-preview-count" style={headerCountStyle}>{total}</span>
      </div>

      {/* ============== 内容区 - 分组 + pointer 排序 (始终展开) ============== */}
      {total > 0 || imageUploadAction ? (
        <>
          {groups.map((g) => {
            const list =
              g === 'text' ? texts : g === 'image' ? images : g === 'video' ? videos : audios;
            const showUpload = g === 'image' && imageUploadAction;
            if (!list.length && !showUpload) return null;
            const Ic = ICON_MAP[g];
            const indexOffset = (() => {
              let off = 0;
              for (const gg of groups) {
                if (gg === g) break;
                off += (gg === 'text' ? texts : gg === 'image' ? images : gg === 'video' ? videos : audios).length;
              }
              return off;
            })();
            return (
              <div key={g} className="space-y-1">
                <div className="t8-material-preview-group-label flex items-center gap-1" style={groupLabelStyle}>
                  <Ic size={10} />
                  <span>
                    {labelMap[g]} ({list.length}
                    {showUpload && imageUploadAction?.remaining != null
                      ? `/${list.length + imageUploadAction.remaining}`
                      : ''}
                    )
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((m, i) => (
                    <MaterialThumbnail
                      key={m.id}
                      material={m}
                      index={indexOffset + i}
                      isPixel={isPixel}
                      isDark={isDark}
                      draggable
                      sortScope={sortScopeRef.current}
                      isSorting={sortDrag?.activeId === m.id && !!sortDrag.moved}
                      isSortOver={!!sortDrag?.moved && sortDrag.overId === m.id && sortDrag.activeId !== m.id}
                      onSortPointerDown={(event) => beginSortDrag(event, m.id)}
                      removable={m.origin === 'local'}
                      onRemove={onRemoveLocal ? () => onRemoveLocal(m) : undefined}
                      excludeable={m.origin === 'upstream' && !!onExcludeUpstream}
                      onExclude={onExcludeUpstream ? () => onExcludeUpstream(m) : undefined}
                    />
                  ))}
                  {showUpload && imageUploadAction && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        imageUploadAction.onClick();
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="t8-material-preview-upload nodrag"
                      style={uploadBtnStyle}
                      title={imageUploadAction.title || t('shared.uploadLocal')}
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
};

export default memo(MaterialPreviewSection);
