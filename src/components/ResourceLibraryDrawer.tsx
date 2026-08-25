import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  FolderPlus,
  FileText,
  Globe2,
  Image as ImageIcon,
  Library,
  Music,
  PackageOpen,
  Pencil,
  PersonStanding,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  UserRoundCog,
  Upload,
  Video,
  Workflow,
  X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { localizeApiError } from '../i18n/apiErrors';
import { useThemeStore } from '../stores/theme';
import * as api from '../services/api';
import type { ResourceAddKind, ResourceCategory, ResourceItem, ResourceKind } from '../services/api';
import { isPortraitResourceItem } from '../utils/portraitResource';
import { resourceItemToSendMaterials } from '../utils/sendMaterials';
import { summarizeWorkflowResource } from '../utils/workflowResource';
import LoopingVideo from './LoopingVideo';
import SmartImage from './SmartImage';

const KIND_META: Record<ResourceKind, { labelKey: string; icon: typeof ImageIcon; accent: string }> = {
  image: { labelKey: 'kinds.image', icon: ImageIcon, accent: '#fbbf24' },
  video: { labelKey: 'kinds.video', icon: Video, accent: '#fb7185' },
  audio: { labelKey: 'kinds.audio', icon: Music, accent: '#a78bfa' },
  panorama: { labelKey: 'kinds.panorama', icon: Globe2, accent: '#38bdf8' },
  set: { labelKey: 'kinds.set', icon: PackageOpen, accent: '#2dd4bf' },
  pose: { labelKey: 'kinds.pose', icon: PersonStanding, accent: '#fb923c' },
  workflow: { labelKey: 'kinds.workflow', icon: Workflow, accent: '#60a5fa' },
};

const LOCAL_UPLOAD_ACCEPT: Record<ResourceAddKind, string> = {
  image: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif',
  video: 'video/mp4,video/webm,video/quicktime,video/x-m4v,video/x-matroska,video/x-msvideo',
  audio: 'audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/aac',
  panorama: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif',
};

function isLocalUploadKind(kind: ResourceKind): kind is ResourceAddKind {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'panorama';
}

function localUploadTitle(file: File, fallback: string) {
  const raw = file.name || fallback;
  const withoutExt = raw.replace(/\.[^/.]+$/, '').trim();
  return (withoutExt || raw).slice(0, 120);
}

function resourceItemDragKind(item: ResourceItem) {
  return item.kind === 'panorama' ? 'image' : item.kind;
}

interface ResourceLibraryDrawerProps {
  open: boolean;
  onClose: () => void;
  onInsertMaterial: (item: ResourceItem) => void | Promise<void>;
}

function formatSize(size: number, locale: string) {
  if (!Number.isFinite(size) || size <= 0) return '';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (size < 1024 * 1024) return `${number.format(size / 1024)} KB`;
  return `${number.format(size / 1024 / 1024)} MB`;
}

function materialSetLabel(kind: string | undefined, t: TFunction<'resources'>) {
  if (kind === 'image') return t('setKinds.image');
  if (kind === 'video') return t('setKinds.video');
  if (kind === 'audio') return t('setKinds.audio');
  if (kind === 'text') return t('setKinds.text');
  return t('setKinds.material');
}

type WorkflowPreview = NonNullable<ResourceItem['workflowPreview']>;

function workflowNodeColor(type: string) {
  if (type === 'image' || type === 'edit') return '#fbbf24';
  if (type === 'video' || type === 'seedance') return '#fb7185';
  if (type === 'audio') return '#a78bfa';
  if (type === 'llm') return '#86efac';
  if (type === 'output') return '#f97316';
  if (type === 'upload' || type === 'material-set') return '#2dd4bf';
  if (type === 'pose-master' || type === 'portrait-master') return '#38bdf8';
  return '#f8fafc';
}

function workflowNodeShortLabel(type: string, label: string, t: TFunction<'resources'>) {
  if (type === 'image') return t('shortLabels.image');
  if (type === 'video') return t('shortLabels.video');
  if (type === 'seedance') return 'SD';
  if (type === 'audio') return t('shortLabels.audio');
  if (type === 'llm') return 'AI';
  if (type === 'output') return t('shortLabels.output');
  if (type === 'upload') return t('shortLabels.upload');
  if (type === 'material-set') return t('shortLabels.set');
  if (type === 'pose-master') return t('shortLabels.pose');
  if (type === 'portrait-master') return t('shortLabels.portrait');
  return Array.from(label || type || '?').slice(0, 2).join('');
}

