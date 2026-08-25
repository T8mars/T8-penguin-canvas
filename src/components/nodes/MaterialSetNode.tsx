import { memo, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import {
  ArrowDownUp,
  Download,
  FileText,
  FileUp,
  Images,
  ListPlus,
  Music,
  PackageOpen,
  Pin,
  Plus,
  RotateCcw,
  Shuffle,
  SortAsc,
  Trash2,
  Upload as UploadIcon,
  Video,
} from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useThemeStore } from '../../stores/theme';
import { PORT_COLOR } from '../../config/portTypes';
import { useUpstreamMaterials, type Material, type MaterialKind } from './useUpstreamMaterials';
import CollectionSplitButton from '../CollectionSplitButton';
import SmartImage from '../SmartImage';
import {
  createUploadDataFromItem,
  fileNameFromUrl,
  type MediaItem,
} from '../../utils/mediaCollection';
import {
  isMaterialSetKind,
  createMaterialSetBackup,
  materialSetItemFromMedia,
  materialSetItemFromText,
  materialSetItemsToData,
  normalizeMaterialSetItems,
  parseMaterialSetBackup,
  valueOfMaterialSetItem,
  type MaterialSetItem,
  type MaterialSetKind,
} from '../../utils/materialSet';
import { defaultSizeOf, placeBatchNodes, type Rect as PlacementRect } from '../../utils/nodePlacement';
import NodeVisible from '../../i18n/NodeVisible';

const KIND_LABEL: Record<MaterialSetKind, string> = {
  text: '文本',
  image: '图像',
  video: '视频',
  audio: '音频',
};

const KIND_ACCEPT: Record<Exclude<MaterialSetKind, 'text'>, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
};

function inferFileKind(file: File): Exclude<MaterialSetKind, 'text'> | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

function materialFromSetItem(item: MaterialSetItem, nodeId: string): Material {
  const value = valueOfMaterialSetItem(item);
  return {
    id: item.id,
    kind: item.kind as MaterialKind,
    url: value,
    sourceNodeId: nodeId,
    origin: 'local',
    label: item.name || (item.kind === 'text' ? value.slice(0, 24) : fileNameFromUrl(value)),
  };
}