function WorkflowTopologyCard({ item, accent }: { item: ResourceItem; accent: string }) {
  const { t } = useTranslation('resources');
  const preview = item.workflowPreview as WorkflowPreview | undefined;
  const markerId = `workflow-arrow-${String(item.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  if (!preview?.nodes?.length) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5">
        <Workflow size={32} className="text-white drop-shadow" />
        <div className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white">
          {summarizeWorkflowResource(item)}
        </div>
      </div>
    );
  }
  const nodeMap = new Map(preview.nodes.map((node) => [node.id, node]));
  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" role="img" aria-label={t('workflow.topologyAria', { title: item.title })}>
        <defs>
          <pattern id={`${markerId}-grid`} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="0.6" />
          </pattern>
          <marker id={markerId} markerWidth="4" markerHeight="4" refX="3.3" refY="2" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 4 2 L 0 4 z" fill="rgba(255,255,255,.78)" />
          </marker>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill={`url(#${markerId}-grid)`} opacity="0.8" />
        {preview.edges.map((edge, index) => {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);
          if (!source || !target) return null;
          const midX = (source.x + target.x) / 2;
          const bend = source.y === target.y ? 0 : (target.y > source.y ? -7 : 7);
          return (
            <path
              key={`${edge.source}-${edge.target}-${index}`}
              d={`M ${source.x} ${source.y} Q ${midX} ${(source.y + target.y) / 2 + bend} ${target.x} ${target.y}`}
              fill="none"
              stroke="rgba(255,255,255,.76)"
              strokeWidth="2.2"
              strokeLinecap="round"
              markerEnd={`url(#${markerId})`}
            />
          );
        })}
        {preview.nodes.map((node) => {
          const color = workflowNodeColor(node.type);
          return (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r="8.6" fill="rgba(0,0,0,.44)" stroke="rgba(255,255,255,.72)" strokeWidth="1" />
              <circle cx={node.x} cy={node.y} r="6.8" fill={color} stroke="rgba(0,0,0,.38)" strokeWidth="1" />
              <text x={node.x} y={node.y + 2.4} textAnchor="middle" fontSize="5.4" fontWeight="800" fill="#0f172a">
                {workflowNodeShortLabel(node.type, node.label, t)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="absolute left-1.5 top-1.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
        {t('workflow.topology')}
      </div>
      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold text-white">
        <span className="truncate">{summarizeWorkflowResource(item)}</span>
        <span className="shrink-0 rounded-full px-1.5 py-0.5" style={{ background: accent, color: '#07111f' }}>
          {preview.nodes.length}
        </span>
      </div>
    </div>
  );
}

function resultData<T>(r: api.Result<T> | any): T | null {
  return r?.success ? (r.data as T) : null;
}

function stopResourceControlEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

type CategoryDialogState =
  | { mode: 'add'; kind: ResourceKind; label: string; value: string }
  | { mode: 'rename'; category: ResourceCategory; label: string; value: string };

type ItemRenameDialogState = { item: ResourceItem; value: string };

export default function ResourceLibraryDrawer({ open, onClose, onInsertMaterial }: ResourceLibraryDrawerProps) {
  const { t, i18n } = useTranslation('resources');
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const [kind, setKind] = useState<ResourceKind>('image');
  const [categoryId, setCategoryId] = useState('all');
  const [q, setQ] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [categories, setCategories] = useState<ResourceCategory[]>([]);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [hoverPreview, setHoverPreview] = useState<{ src: string; title: string; left: number; top: number } | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState | null>(null);
  const [itemRenameDialog, setItemRenameDialog] = useState<ItemRenameDialogState | null>(null);
  const [uploadingLocal, setUploadingLocal] = useState(false);
  const localUploadInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    const [catRes, itemRes] = await Promise.all([
      api.getResourceCategories(kind),
      api.getResourceItems({ kind, categoryId, q, favorite: favoriteOnly }),
    ]);
    const nextCats = resultData<ResourceCategory[]>(catRes);
    const nextItems = resultData<ResourceItem[]>(itemRes);
    const filteredCats = nextCats ? nextCats.filter((cat) => cat.kind === kind) : null;
    const filteredItems = nextItems ? nextItems.filter((item) => item.kind === kind) : null;
    if (filteredCats) setCategories(filteredCats);
    if (filteredItems) setItems(filteredItems);
    if (!nextCats || !nextItems) {
      setMsg(localizeApiError(!nextCats ? catRes : itemRes, { fallback: t('messages.loadFailed') }));
    } else if (kind === 'panorama' && nextCats.length > 0 && filteredCats?.length === 0) {
      setMsg(t('messages.panoramaBackendRestart'));
    }
    setLoading(false);
  }, [open, kind, categoryId, q, favoriteOnly, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onChanged = () => load();
    window.addEventListener('penguin:resources-changed', onChanged);
    return () => window.removeEventListener('penguin:resources-changed', onChanged);
  }, [open, load]);

  useEffect(() => {
    setCategoryId('all');
    setFavoriteOnly(false);
    setCategoryDialog(null);
    setItemRenameDialog(null);
  }, [kind]);

  const activeMeta = KIND_META[kind];
  const ActiveIcon = activeMeta.icon;
  const activeMetaLabel = t(activeMeta.labelKey);
  const totalText = useMemo(() => t('count', { count: items.length }), [items.length, t]);
  const localUploadSupported = isLocalUploadKind(kind);
  const localUploadCategory = categoryId !== 'all' ? categories.find((cat) => cat.id === categoryId) : undefined;
  const localUploadCategoryId = localUploadSupported && categoryId !== 'all' ? categoryId : '';
  const localUploadAccept = localUploadSupported ? LOCAL_UPLOAD_ACCEPT[kind] : '';
  const localUploadTargetLabel = localUploadCategory?.name || t('currentCategory');

  const openAddCategoryDialog = () => {
    setMsg('');
    setCategoryDialog({ mode: 'add', kind, label: activeMetaLabel, value: '' });
  };

  const openRenameCategoryDialog = (cat: ResourceCategory) => {
    if (cat.system) return;
    setMsg('');
    setCategoryDialog({ mode: 'rename', category: cat, label: cat.name, value: cat.name });
  };

  const submitCategoryDialog = async () => {
    if (!categoryDialog) return;
    const name = categoryDialog.value.trim();
    if (!name) {
      setMsg(t('messages.categoryNameRequired'));
      return;
    }
    if (categoryDialog.mode === 'add') {
      const r = await api.addResourceCategory(categoryDialog.kind, name);
      if (r.success) {
        setMsg(t('messages.categoryCreated', { name }));
        setCategoryId(r.data.id);
        setCategoryDialog(null);
        await load();
      } else {
        setMsg(localizeApiError(r, { fallback: t('messages.categoryCreateFailed') }));
      }
      return;
    }
    if (name === categoryDialog.category.name) {
      setCategoryDialog(null);
      return;
    }
    const r = await api.renameResourceCategory(categoryDialog.category.id, name);
    if (r.success) {
      setMsg(t('messages.categoryRenamed'));
      setCategoryDialog(null);
    } else {
      setMsg(localizeApiError(r, { fallback: t('messages.categoryRenameFailed') }));
    }
    await load();
  };

  const removeCategory = async (cat: ResourceCategory) => {
    if (cat.system) return;
    if (!window.confirm(t('messages.categoryDeleteConfirm', { name: cat.name }))) return;
    const r = await api.deleteResourceCategory(cat.id);
    setMsg(r.success ? t('messages.categoryDeleted') : localizeApiError(r, { fallback: t('messages.categoryDeleteFailed') }));
    if (categoryId === cat.id) setCategoryId('all');
    await load();
  };

  const updateItem = async (item: ResourceItem, patch: Parameters<typeof api.updateResourceItem>[1]) => {
    const r = await api.updateResourceItem(item.id, patch);
    if (r.success) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? r.data : x)));
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
      return true;
    } else {
      setMsg(localizeApiError(r, { fallback: t('messages.itemUpdateFailed') }));
      return false;
    }
  };

  const openItemRenameDialog = (item: ResourceItem) => {
    setMsg('');
    setItemRenameDialog({ item, value: item.title });
  };

  const submitItemRenameDialog = async () => {
    if (!itemRenameDialog) return;
    const title = itemRenameDialog.value.trim();
    if (!title) {
      setMsg(t('messages.resourceNameRequired'));
      return;
    }
    if (title === itemRenameDialog.item.title) {
      setItemRenameDialog(null);
      return;
    }
    const ok = await updateItem(itemRenameDialog.item, { title });
    if (ok) setItemRenameDialog(null);
  };

  const handleLocalUploadButtonClick = () => {
    if (!localUploadSupported) {
      setMsg(t('messages.uploadUnsupported', { kind: activeMetaLabel }));
      return;
    }
    if (!localUploadCategoryId) {
      setMsg(t('messages.selectCategoryBeforeUpload'));
      return;
    }
    localUploadInputRef.current?.click();
  };

  const handleLocalUploadFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (!localUploadSupported || !localUploadCategoryId) {
      setMsg(t('messages.selectCategoryBeforeUpload'));
      return;
    }
    const uploadKind = kind;
    const uploadTargetName = localUploadTargetLabel;
    setUploadingLocal(true);
    setMsg(t('messages.uploading', { count: files.length, name: uploadTargetName }));
    let saved = 0;
    let duplicates = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        const uploaded = await api.uploadResourceLocalFile(file);
        const added = await api.addResourceItem({
          url: uploaded.url,
          kind: uploadKind,
          categoryId: localUploadCategoryId,
          title: localUploadTitle(file, t('localAsset')),
        });
        if (added.success) {
          saved += 1;
          if (added.data.duplicate) duplicates += 1;
        } else {
          failures.push(`${file.name}: ${localizeApiError(added, { fallback: t('messages.ingestFailed') })}`);
        }
      } catch (e: any) {
        failures.push(`${file.name}: ${localizeApiError(e, { fallback: t('messages.uploadFailed') })}`);
      }
    }
    if (saved > 0) {
      await load();
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
    }
    const duplicateText = duplicates > 0 ? t('messages.duplicateSuffix', { count: duplicates }) : '';
    if (failures.length > 0) {
      setMsg(t('messages.uploadPartial', { saved, duplicateText, failed: failures.length, details: failures.slice(0, 2).join('；') }));
    } else {
      setMsg(t('messages.uploadSuccess', { saved, name: uploadTargetName, duplicateText }));
    }
    setUploadingLocal(false);
  };

  const deleteItem = async (item: ResourceItem) => {
    if (!window.confirm(t('messages.itemDeleteConfirm', { name: item.title }))) return;
    const r = await api.deleteResourceItem(item.id);
    if (r.success) {
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      setMsg(t('messages.itemDeleted'));
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
    } else {
      setMsg(localizeApiError(r, { fallback: t('messages.itemDeleteFailed') }));
    }
  };

  const insertItem = async (item: ResourceItem) => {
    try {
      await onInsertMaterial(item);
      await api.updateResourceItem(item.id, { touch: true });
      setMsg(item.kind === 'pose' ? t('messages.poseRestored') : item.kind === 'workflow' ? t('messages.workflowInserted') : t('messages.canvasInserted'));
    } catch (e: any) {
      setMsg(localizeApiError(e, { fallback: t('messages.insertFailed') }));
    }
  };

  const sendItem = async (item: ResourceItem) => {
    const materials = resourceItemToSendMaterials(item);
    if (materials.length === 0) {
      setMsg(t('messages.noSendable'));
      return;
    }
    window.dispatchEvent(new CustomEvent('penguin:open-send-materials', {
      detail: {
        materials,
        sourceLabel: t('messages.sendSource', { title: item.title }),
        defaultMode: item.kind === 'set' ? 'material-set' : 'upload',
      },
    }));
    await api.updateResourceItem(item.id, { touch: true });
  };

  const showImagePreview = useCallback((target: HTMLButtonElement, item: ResourceItem) => {
    const src = item.fileUrl || item.thumbUrl;
    if (!src) return;
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth || 1200;
    const viewportHeight = window.innerHeight || 800;
    const previewWidth = Math.min(320, Math.max(240, viewportWidth - 24));
    const previewHeight = 380;
    const gap = 10;
    let left = rect.left - previewWidth - gap;
    if (left < 12) {
      left = Math.min(rect.right + gap, viewportWidth - previewWidth - 12);
    }
    let top = rect.top - 4;
    if (top + previewHeight > viewportHeight - 12) {
      top = Math.max(12, viewportHeight - previewHeight - 12);
    }
    setHoverPreview({
      src,
      title: item.title || t('messages.imagePreview'),
      left,
      top,
    });
  }, [t]);

  const hideImagePreview = useCallback(() => {
    setHoverPreview(null);
  }, []);

  if (!open) return null;

  const panelCls = isPixel
    ? 'bg-[var(--px-surface)] text-[var(--px-ink)] border-l-2 border-[var(--px-ink)]'
    : isDark
      ? 'bg-zinc-950 text-zinc-100 border-l border-white/10'
      : 'bg-white text-zinc-900 border-l border-black/10';
  const inputCls = isPixel
    ? 'px-input h-9 text-sm'
    : `h-9 px-3 rounded-md border text-sm outline-none ${
        isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30' : 'bg-black/5 border-black/10 text-zinc-900 placeholder:text-zinc-400'
      }`;
  const subtle = isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/45' : 'text-zinc-500';
  const itemBtn = isPixel
    ? 'px-btn px-btn--sm'
    : `px-2 py-1 rounded-md text-xs border ${isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`;
  const miniActionBase: CSSProperties = {
    width: 28,
    height: 28,
    minWidth: 28,
    padding: 0,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 28px',
    border: isPixel ? '2px solid var(--px-ink, #1A1410)' : `1px solid ${isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.22)'}`,
    background: isPixel ? 'var(--px-surface, #fff)' : isDark ? 'rgba(255,255,255,.06)' : '#fffdf6',
    color: isPixel ? 'var(--px-ink, #1A1410)' : isDark ? '#f8fafc' : '#1f2937',
    boxShadow: isPixel ? '2px 2px 0 var(--px-ink, #1A1410)' : '0 1px 2px rgba(0,0,0,.12)',
    lineHeight: 1,
  };
  const miniInsertStyle: CSSProperties = {
    ...miniActionBase,
    background: isPixel ? 'var(--px-candy-mint, #A8E6C9)' : activeMeta.accent,
    color: isPixel ? 'var(--px-ink, #1A1410)' : '#08111f',
  };
  const miniDeleteStyle: CSSProperties = {
    ...miniActionBase,
    color: isPixel ? '#dc2626' : '#dc2626',
  };

  return (
    <div className={`resource-library-drawer fixed top-0 right-0 z-50 h-screen w-[440px] max-w-[calc(100vw-18px)] shadow-2xl flex flex-col ${panelCls}`}>
      <div className={`h-[52px] px-4 py-3 flex items-center justify-between shrink-0 ${isPixel ? 'border-b-2 border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Library size={18} style={{ color: activeMeta.accent }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-none">{t('title')}</div>
            <div className={`text-[11px] mt-1 ${subtle}`}>{totalText}</div>
          </div>
        </div>
        <button onClick={onClose} className={isPixel ? 't8-mini-icon-button px-btn px-btn--icon px-btn--ghost' : `t8-mini-icon-button h-9 w-9 p-0 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title={t('common:actions.close')}>
          <X size={16} />
        </button>
      </div>

      <div className={`px-3 py-2 flex items-center gap-1.5 shrink-0 ${isPixel ? 'border-b-2 border-[var(--px-ink)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'}`}>
        {(Object.keys(KIND_META) as ResourceKind[]).map((k) => {
          const meta = KIND_META[k];
          const Icon = meta.icon;
          const active = kind === k;
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={isPixel ? `px-btn px-btn--sm ${active ? 'px-btn--yellow' : ''}` : `flex-1 h-8 rounded-md text-xs flex items-center justify-center gap-1.5 ${active ? 'text-zinc-950' : subtle}`}
              style={!isPixel && active ? { background: meta.accent } : undefined}
            >
              <Icon size={13} /> {t(meta.labelKey)}
            </button>
          );
        })}
      </div>

      <div className={`px-3 py-2 shrink-0 space-y-2 ${isPixel ? 'border-b-2 border-[var(--px-ink)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'}`}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${subtle}`} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className={`${inputCls} w-full pl-8`}
            />
          </div>
          <button
            onClick={() => setFavoriteOnly((v) => !v)}
            className={isPixel ? `resource-library-favorite-filter t8-mini-icon-button px-btn px-btn--icon ${favoriteOnly ? 'px-btn--yellow' : 'px-btn--ghost'}` : `resource-library-favorite-filter t8-mini-icon-button h-9 w-9 p-0 rounded-md border flex items-center justify-center ${favoriteOnly ? 'text-amber-300 border-amber-400/50 bg-amber-400/10' : isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
            title={t('favorite')}
          >
            <Star size={15} fill={favoriteOnly ? 'currentColor' : 'none'} />
          </button>
          {localUploadSupported && (
            <>
              <input
                ref={localUploadInputRef}
                data-resource-local-upload-input
                type="file"
                className="hidden"
                accept={localUploadAccept}
                multiple
                onChange={(event) => {
                  const input = event.currentTarget;
                  void handleLocalUploadFiles(input.files).finally(() => {
                    input.value = '';
                  });
                }}
              />
              <button
                type="button"
                data-resource-local-upload-button
                onPointerDown={stopResourceControlEvent}
                onMouseDown={stopResourceControlEvent}
                onClick={(event) => {
                  stopResourceControlEvent(event);
                  handleLocalUploadButtonClick();
                }}
                disabled={uploadingLocal}
                className={isPixel
                  ? `nodrag nopan px-btn px-btn--sm flex items-center gap-1 ${localUploadCategoryId ? 'px-btn--yellow' : 'px-btn--ghost opacity-70'}`
                  : `nodrag nopan h-9 shrink-0 rounded-md border px-2 text-xs font-semibold flex items-center gap-1.5 ${localUploadCategoryId ? 'text-zinc-950' : subtle} ${uploadingLocal ? 'opacity-70 cursor-progress' : isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
                style={!isPixel && localUploadCategoryId ? { background: activeMeta.accent, borderColor: activeMeta.accent } : undefined}
                title={localUploadCategoryId ? t('upload.to', { name: localUploadTargetLabel }) : t('upload.selectCategory')}
                aria-disabled={!localUploadCategoryId || uploadingLocal}
              >
                <Upload size={14} />
                <span>{uploadingLocal ? t('upload.uploading') : t('upload.action')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <aside className={`w-32 shrink-0 overflow-y-auto p-2 space-y-1 ${isPixel ? 'border-r-2 border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-r border-white/10 bg-white/[0.02]' : 'border-r border-black/10 bg-black/[0.02]'}`}>
          <button
            type="button"
            data-resource-category-action="select"
            onPointerDown={stopResourceControlEvent}
            onMouseDown={stopResourceControlEvent}
            onClick={(event) => {
              stopResourceControlEvent(event);
              setCategoryId('all');
            }}
            className={`nodrag nopan w-full text-left px-2 py-1.5 text-xs rounded ${categoryId === 'all' ? (isPixel ? 'bg-[var(--px-yellow)] border-2 border-[var(--px-ink)]' : 'bg-cyan-500/15 text-cyan-300') : ''}`}
          >
            {t('all')}
          </button>
          {categories.map((cat) => (
            <div key={cat.id} className="group flex items-center gap-1">
              <button
                type="button"
                data-resource-category-action="select"
                onPointerDown={stopResourceControlEvent}
                onMouseDown={stopResourceControlEvent}
                onClick={(event) => {
                  stopResourceControlEvent(event);
                  setCategoryId(cat.id);
                }}
                className={`nodrag nopan flex-1 min-w-0 text-left px-2 py-1.5 text-xs rounded truncate ${categoryId === cat.id ? (isPixel ? 'bg-[var(--px-yellow)] border-2 border-[var(--px-ink)]' : 'bg-cyan-500/15 text-cyan-300') : isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title={cat.name}
              >
                {cat.name}
              </button>
              {!cat.system && (
                <div className="flex items-center opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    data-resource-category-action="rename"
                    onPointerDown={stopResourceControlEvent}
                    onMouseDown={stopResourceControlEvent}
                    onClick={(event) => {
                      stopResourceControlEvent(event);
                      openRenameCategoryDialog(cat);
                    }}
                    className="nodrag nopan p-1 hover:opacity-100"
                    title={t('rename')}
                    aria-label={t('dialogs.renameCategoryAria', { name: cat.name })}
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    data-resource-category-action="delete"
                    onPointerDown={stopResourceControlEvent}
                    onMouseDown={stopResourceControlEvent}
                    onClick={(event) => {
                      stopResourceControlEvent(event);
                      removeCategory(cat);
                    }}
                    className="nodrag nopan p-1 hover:opacity-100 text-red-400"
                    title={t('remove')}
                    aria-label={`${t('remove')} ${cat.name}`}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            data-resource-category-action="add"
            onPointerDown={stopResourceControlEvent}
            onMouseDown={stopResourceControlEvent}
            onClick={(event) => {
              stopResourceControlEvent(event);
              openAddCategoryDialog();
            }}
            className={`nodrag nopan w-full mt-2 ${itemBtn} flex items-center justify-center gap-1`}
            title={t('newCategory')}
          >
            <FolderPlus size={12} /> {t('category')}
          </button>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto p-3">
          {msg && (
            <div className={`mb-2 text-[11px] px-2 py-1 rounded ${isPixel ? 'bg-[var(--px-yellow)] border-2 border-[var(--px-ink)]' : isDark ? 'bg-white/10 text-white/70' : 'bg-black/5 text-zinc-600'}`}>
              {msg}
            </div>
          )}
          {loading && (
            <div className={`text-xs ${subtle}`}>{t('state.loading')}</div>
          )}
          {!loading && items.length === 0 && (
            <div className={`h-56 flex flex-col items-center justify-center text-xs ${subtle}`}>
              <ActiveIcon size={28} style={{ color: activeMeta.accent }} />
              <span className="mt-2">{t('state.empty')}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {items.map((item) => {
              const isPortraitResource = isPortraitResourceItem(item);
              return (
              <article
                key={item.id}
                className={`resource-card overflow-hidden transition-transform ${isPixel ? 'border-2 border-[var(--px-ink)] bg-[var(--px-surface)] shadow-[3px_3px_0_var(--px-ink)]' : isDark ? 'rounded-lg border border-white/10 bg-white/[0.04]' : 'rounded-lg border border-black/10 bg-black/[0.03]'}`}
                {...(item.kind === 'set' || item.kind === 'pose' || item.kind === 'workflow'
                  ? {}
                  : {
                      'data-drag-source': true,
                      'data-drag-kind': resourceItemDragKind(item),
                      'data-drag-url': item.fileUrl,
                      'data-drag-preview': item.thumbUrl || item.fileUrl,
                      'data-drag-node-id': 'resource-library',
                      'data-drag-name': item.originalName || item.title,
                      'data-drag-mime': item.mime || '',
                      'data-drag-size': String(item.size || 0),
                    })}
                title={
                  isPortraitResource
                    ? t('card.clickPortrait')
                    : item.kind === 'set'
                    ? t('card.clickSet')
                    : item.kind === 'pose'
                      ? t('card.clickPose')
                      : item.kind === 'workflow'
                        ? t('card.clickWorkflow')
                        : t('card.dragHint')
                }
              >
                <div className="relative h-28 overflow-hidden bg-black/80">
                  {(item.kind === 'image' || item.kind === 'panorama') && (
                    <>
                      <SmartImage
                        src={item.thumbUrl || item.fileUrl}
                        alt={item.title}
                        className="resource-media w-full h-full object-cover transition-transform duration-200"
                        draggable={false}
                        thumbSize={320}
                      />
                      <button
                        type="button"
                        className="nodrag nopan t8-mini-icon-button resource-card-preview-trigger"
                        title={t('card.previewLarge')}
                        aria-label={t('card.previewLarge')}
                        onMouseEnter={(event) => showImagePreview(event.currentTarget, item)}
                        onMouseLeave={hideImagePreview}
                        onFocus={(event) => showImagePreview(event.currentTarget, item)}
                        onBlur={hideImagePreview}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Eye size={13} />
                      </button>
                    </>
                  )}
                  {item.kind === 'video' && (
                    <LoopingVideo
                      src={item.fileUrl}
                      muted
                      className="resource-media w-full h-full object-cover transition-transform duration-200"
                      onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                      onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                    />
                  )}
                  {item.kind === 'audio' && (
                    <div className="resource-media w-full h-full flex items-center justify-center transition-transform duration-200" style={{ background: 'linear-gradient(135deg,#312e81,#7c3aed,#db2777)' }}>
                      <Music size={34} className="text-white drop-shadow" />
                    </div>
                  )}
                  {item.kind === 'set' && (
                    <div
                      className="resource-media h-full w-full bg-[var(--t8-bg-panel-muted)] p-2 transition-transform duration-200"
                      style={isPortraitResource ? { background: 'linear-gradient(135deg, rgba(236,72,153,.9), rgba(14,165,233,.78), rgba(15,23,42,.92))' } : undefined}
                    >
                      {isPortraitResource ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-center">
                          <UserRoundCog size={36} className="text-white drop-shadow" />
                          <div className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white">
                            PortraitMaster
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="grid h-full grid-cols-2 gap-1 overflow-hidden">
                            {(item.materialSetItems || []).slice(0, 4).map((child, index) => (
                              <div
                                key={child.id || index}
                                className="flex items-center justify-center overflow-hidden rounded border border-black/10 bg-black/10 text-[10px]"
                                title={child.name || child.text || child.url || ''}
                              >
                                {child.kind === 'image' && child.url ? (
                                  <SmartImage src={child.url} className="h-full w-full object-cover" draggable={false} thumbSize={180} />
                                ) : child.kind === 'video' ? (
                                  <Video size={18} className="text-rose-300" />
                                ) : child.kind === 'audio' ? (
                                  <Music size={18} className="text-violet-200" />
                                ) : (
                                  <div className="flex h-full w-full items-center gap-1 p-1 text-left text-[9px] leading-tight text-[var(--t8-text-muted)]">
                                    <FileText size={12} className="shrink-0" />
                                    <span className="line-clamp-3 break-all">{child.text || child.name || t('card.textFallback')}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {materialSetLabel(item.materialSetKind, t)} · {item.materialSetItems?.length || 0}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {item.kind === 'pose' && (
                    <div
                      className="resource-media flex h-full w-full flex-col items-center justify-center gap-1.5 p-3 text-center transition-transform duration-200"
                      style={{ background: 'linear-gradient(135deg, rgba(251,146,60,.92), rgba(45,212,191,.78), rgba(15,23,42,.92))' }}
                    >
                      <PersonStanding size={36} className="text-white drop-shadow" />
                      <div className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white">
                        PoseMaster
                      </div>
                    </div>
                  )}
                  {item.kind === 'workflow' && (
                    <div
                      className="resource-media h-full w-full text-center transition-transform duration-200"
                      style={{ background: 'linear-gradient(135deg, rgba(8,47,73,.95), rgba(14,116,144,.86), rgba(20,184,166,.78))' }}
                    >
                      <WorkflowTopologyCard item={item} accent={activeMeta.accent} />
                    </div>
                  )}
                  <button
                    onClick={() => updateItem(item, { favorite: !item.favorite })}
                    className="t8-mini-icon-button absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/55 text-amber-300 flex items-center justify-center"
                    title={t('favorite')}
                  >
                    <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <div className="p-2 space-y-1.5">
                  <div className="text-xs font-medium truncate" title={item.title}>{item.title}</div>
                  <div className={`text-[10px] truncate ${subtle}`}>
                    {isPortraitResource
                      ? t('card.portraitDescription')
                      : item.kind === 'set'
                      ? t('card.setDescription', { label: materialSetLabel(item.materialSetKind, t), count: item.materialSetItems?.length || 0 })
                      : item.kind === 'pose'
                        ? t('card.poseDescription')
                        : item.kind === 'workflow'
                          ? t('workflow.insertable', { summary: summarizeWorkflowResource(item) })
                          : item.kind === 'panorama'
                            ? t('card.panoramaDescription', { detail: formatSize(item.size, i18n.resolvedLanguage || i18n.language) || item.mime || t('kinds.image') })
                      : formatSize(item.size, i18n.resolvedLanguage || i18n.language) || item.mime || t(`kinds.${item.kind}`)}
                  </div>
                  {item.kind === 'audio' && <audio src={item.fileUrl} controls className="w-full h-8" />}
                  <select
                    value={item.categoryId}
                    onChange={(e) => updateItem(item, { categoryId: e.target.value })}
                    className={isPixel ? 'px-input w-full h-7 text-[11px]' : `w-full h-7 px-1.5 rounded text-[11px] ${isDark ? 'bg-zinc-900 border border-white/10' : 'bg-white border border-black/10'}`}
                  >
                    {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                  <div className="flex items-center justify-center gap-1.5 pt-0.5">
                    <button
                      onClick={() => insertItem(item)}
                      className="nodrag nopan t8-mini-icon-button resource-card-action"
                      style={miniInsertStyle}
                      title={isPortraitResource ? t('card.restorePortrait') : t('card.insertCanvas')}
                      aria-label={isPortraitResource ? t('card.restorePortrait') : t('card.insertCanvas')}
                    >
                      <Plus size={15} />
                    </button>
                    <button
                      onClick={() => sendItem(item)}
                      className="nodrag nopan t8-mini-icon-button resource-card-action"
                      style={miniActionBase}
                      disabled={item.kind === 'workflow'}
                      title={item.kind === 'workflow' ? t('card.workflowSendHint') : t('card.send')}
                      aria-label={t('card.send')}
                    >
                      <Send size={13} />
                    </button>
                    <button
                      onClick={() => openItemRenameDialog(item)}
                      className="nodrag nopan t8-mini-icon-button resource-card-action"
                      style={miniActionBase}
                      title={t('rename')}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => deleteItem(item)}
                      className="nodrag nopan t8-mini-icon-button resource-card-action"
                      style={miniDeleteStyle}
                      title={t('remove')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        </main>
      </div>
      {categoryDialog && (
        <div
          data-resource-category-dialog="true"
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={categoryDialog.mode === 'add' ? t('dialogs.addCategoryAria', { kind: categoryDialog.label }) : t('dialogs.renameCategoryAria', { name: categoryDialog.label })}
          onPointerDown={stopResourceControlEvent}
          onMouseDown={stopResourceControlEvent}
          onClick={(event) => {
            stopResourceControlEvent(event);
            if (event.currentTarget === event.target) setCategoryDialog(null);
          }}
        >
          <form
            className={isPixel
              ? 'w-full max-w-sm border-2 border-[var(--px-ink)] bg-[var(--px-surface)] p-3 shadow-[4px_4px_0_var(--px-ink)]'
              : `w-full max-w-sm rounded-xl border p-4 shadow-2xl ${isDark ? 'border-white/15 bg-zinc-950 text-white' : 'border-black/10 bg-white text-zinc-950'}`}
            onSubmit={(event) => {
              event.preventDefault();
              void submitCategoryDialog();
            }}
            onPointerDown={stopResourceControlEvent}
            onMouseDown={stopResourceControlEvent}
            onClick={stopResourceControlEvent}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {categoryDialog.mode === 'add' ? t('dialogs.addCategoryTitle', { kind: categoryDialog.label }) : t('dialogs.renameCategoryTitle')}
                </div>
                <div className={`mt-1 text-[11px] leading-relaxed ${subtle}`}>
                  {categoryDialog.mode === 'add'
                    ? t('dialogs.addCategoryHelp')
                    : t('dialogs.currentName', { name: categoryDialog.label })}
                </div>
              </div>
              <button
                type="button"
                className={isPixel ? 't8-mini-icon-button px-btn px-btn--icon px-btn--ghost' : `t8-mini-icon-button h-8 w-8 shrink-0 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title={t('common:actions.close')}
                onClick={() => setCategoryDialog(null)}
              >
                <X size={15} />
              </button>
            </div>
            <input
              data-resource-category-dialog-input
              autoFocus
              value={categoryDialog.value}
              onChange={(event) => setCategoryDialog((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setCategoryDialog(null);
                }
              }}
              placeholder={t('dialogs.categoryPlaceholder')}
              className={`${inputCls} w-full`}
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={isPixel ? 'px-btn px-btn--ghost' : `h-9 rounded-md border text-sm font-medium ${isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
                onClick={() => setCategoryDialog(null)}
              >
                {t('common:actions.cancel')}
              </button>
              <button
                type="submit"
                data-resource-category-dialog-confirm
                className={isPixel ? 'px-btn px-btn--yellow' : 'h-9 rounded-md bg-cyan-400 text-sm font-semibold text-zinc-950 hover:bg-cyan-300'}
              >
                {categoryDialog.mode === 'add' ? t('dialogs.create') : t('common:actions.save')}
              </button>
            </div>
          </form>
        </div>
      )}
      {itemRenameDialog && (
        <div
          data-resource-item-rename-dialog="true"
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('dialogs.renameResourceAria', { name: itemRenameDialog.item.title })}
          onPointerDown={stopResourceControlEvent}
          onMouseDown={stopResourceControlEvent}
          onClick={(event) => {
            stopResourceControlEvent(event);
            if (event.currentTarget === event.target) setItemRenameDialog(null);
          }}
        >
          <form
            className={isPixel
              ? 'w-full max-w-sm border-2 border-[var(--px-ink)] bg-[var(--px-surface)] p-3 shadow-[4px_4px_0_var(--px-ink)]'
              : `w-full max-w-sm rounded-xl border p-4 shadow-2xl ${isDark ? 'border-white/15 bg-zinc-950 text-white' : 'border-black/10 bg-white text-zinc-950'}`}
            onSubmit={(event) => {
              event.preventDefault();
              void submitItemRenameDialog();
            }}
            onPointerDown={stopResourceControlEvent}
            onMouseDown={stopResourceControlEvent}
            onClick={stopResourceControlEvent}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t('dialogs.renameResourceTitle')}</div>
                <div className={`mt-1 truncate text-[11px] leading-relaxed ${subtle}`} title={itemRenameDialog.item.title}>
                  {t('dialogs.currentName', { name: itemRenameDialog.item.title })}
                </div>
              </div>
              <button
                type="button"
                className={isPixel ? 't8-mini-icon-button px-btn px-btn--icon px-btn--ghost' : `t8-mini-icon-button h-8 w-8 shrink-0 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title={t('common:actions.close')}
                onClick={() => setItemRenameDialog(null)}
              >
                <X size={15} />
              </button>
            </div>
            <input
              data-resource-item-rename-dialog-input
              autoFocus
              value={itemRenameDialog.value}
              onChange={(event) => setItemRenameDialog((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setItemRenameDialog(null);
                }
              }}
              placeholder={t('dialogs.resourcePlaceholder')}
              className={`${inputCls} w-full`}
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={isPixel ? 'px-btn px-btn--ghost' : `h-9 rounded-md border text-sm font-medium ${isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
                onClick={() => setItemRenameDialog(null)}
              >
                {t('common:actions.cancel')}
              </button>
              <button
                type="submit"
                data-resource-item-rename-dialog-confirm
                className={isPixel ? 'px-btn px-btn--yellow' : 'h-9 rounded-md bg-cyan-400 text-sm font-semibold text-zinc-950 hover:bg-cyan-300'}
              >
                {t('common:actions.save')}
              </button>
            </div>
          </form>
        </div>
      )}
      {hoverPreview && (
        <div
          className="resource-card-image-hover-preview"
          style={{ left: hoverPreview.left, top: hoverPreview.top }}
          role="presentation"
        >
          <img src={hoverPreview.src} alt={hoverPreview.title} draggable={false} />
          <div className="resource-card-image-hover-preview__title">{hoverPreview.title}</div>
        </div>
      )}
    </div>
  );
}