function materialSetItemFromUpstream(m: Material): MaterialSetItem {
  return {
    id: `ms-${m.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: m.kind,
    ...(m.kind === 'text' ? { text: m.url } : { url: m.url }),
    name: m.label || (m.kind === 'text' ? m.url.slice(0, 24) : fileNameFromUrl(m.url)),
  };
}

function arrayMoveLocal<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const MaterialSetNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const rf = useReactFlow();
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [textDraft, setTextDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sortDrag, setSortDrag] = useState<{ activeId: string; overId: string | null; moved: boolean } | null>(null);
  const sortDragRef = useRef<{ activeId: string; overId: string | null; moved: boolean } | null>(null);
  const sortStartRef = useRef<{ x: number; y: number; itemId: string; pointerId: number } | null>(null);
  const sortWindowCleanupRef = useRef<(() => void) | null>(null);

  const d = (data as any) || {};
  const kind: MaterialSetKind | null = isMaterialSetKind(d.materialSetKind) ? d.materialSetKind : null;
  const items = useMemo(
    () => (kind ? normalizeMaterialSetItems(d.materialSetItems, kind) : []),
    [d.materialSetItems, kind],
  );
  const materials = useMemo(() => items.map((item) => materialFromSetItem(item, id)), [items, id]);

  const upstream = useUpstreamMaterials(id);
  const upstreamCandidate = useMemo(() => {
    const buckets: Record<MaterialSetKind, Material[]> = {
      text: upstream.texts,
      image: upstream.images,
      video: upstream.videos,
      audio: upstream.audios,
    };
    if (kind) return { kind, list: buckets[kind] };
    const nonEmpty = (Object.keys(buckets) as MaterialSetKind[]).filter((k) => buckets[k].length > 0);
    return nonEmpty.length === 1 ? { kind: nonEmpty[0], list: buckets[nonEmpty[0]] } : null;
  }, [kind, upstream]);

  const commitItems = (nextKind: MaterialSetKind, nextItems: MaterialSetItem[]) => {
    update(materialSetItemsToData(nextKind, nextItems));
  };

  const switchKind = (nextKind: MaterialSetKind) => {
    if (nextKind === kind) return;
    if (items.length > 0 && !window.confirm('切换素材集类型会清空当前素材，确定继续？')) return;
    commitItems(nextKind, []);
  };

  const clearAll = () => {
    if (items.length > 0 && !window.confirm('清空当前素材集？')) return;
    if (kind) commitItems(kind, []);
    else update({ materialSetKind: null, materialSetItems: [] });
  };

  const setSortDragState = (next: typeof sortDrag) => {
    sortDragRef.current = next;
    setSortDrag(next);
  };

  const cleanupSortWindowListeners = () => {
    sortWindowCleanupRef.current?.();
    sortWindowCleanupRef.current = null;
  };

  const findSortOverId = (clientX: number, clientY: number): string | null => {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      const thumb = el.closest(`[data-material-set-node="${id}"][data-material-set-thumb-id]`) as HTMLElement | null;
      if (thumb) return thumb.dataset.materialSetThumbId || null;
    }
    return null;
  };

  const beginSortDrag = (event: PointerEvent<HTMLDivElement>, itemId: string) => {
    if (!kind || items.length <= 1) return;
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    cleanupSortWindowListeners();
    sortStartRef.current = { x: event.clientX, y: event.clientY, itemId, pointerId: event.pointerId };
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

  const moveSortDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = sortDragRef.current;
    const start = sortStartRef.current;
    if (!current || !start) return;
    event.preventDefault();
    event.stopPropagation();
    const moved = current.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 3;
    const overId = findSortOverId(event.clientX, event.clientY) || current.overId;
    if (moved !== current.moved || overId !== current.overId) {
      setSortDragState({ ...current, moved, overId });
    }
  };

  const endSortDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = sortStartRef.current;
    if (start) event.currentTarget.releasePointerCapture?.(start.pointerId);
    event.preventDefault();
    event.stopPropagation();
    finishSortDrag();
  };

  const finishSortDrag = () => {
    const current = sortDragRef.current;
    if (!current) return;
    cleanupSortWindowListeners();
    if (kind && current.moved && current.overId && current.activeId !== current.overId) {
      const oldIndex = items.findIndex((item) => item.id === current.activeId);
      const newIndex = items.findIndex((item) => item.id === current.overId);
      if (oldIndex >= 0 && newIndex >= 0) commitItems(kind, arrayMoveLocal(items, oldIndex, newIndex));
    }
    sortStartRef.current = null;
    setSortDragState(null);
  };

  const cancelSortDrag = () => {
    cleanupSortWindowListeners();
    sortStartRef.current = null;
    setSortDragState(null);
  };

  const removeItem = (itemId: string) => {
    if (!kind) return;
    commitItems(kind, items.filter((item) => item.id !== itemId));
  };

  const reorderItems = (mode: 'reverse' | 'name' | 'random') => {
    if (!kind || items.length <= 1) return;
    let next = items.slice();
    if (mode === 'reverse') {
      next = next.reverse();
    } else if (mode === 'name') {
      next = next.sort((a, b) => {
        const av = a.name || valueOfMaterialSetItem(a);
        const bv = b.name || valueOfMaterialSetItem(b);
        return av.localeCompare(bv, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      });
    } else {
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
    }
    commitItems(kind, next);
  };

  const exportJson = () => {
    if (!kind || items.length === 0) return;
    const backup = createMaterialSetBackup(kind, items, `${KIND_LABEL[kind]}素材集`);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `t8-material-set-${kind}-${Date.now()}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
  };

  const importJson = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = parseMaterialSetBackup(JSON.parse(String(reader.result || '{}')));
        if (!backup) throw new Error('不是有效的素材集 JSON');
        if (items.length > 0 && !window.confirm('导入素材集会覆盖当前内容，确定继续？')) return;
        commitItems(backup.materialSetKind, backup.materialSetItems);
        setError(null);
      } catch (err: any) {
        setError(err?.message || '素材集 JSON 导入失败');
      }
    };
    reader.onerror = () => setError('素材集 JSON 读取失败');
    reader.readAsText(file, 'utf-8');
  };

  const addText = () => {
    const lines = textDraft
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const newItems = lines.map(materialSetItemFromText).filter(Boolean) as MaterialSetItem[];
    if (newItems.length === 0) return;
    commitItems('text', [...(kind === 'text' ? items : []), ...newItems]);
    setTextDraft('');
  };

  const uploadSingleFile = async (file: File, fileKind: Exclude<MaterialSetKind, 'text'>): Promise<MaterialSetItem> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `上传失败 HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !json.data?.url) throw new Error(json.error || '上传失败:未返回 URL');
    return materialSetItemFromMedia(fileKind, {
      url: json.data.url,
      name: file.name,
      size: file.size,
      mime: file.type,
    });
  };

  const prepareFiles = async (rawFiles: File[]) => {
    const files = rawFiles.filter(Boolean);
    if (files.length === 0) return;
    const inferred = (kind && kind !== 'text' ? kind : files.map(inferFileKind).find(Boolean)) || null;
    if (!inferred) {
      setError('只能加入图像 / 视频 / 音频文件');
      return;
    }
    const accepted = files.filter((file) => inferFileKind(file) === inferred);
    if (accepted.length === 0) {
      setError(`文件类型不匹配：当前素材集是${KIND_LABEL[inferred]}`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploaded: MaterialSetItem[] = [];
      for (const file of accepted) uploaded.push(await uploadSingleFile(file, inferred));
      commitItems(inferred, [...(kind === inferred ? items : []), ...uploaded]);
      if (accepted.length !== files.length) setError(`已加入 ${accepted.length} 项，跳过 ${files.length - accepted.length} 个非同类型文件`);
    } catch (err: any) {
      setError(err?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    void prepareFiles(files);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void prepareFiles(Array.from(e.dataTransfer?.files || []));
  };

  const collectUpstream = () => {
    if (!upstreamCandidate || upstreamCandidate.list.length === 0) {
      setError('没有可收集的同类型上游素材');
      return;
    }
    const nextKind = upstreamCandidate.kind;
    const existing = kind === nextKind ? items : [];
    const seen = new Set(existing.map((item) => `${item.kind}:${valueOfMaterialSetItem(item)}`));
    const appended = upstreamCandidate.list
      .filter((m) => {
        const key = `${m.kind}:${m.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(materialSetItemFromUpstream);
    if (appended.length === 0) {
      setError('上游素材已在素材集中');
      return;
    }
    commitItems(nextKind, [...existing, ...appended]);
    setError(null);
  };

  const splitMaterialSet = () => {
    if (!kind || items.length <= 1) return;
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 320;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 280;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const type = kind === 'text' ? 'text' : 'upload';
    const sz = defaultSizeOf(type);
    const COLS = 3;
    const COL_W = kind === 'text' ? 320 : 300;
    const ROW_H = Math.max(kind === 'text' ? 220 : 260, myH / 2);
    const desired: PlacementRect[] = items.map((_, index) => ({
      x: baseX + (index % COLS) * COL_W,
      y: baseY + Math.floor(index / COLS) * ROW_H,
      w: sz.w,
      h: sz.h,
    }));
    const off = placeBatchNodes(desired, rf.getNodes(), { source: `placement:split-material-set:${id}` });
    const stamp = Date.now();
    const newNodes: Node[] = items.map((item, index) => {
      const value = valueOfMaterialSetItem(item);
      const dataPatch =
        kind === 'text'
          ? { prompt: value }
          : createUploadDataFromItem({
              kind: kind as Exclude<MaterialSetKind, 'text'>,
              url: value,
              name: item.name || fileNameFromUrl(value),
              size: item.size,
              mime: item.mime,
            } as MediaItem);
      return {
        id: `${type}-split-set-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        position: { x: desired[index].x + off.dx, y: desired[index].y + off.dy },
        data: dataPatch,
        selected: false,
      } as Node;
    });
    rf.addNodes(newNodes);
  };

  const accent = kind ? PORT_COLOR[kind] : PORT_COLOR.any;
  const targetTitle = '可接入文本 / 图像 / 视频 / 音频，上游同类型可收集到素材集';
  const sourceTitle = kind ? `输出${KIND_LABEL[kind]}素材集` : '请先加入素材';

  return (
    <NodeVisible>
      <div
      className="relative rounded-xl border-2 transition-colors"
      style={{
        width: 320,
        minHeight: 220,
        background: isDark ? 'rgba(20,20,22,.94)' : 'rgba(255,255,255,.96)',
        borderColor: selected ? accent : isDark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.12)',
        color: isDark ? '#fff' : '#111827',
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 14px 30px ${accent}22` : undefined,
        backdropFilter: isPixel ? undefined : 'blur(8px)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-0"
        style={{ background: accent, width: 11, height: 11 }}
        title={targetTitle}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!border-0"
        style={{ background: accent, width: 11, height: 11 }}
        title={sourceTitle}
      />

      <div className={`flex items-center gap-2 border-b px-3 py-2 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div
          className="flex h-7 w-7 items-center justify-center rounded"
          style={{ background: `${accent}26`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}66` }}
        >
          <Images size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">素材集</div>
          <div className={`text-[10px] ${isDark ? 'text-white/45' : 'text-zinc-500'}`}>
            {kind ? `${KIND_LABEL[kind]} · ${items.length} 项` : '选择类型或收集上游素材'}
          </div>
        </div>
        {kind && (
          <CollectionSplitButton
            count={items.length}
            kindLabel={KIND_LABEL[kind]}
            onSplit={splitMaterialSet}
            confirmThreshold={8}
          />
        )}
        <button
          type="button"
          className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/10"
          title="清空素材集"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            clearAll();
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="space-y-2 p-2.5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-4 gap-1">
          {(['image', 'video', 'audio', 'text'] as MaterialSetKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className="nodrag nopan rounded border px-1 py-1 text-[11px] font-semibold"
              style={{
                borderColor: kind === k ? PORT_COLOR[k] : isDark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.14)',
                background: kind === k ? `${PORT_COLOR[k]}30` : 'transparent',
                color: kind === k ? PORT_COLOR[k] : undefined,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                switchKind(k);
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept={kind && kind !== 'text' ? KIND_ACCEPT[kind] : 'image/*,video/*,audio/*'}
          onChange={handleFileChange}
        />
        <input
          ref={jsonInputRef}
          type="file"
          className="hidden"
          accept="application/json,.json"
          onChange={importJson}
        />

        {kind !== 'text' && (
          <div
            className={`nodrag nopan flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed px-3 py-2 text-[11px] ${
              isDark ? 'text-white/55' : 'text-zinc-500'
            }`}
            style={{ borderColor: dragActive ? accent : undefined }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <UploadIcon size={13} style={{ color: accent }} />
            {uploading ? '上传中...' : kind ? `添加${KIND_LABEL[kind]}文件` : '拖入或选择同类型素材'}
          </div>
        )}

        {kind === 'text' && (
          <div className="space-y-1">
            <textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              rows={3}
              placeholder="每行作为一条文本素材..."
              className="nodrag nowheel w-full resize-none rounded border bg-transparent px-2 py-1.5 text-[12px] outline-none"
              style={{ borderColor: isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.16)' }}
            />
            <button type="button" className="t8-btn h-8 w-full gap-1.5 text-[12px]" onClick={addText}>
              <Plus size={13} /> 添加文本
            </button>
          </div>
        )}

        {upstreamCandidate && upstreamCandidate.list.length > 0 && (
          <button
            type="button"
            className="t8-btn h-8 w-full gap-1.5 text-[12px]"
            onClick={collectUpstream}
            title="把连入素材按当前上游顺序收集到素材集"
          >
            <ListPlus size={13} />
            收集上游 {KIND_LABEL[upstreamCandidate.kind]} ({upstreamCandidate.list.length})
          </button>
        )}

        <div className="space-y-1">
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              className="nodrag nopan rounded border px-1 py-1 text-[10px] font-semibold disabled:opacity-40"
              disabled={!kind || items.length <= 1}
              onClick={() => reorderItems('reverse')}
              title="反转当前素材顺序"
            >
              <ArrowDownUp size={12} className="mx-auto" />
            </button>
            <button
              type="button"
              className="nodrag nopan rounded border px-1 py-1 text-[10px] font-semibold disabled:opacity-40"
              disabled={!kind || items.length <= 1}
              onClick={() => reorderItems('name')}
              title="按文件名 / 文本名排序"
            >
              <SortAsc size={12} className="mx-auto" />
            </button>
            <button
              type="button"
              className="nodrag nopan rounded border px-1 py-1 text-[10px] font-semibold disabled:opacity-40"
              disabled={!kind || items.length <= 1}
              onClick={() => reorderItems('random')}
              title="随机打乱顺序"
            >
              <Shuffle size={12} className="mx-auto" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              className="nodrag nopan flex h-8 items-center justify-center gap-1 rounded border px-2 text-[11px] font-semibold"
              onClick={() => jsonInputRef.current?.click()}
              title="导入 t8-material-set 素材集 JSON"
            >
              <FileUp size={13} />
              <span>导入素材集</span>
            </button>
            <button
              type="button"
              className="nodrag nopan flex h-8 items-center justify-center gap-1 rounded border px-2 text-[11px] font-semibold disabled:opacity-40"
              disabled={!kind || items.length === 0}
              onClick={exportJson}
              title="导出 t8-material-set 素材集 JSON"
            >
              <Download size={13} />
              <span>导出素材集</span>
            </button>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="flex max-h-[230px] flex-wrap gap-1.5 overflow-y-auto rounded border p-2 nowheel"
            style={{ borderColor: isDark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.08)' }}>
            {materials.map((material, index) => {
              const isActive = sortDrag?.activeId === material.id;
              const isOver = !!sortDrag?.moved && sortDrag.overId === material.id && !isActive;
              return (
                <div
                  key={material.id}
                  data-material-set-node={id}
                  data-material-set-thumb-id={material.id}
                  className="nodrag nopan"
                  title={material.label || material.url}
                  style={{
                    width: 58,
                    height: 58,
                    flex: '0 0 auto',
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: isPixel ? 0 : 7,
                    border: isPixel ? '1.5px solid var(--px-ink, #1a1a1a)' : `1px solid ${isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'}`,
                    boxShadow: isPixel ? '1px 1px 0 var(--px-ink, #1a1a1a)' : undefined,
                    cursor: isActive ? 'grabbing' : 'grab',
                    opacity: isActive && sortDrag?.moved ? 0.58 : 1,
                    outline: isOver ? `2px solid ${accent}` : 'none',
                    outlineOffset: 2,
                    transition: 'opacity 120ms ease, outline-color 120ms ease',
                    touchAction: 'none',
                    userSelect: 'none',
                    background: isDark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)',
                  }}
                  onPointerDownCapture={(event) => beginSortDrag(event, material.id)}
                  onPointerMoveCapture={moveSortDrag}
                  onPointerUpCapture={endSortDrag}
                  onPointerCancelCapture={cancelSortDrag}
                  onDragStart={(event) => event.preventDefault()}
                >
                  {material.kind === 'image' ? (
                    <SmartImage
                      src={material.url}
                      alt={material.label || ''}
                      draggable={false}
                      thumbSize={220}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none', userSelect: 'none' }}
                    />
                  ) : material.kind === 'video' ? (
                    <div className="flex h-full w-full items-center justify-center bg-black">
                      <Video size={20} color="#cbd5e1" />
                    </div>
                  ) : material.kind === 'audio' ? (
                    <div className="flex h-full w-full items-center justify-center" style={{ background: isPixel ? 'var(--px-yellow, #fde047)' : isDark ? 'rgba(20,184,166,.18)' : 'rgba(20,184,166,.12)' }}>
                      <Music size={20} color={isPixel ? '#1a1a1a' : '#5eead4'} />
                    </div>
                  ) : (
                    <div
                      className="flex h-full w-full items-start overflow-hidden px-1 py-1 text-[9px] leading-tight"
                      style={{ background: isPixel ? 'var(--px-card, #fefce8)' : isDark ? 'rgba(99,102,241,.14)' : 'rgba(99,102,241,.10)' }}
                    >
                      <FileText size={9} className="mr-0.5 mt-0.5 shrink-0" />
                      <span className="line-clamp-4 break-all">{material.label || material.url}</span>
                    </div>
                  )}
                  <div
                    className="pointer-events-none absolute left-0 top-0 flex h-[14px] min-w-[14px] items-center justify-center px-[3px] text-[9px] font-bold leading-none"
                    style={{
                      background: isPixel ? 'var(--px-yellow, #fde047)' : 'rgba(0,0,0,.6)',
                      color: isPixel ? '#1a1a1a' : '#fff',
                      borderRight: isPixel ? '1.5px solid #1a1a1a' : undefined,
                      borderBottom: isPixel ? '1.5px solid #1a1a1a' : undefined,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div
                    className="pointer-events-none absolute right-0 top-0 flex h-[14px] w-[14px] items-center justify-center"
                    style={{
                      background: isPixel ? 'var(--px-card, #fefce8)' : 'rgba(0,0,0,.6)',
                      color: isPixel ? '#1a1a1a' : '#fff',
                      borderLeft: isPixel ? '1.5px solid #1a1a1a' : undefined,
                      borderBottom: isPixel ? '1.5px solid #1a1a1a' : undefined,
                    }}
                  >
                    <Pin size={8} />
                  </div>
                  <button
                    type="button"
                    className="nodrag nopan absolute bottom-0 right-0 flex h-[14px] w-[14px] items-center justify-center border-0 bg-red-500 p-0 text-white"
                    title="移除本地素材"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeItem(material.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`flex items-center justify-center gap-1.5 rounded border border-dashed px-3 py-6 text-[11px] ${isDark ? 'text-white/35' : 'text-zinc-400'}`}>
            <PackageOpen size={14} />
            暂无素材
          </div>
        )}

        {error && (
          <div className="flex items-center justify-between gap-2 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-200">
            <span className="min-w-0 flex-1 break-all">{error}</span>
            <button type="button" className="nodrag nopan" onClick={() => setError(null)}>
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>
      </div>
    </NodeVisible>
  );
};

export default memo(MaterialSetNode);
