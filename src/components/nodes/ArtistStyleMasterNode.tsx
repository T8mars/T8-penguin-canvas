import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  FileText,
  Filter,
  Image as ImageIcon,
  Images,
  Palette,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PORT_COLOR } from '../../config/portTypes';
import {
  ARTIST_STYLE_MASTER_ITEMS,
  ARTIST_STYLE_MASTER_MOVEMENTS,
} from '../../data/artistStyleMasterManifest';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { defaultSizeOf, placeSingleNode } from '../../utils/nodePlacement';
import {
  ARTIST_STYLE_MASTER_STORAGE_KEY,
  buildArtistStyleOutputPayload,
  buildArtistStylePrompt,
  createArtistStyleExport,
  importArtistStyleExport,
  mergeArtistStyleLibraries,
  normalizeArtistStyleItem,
  normalizeArtistStyleLibrary,
  searchArtistStyles,
  slugifyArtistStyle,
  upsertArtistStyleInLibrary,
  type ArtistStyleCategory,
  type ArtistStyleItem,
  type ArtistStyleOutputMode,
  type ArtistStyleUserLibrary,
} from '../../utils/artistStyleMaster';
import { useUpdateNodeData } from './useUpdateNodeData';
import InspirationVisible from '../../i18n/InspirationVisible';

const EMPTY_LIBRARY: ArtistStyleUserLibrary = { categories: [], styles: [] };
const EMPTY_CUSTOM_DRAFT = {
  name: '',
  chineseName: '',
  imageUrl: '',
  cue: '',
  category: '',
  tags: '',
};

const handleStyle = {
  width: 12,
  height: 12,
  border: '2px solid var(--asm-handle-border, #0f172a)',
  boxShadow: '0 0 0 2px var(--asm-bg, #fff7ed)',
};

function readLibrary(): ArtistStyleUserLibrary {
  if (typeof window === 'undefined') return EMPTY_LIBRARY;
  try {
    const raw = window.localStorage.getItem(ARTIST_STYLE_MASTER_STORAGE_KEY);
    if (!raw) return EMPTY_LIBRARY;
    return normalizeArtistStyleLibrary(JSON.parse(raw));
  } catch {
    return EMPTY_LIBRARY;
  }
}

function writeLibrary(library: ArtistStyleUserLibrary) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ARTIST_STYLE_MASTER_STORAGE_KEY, JSON.stringify(normalizeArtistStyleLibrary(library)));
}

function toSelectOptions(items: readonly { id: string; label?: string; labelZh?: string; name?: string }[], english: boolean) {
  return items.map((item) => ({
    value: item.id,
    label: english
      ? item.label || item.name || item.id
      : item.labelZh && item.label ? `${item.labelZh} / ${item.label}` : item.name || item.label || item.id,
  }));
}

function displayArtistName(style: ArtistStyleItem | null | undefined, english: boolean) {
  if (!style) return '';
  return english ? style.name || style.chineseName : style.chineseName || style.name;
}

function displayArtistMovement(style: ArtistStyleItem | null | undefined, english: boolean) {
  if (!style) return '';
  return english ? style.movement || style.movementZh : style.movementZh || style.movement;
}

function displayArtistCue(style: ArtistStyleItem | null | undefined, english: boolean) {
  if (!style) return '';
  if (!english || style.userCreated) return style.cue;
  return [style.name, style.movement].filter(Boolean).join(' · ');
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stopCanvasWheel(event: React.WheelEvent) {
  event.stopPropagation();
}

function ArtistStyleMasterNode({ id, data, selected }: NodeProps) {
  const { i18n } = useTranslation();
  const isEnglish = (i18n.resolvedLanguage || i18n.language).toLowerCase().startsWith('en');
  const rf = useReactFlow();
  const update = useUpdateNodeData(id);
  const importRef = useRef<HTMLInputElement | null>(null);
  const customImageUploadRef = useRef<HTMLInputElement | null>(null);
  const [library, setLibrary] = useState<ArtistStyleUserLibrary>(() => readLibrary());
  const [query, setQuery] = useState(String((data as any)?.artistStyleQuery || ''));
  const [movement, setMovement] = useState(String((data as any)?.artistStyleMovement || 'all'));
  const [category, setCategory] = useState(String((data as any)?.artistStyleCategory || 'all'));
  const [outputMode, setOutputMode] = useState<ArtistStyleOutputMode>(
    (data as any)?.artistStyleOutputMode === 'image' ? 'image' : 'prompt',
  );
  const [selectedId, setSelectedId] = useState(String((data as any)?.artistStyleSelectedId || ARTIST_STYLE_MASTER_ITEMS[0]?.id || ''));
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renameCategoryId, setRenameCategoryId] = useState('');
  const [renameCategoryName, setRenameCategoryName] = useState('');
  const [customDraft, setCustomDraft] = useState(EMPTY_CUSTOM_DRAFT);
  const [editingStyleId, setEditingStyleId] = useState('');
  const [status, setStatus] = useState('选择一个风格，运行后输出提示词或参考图。');

  useEffect(() => {
    writeLibrary(library);
  }, [library]);

  useEffect(() => {
    const onLibraryChanged = () => setLibrary(readLibrary());
    window.addEventListener('penguin:artist-style-master-changed', onLibraryChanged);
    return () => window.removeEventListener('penguin:artist-style-master-changed', onLibraryChanged);
  }, []);

  const allStyles = useMemo(() => {
    return [...ARTIST_STYLE_MASTER_ITEMS, ...library.styles] as ArtistStyleItem[];
  }, [library.styles]);

  const categoryOptions = useMemo(() => {
    const merged = new Map<string, { id: string; label: string; labelZh: string }>();
    library.categories.forEach((item) => {
      if (item.id) merged.set(item.id, { id: item.id, label: item.name, labelZh: item.name });
    });
    library.styles.forEach((item) => {
      const label = item.categoryZh || item.category;
      if (item.category) merged.set(item.category, { id: item.category, label, labelZh: label });
    });
    return Array.from(merged.values()).sort((a, b) => a.labelZh.localeCompare(b.labelZh, 'zh-Hans-CN'));
  }, [library.categories, library.styles]);

  const movementOptions = useMemo(() => {
    const custom = library.styles.map((item) => ({ id: item.movement, label: item.movement, labelZh: item.movementZh }));
    const merged = new Map<string, { id: string; label: string; labelZh: string }>();
    [...ARTIST_STYLE_MASTER_MOVEMENTS, ...custom].forEach((item) => {
      if (item.id) merged.set(item.id, item);
    });
    return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [library.styles]);

  const filteredStyles = useMemo(() => {
    return searchArtistStyles(allStyles, { query, movement, category, limit: galleryOpen ? undefined : 12 });
  }, [allStyles, category, galleryOpen, movement, query]);

  useEffect(() => {
    if (category !== 'all' && !categoryOptions.some((item) => item.id === category)) {
      setCategory('all');
    }
  }, [category, categoryOptions]);

  const selectedStyle = useMemo(() => {
    return allStyles.find((item) => item.id === selectedId) || filteredStyles[0] || allStyles[0];
  }, [allStyles, filteredStyles, selectedId]);

  useEffect(() => {
    if (selectedStyle && selectedStyle.id !== selectedId) {
      setSelectedId(selectedStyle.id);
    }
  }, [selectedId, selectedStyle]);

  useEffect(() => {
    update({
      artistStyleQuery: query,
      artistStyleMovement: movement,
      artistStyleCategory: category,
      artistStyleOutputMode: outputMode,
      artistStyleSelectedId: selectedStyle?.id,
    });
  }, [category, movement, outputMode, query, selectedStyle?.id, update]);

  const openLightbox = useCallback((item: ArtistStyleItem) => {
    const index = filteredStyles.findIndex((style) => style.id === item.id);
    setSelectedId(item.id);
    setLightboxIndex(Math.max(0, index));
  }, [filteredStyles]);

  const moveLightbox = useCallback((delta: number) => {
    setLightboxIndex((current) => {
      const total = filteredStyles.length;
      if (current === null || total < 1) return current;
      return (current + delta + total) % total;
    });
  }, [filteredStyles.length]);

  useEffect(() => {
    if (lightboxIndex === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxIndex(null);
      if (event.key === 'ArrowRight') moveLightbox(1);
      if (event.key === 'ArrowLeft') moveLightbox(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, moveLightbox]);

  const copyPrompt = useCallback(async (style = selectedStyle) => {
    if (!style) return;
    const prompt = buildArtistStylePrompt(style);
    await navigator.clipboard?.writeText(prompt);
    setStatus('已复制画家名称提示词。');
  }, [selectedStyle]);

  const saveCurrentStyle = useCallback(() => {
    if (!selectedStyle) return;
    const saved = normalizeArtistStyleItem({
      ...selectedStyle,
      id: `saved-${selectedStyle.id}`,
      userCreated: true,
    });
    setLibrary((current) => upsertArtistStyleInLibrary(current, saved, { id: saved.category, name: saved.categoryZh }));
    setStatus('已保存到艺术风格大师。');
  }, [selectedStyle]);

  const addCategory = useCallback(() => {
    const name = newCategoryName.trim();
    if (!name) return;
    const next: ArtistStyleCategory = { id: slugifyArtistStyle(name), name };
    setLibrary((current) => mergeArtistStyleLibraries(current, { categories: [next], styles: [] }));
    setNewCategoryName('');
    setStatus('新增分类已保存。');
  }, [newCategoryName]);

  const renameCategory = useCallback(() => {
    if (!renameCategoryId || !renameCategoryName.trim()) return;
    const name = renameCategoryName.trim();
    setLibrary((current) => ({
      categories: current.categories.map((item) => (item.id === renameCategoryId ? { ...item, name } : item)),
      styles: current.styles.map((style) => (
        style.category === renameCategoryId
          ? { ...style, categoryZh: name }
          : style
      )),
    }));
    setStatus('分类已重命名。');
  }, [renameCategoryId, renameCategoryName]);

  const deleteCategory = useCallback(() => {
    if (!renameCategoryId) return;
    setLibrary((current) => ({
      categories: current.categories.filter((item) => item.id !== renameCategoryId),
      styles: current.styles.map((style) => (
        style.category === renameCategoryId
          ? { ...style, category: 'User', categoryZh: '未分类' }
          : style
      )),
    }));
    setRenameCategoryId('');
    setRenameCategoryName('');
    setStatus('分类已删除，相关风格已移动到未分类。');
  }, [renameCategoryId]);

  const saveCustomStyle = useCallback(() => {
    if (!customDraft.name.trim() || !customDraft.imageUrl.trim()) {
      setStatus('新增风格至少需要名称和图片地址。');
      return;
    }
    const categoryName = customDraft.category.trim() || '未分类';
    const existingStyle = editingStyleId ? library.styles.find((item) => item.id === editingStyleId) : undefined;
    const style = normalizeArtistStyleItem({
      id: editingStyleId || undefined,
      name: customDraft.name,
      chineseName: customDraft.chineseName || customDraft.name,
      category: slugifyArtistStyle(categoryName),
      categoryZh: categoryName,
      movement: 'User',
      movementZh: '自定义风格',
      cue: customDraft.cue,
      imageUrl: customDraft.imageUrl,
      tags: customDraft.tags.split(/[,\s，、]+/).filter(Boolean),
      sourceOrder: existingStyle?.sourceOrder,
      userCreated: true,
    });
    setLibrary((current) => upsertArtistStyleInLibrary(current, style, { id: style.category, name: categoryName }));
    setCustomDraft(EMPTY_CUSTOM_DRAFT);
    setEditingStyleId('');
    setSelectedId(style.id);
    setStatus(editingStyleId ? '自定义风格已更新。' : '自定义风格已保存。');
  }, [customDraft, editingStyleId, library.styles]);

  const editUserStyle = useCallback((style: ArtistStyleItem) => {
    if (!style.userCreated) return;
    setCustomDraft({
      name: style.name,
      chineseName: style.chineseName,
      imageUrl: style.imageUrl,
      cue: style.cue,
      category: style.categoryZh || style.category,
      tags: [...style.tags].join(', '),
    });
    setEditingStyleId(style.id);
    setSelectedId(style.id);
    setStatus('正在编辑自定义风格。');
  }, []);

  const cancelCustomEdit = useCallback(() => {
    setCustomDraft(EMPTY_CUSTOM_DRAFT);
    setEditingStyleId('');
    setStatus('已取消编辑自定义风格。');
  }, []);

  const deleteUserStyle = useCallback((styleId: string) => {
    setLibrary((current) => ({
      ...current,
      styles: current.styles.filter((item) => item.id !== styleId),
    }));
    if (editingStyleId === styleId) {
      setCustomDraft(EMPTY_CUSTOM_DRAFT);
      setEditingStyleId('');
    }
    if (selectedId === styleId) {
      setSelectedId(ARTIST_STYLE_MASTER_ITEMS[0]?.id || '');
    }
    setStatus('自定义风格已删除。');
  }, [editingStyleId, selectedId]);

  const exportLibrary = useCallback(() => {
    downloadJson(`artist-style-master-${Date.now()}.json`, createArtistStyleExport(library));
    setStatus('已导出艺术风格大师配置。');
  }, [library]);

  const importLibrary = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = importArtistStyleExport(parsed);
      setLibrary((current) => mergeArtistStyleLibraries(current, imported));
      setStatus('导入完成。');
    } catch (error: any) {
      setStatus(error?.message || '导入失败。');
    }
  }, []);

  const handleCustomImageUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('请选择图片文件。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!imageUrl) {
        setStatus('读取图片失败，请重试。');
        return;
      }
      const nameFromFile = file.name.replace(/\.[^.]+$/, '');
      setCustomDraft((draft) => ({
        ...draft,
        name: draft.name || nameFromFile,
        chineseName: draft.chineseName || nameFromFile,
        imageUrl,
      }));
      setStatus('已上传风格图，保存后会进入对应自定义分类。');
    };
    reader.onerror = () => setStatus('读取图片失败，请重试。');
    reader.readAsDataURL(file);
  }, []);

  const runArtistStyleOutput = useCallback(async (mode: ArtistStyleOutputMode) => {
    if (!selectedStyle) throw new Error('请先选择一个艺术风格');
    const payload = buildArtistStyleOutputPayload(selectedStyle, mode);
    const nodes = rf.getNodes();
    const me = rf.getNode(id);
    const mySize = defaultSizeOf('artist-style-master');
    const baseX = (me?.position.x ?? 0) + ((me as any)?.measured?.width || mySize.w) + 80;
    const baseY = me?.position.y ?? 0;
    const position = placeSingleNode(baseX, baseY, 'output', nodes, { source: `placement:artist-style-master-output:${id}` });
    const outputNode: Node = {
      id: `artist-style-output-${mode}-${Date.now()}`,
      type: 'output',
      position,
      data: {
        ...payload.data,
        title: mode === 'image' ? `${selectedStyle.chineseName} 风格图` : `${selectedStyle.chineseName} 风格提示词`,
        artistStyleOutputMode: mode,
        sourceNodeId: id,
      },
    };
    rf.addNodes(outputNode);
    update({
      lastArtistStyleOutputMode: mode,
      lastArtistStyleText: payload.data.directOutputText,
      lastArtistStyleImageUrl: payload.data.directImageUrl || '',
    });
    setStatus(mode === 'image' ? '已输出风格图片。' : '已输出风格提示词。');
  }, [id, rf, selectedStyle, update]);

  const handleRun = useCallback(() => {
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const mode: ArtistStyleOutputMode = liveData?.artistStyleOutputMode === 'image' ? 'image' : 'prompt';
    return runArtistStyleOutput(mode);
  }, [id, rf, runArtistStyleOutput]);

  const requestArtistStyleRun = useCallback((mode: ArtistStyleOutputMode) => {
    setOutputMode(mode);
    update({
      artistStyleOutputMode: mode,
      artistStyleSelectedId: selectedStyle?.id,
    });
    requestCanvasNodeRun(id);
  }, [id, selectedStyle?.id, update]);

  useRunTrigger(id, handleRun, 'artist-style-master');

  const activeLightboxStyle = lightboxIndex === null ? null : filteredStyles[lightboxIndex] || filteredStyles[0];

  const galleryModal = galleryOpen ? createPortal(
    <InspirationVisible>
      <div className="artist-style-master-modal-backdrop nodrag nopan" onWheelCapture={(event) => event.stopPropagation()}>
      <section
        className="artist-style-master-modal"
        data-artist-style-gallery-modal
        onWheelCapture={stopCanvasWheel}
      >
        <header className="artist-style-master-modal-header">
          <div>
            <div className="artist-style-master-kicker">灵感之源</div>
            <h2>艺术风格大师</h2>
            <p>搜索画家、流派和风格标签，保存你的常用参考。</p>
          </div>
          <button type="button" className="asm-icon-button" aria-label="关闭艺术风格库" onClick={() => setGalleryOpen(false)}>
            <X size={18} />
          </button>
        </header>

        <div className="artist-style-master-modal-tools">
          <label className="artist-style-master-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索英文名 / 中文名 / 风格标签" />
          </label>
          <select value={movement} onChange={(event) => setMovement(event.target.value)}>
            <option value="all">全部流派</option>
            {toSelectOptions(movementOptions, isEnglish).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">全部收藏分类</option>
            {toSelectOptions(categoryOptions, isEnglish).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button type="button" onClick={exportLibrary}><Download size={15} /> 导出</button>
          <button type="button" onClick={() => importRef.current?.click()}><Upload size={15} /> 导入</button>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={importLibrary} />
        </div>

        <div className="artist-style-master-modal-layout">
          <div className="artist-style-master-gallery" onWheelCapture={stopCanvasWheel}>
            {filteredStyles.map((style) => (
              <article key={style.id} className={`artist-style-master-card ${selectedStyle?.id === style.id ? 'is-selected' : ''}`}>
                <button type="button" className="artist-style-master-thumb-button" onClick={() => openLightbox(style)}>
                  <img src={style.thumbnailUrl || style.imageUrl} alt={`${style.name} ${style.chineseName}`} loading="lazy" />
                </button>
                <div className="artist-style-master-card-body">
                  <strong>{displayArtistName(style, isEnglish)}</strong>
                  {!isEnglish && <span>{style.name}</span>}
                  <small>{displayArtistMovement(style, isEnglish)}</small>
                  <p>{displayArtistCue(style, isEnglish)}</p>
                  <div className="artist-style-master-card-actions">
                    <button type="button" onClick={() => setSelectedId(style.id)}>选用</button>
                    <button type="button" onClick={() => void copyPrompt(style)}>复制画家提示词</button>
                    {style.userCreated ? <button type="button" onClick={() => editUserStyle(style)}>编辑</button> : null}
                    {style.userCreated ? <button type="button" className="danger" onClick={() => deleteUserStyle(style.id)}>删除</button> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <aside className="artist-style-master-manager" onWheelCapture={stopCanvasWheel}>
            <h3><Save size={16} /> 保存到艺术风格大师</h3>
            <button type="button" className="artist-style-master-wide-button" onClick={saveCurrentStyle}>保存当前选中风格</button>

            <h3><Plus size={16} /> 新增分类</h3>
            <div className="artist-style-master-inline-form">
              <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="分类名称，例如：电商海报" />
              <button type="button" onClick={addCategory}>新增分类</button>
            </div>

            <h3><Edit3 size={16} /> 重命名分类</h3>
            <select value={renameCategoryId} onChange={(event) => {
              setRenameCategoryId(event.target.value);
              const item = library.categories.find((categoryItem) => categoryItem.id === event.target.value);
              setRenameCategoryName(item?.name || '');
            }}>
              <option value="">选择自定义分类</option>
              {library.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <div className="artist-style-master-inline-form">
              <input value={renameCategoryName} onChange={(event) => setRenameCategoryName(event.target.value)} placeholder="新分类名" />
              <button type="button" onClick={renameCategory}>重命名分类</button>
              <button type="button" className="danger" onClick={deleteCategory}>删除分类</button>
            </div>

            <h3><Palette size={16} /> {editingStyleId ? '编辑自定义风格' : '新增自定义风格'}</h3>
            <input value={customDraft.name} onChange={(event) => setCustomDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="原始风格名 / 英文名" />
            <input value={customDraft.chineseName} onChange={(event) => setCustomDraft((draft) => ({ ...draft, chineseName: event.target.value }))} placeholder="中文翻译" />
            <input value={customDraft.category} onChange={(event) => setCustomDraft((draft) => ({ ...draft, category: event.target.value }))} placeholder="分类" />
            <input value={customDraft.imageUrl} onChange={(event) => setCustomDraft((draft) => ({ ...draft, imageUrl: event.target.value }))} placeholder="图片地址" />
            <div className="artist-style-master-custom-upload">
              {customDraft.imageUrl ? (
                <img src={customDraft.imageUrl} alt="自定义风格预览" />
              ) : (
                <div className="artist-style-master-custom-upload-placeholder">未上传</div>
              )}
              <div>
                <button type="button" onClick={() => customImageUploadRef.current?.click()}>
                  <Upload size={15} /> 上传风格图
                </button>
                <small>可直接上传本地图片，保存后进入对应自定义分类。</small>
              </div>
              <input type="file" accept="image/*" ref={customImageUploadRef} className="hidden" onChange={handleCustomImageUpload} />
            </div>
            <textarea value={customDraft.cue} onChange={(event) => setCustomDraft((draft) => ({ ...draft, cue: event.target.value }))} placeholder="属性信息 / 风格描述" />
            <input value={customDraft.tags} onChange={(event) => setCustomDraft((draft) => ({ ...draft, tags: event.target.value }))} placeholder="标签，用逗号分隔" />
            <div className="artist-style-master-custom-actions">
              <button type="button" className="artist-style-master-wide-button" onClick={saveCustomStyle}>
                {editingStyleId ? '更新自定义风格' : '保存自定义风格'}
              </button>
              {editingStyleId ? (
                <button type="button" className="artist-style-master-wide-button" onClick={cancelCustomEdit}>
                  取消编辑
                </button>
              ) : null}
            </div>

            <div className="artist-style-master-status">{status}</div>
          </aside>
        </div>
      </section>
      </div>
    </InspirationVisible>,
    document.body,
  ) : null;

  const lightbox = activeLightboxStyle ? createPortal(
    <InspirationVisible>
      <div className="artist-style-master-lightbox-backdrop nodrag nopan" data-artist-style-lightbox onWheelCapture={(event) => event.stopPropagation()}>
      <button type="button" className="asm-icon-button lightbox-close" aria-label="关闭预览" onClick={() => setLightboxIndex(null)}>
        <X size={18} />
      </button>
      <button type="button" className="asm-icon-button lightbox-prev" aria-label="上一张" onClick={() => moveLightbox(-1)}>
        <ChevronLeft size={22} />
      </button>
      <figure className="artist-style-master-lightbox">
        <img src={activeLightboxStyle.imageUrl} alt={`${activeLightboxStyle.name} ${activeLightboxStyle.chineseName}`} />
        <figcaption>
          <strong>{displayArtistName(activeLightboxStyle, isEnglish)}</strong>
          <span>{activeLightboxStyle.name} · {activeLightboxStyle.movement}</span>
          <p>{displayArtistCue(activeLightboxStyle, isEnglish)}</p>
          <button type="button" onClick={() => void copyPrompt(activeLightboxStyle)}>复制画家提示词</button>
        </figcaption>
      </figure>
      <button type="button" className="asm-icon-button lightbox-next" aria-label="下一张" onClick={() => moveLightbox(1)}>
        <ChevronRight size={22} />
      </button>
      </div>
    </InspirationVisible>,
    document.body,
  ) : null;

  return (
    <InspirationVisible>
      <div
        className={`artist-style-master-node ${selected ? 'is-selected' : ''}`}
        data-artist-style-master-root
        onWheelCapture={(event) => event.stopPropagation()}
      >
      <Handle id="text" type="target" position={Position.Left} style={{ ...handleStyle, background: PORT_COLOR.text, top: 160 }} />
      <Handle id="text" type="source" position={Position.Right} style={{ ...handleStyle, background: PORT_COLOR.text, top: 152 }} />
      <Handle id="image" type="source" position={Position.Right} style={{ ...handleStyle, background: PORT_COLOR.image, top: 190 }} />

      <header className="artist-style-master-header" data-artist-style-master-drag-surface>
        <div className="artist-style-master-icon"><Palette size={22} /></div>
        <div>
          <h3>艺术风格大师</h3>
          <p>搜索画家 / 流派 / 风格标签</p>
        </div>
        <button type="button" className="asm-icon-button nodrag nopan" aria-label="打开艺术风格库" onClick={() => setGalleryOpen(true)}>
          <Images size={18} />
        </button>
      </header>

      <section className="artist-style-master-section nodrag nopan">
        <div className="artist-style-master-selected">
          <img src={selectedStyle?.thumbnailUrl || selectedStyle?.imageUrl} alt={selectedStyle?.name || '艺术风格'} />
          <div>
            <strong>{displayArtistName(selectedStyle, isEnglish) || '请选择风格'}</strong>
            {!isEnglish && <span>{selectedStyle?.name || 'No style selected'}</span>}
            <small>{displayArtistMovement(selectedStyle, isEnglish) || '打开风格库选择'}</small>
          </div>
        </div>
        <p className="artist-style-master-cue">{displayArtistCue(selectedStyle, isEnglish)}</p>
      </section>

      <section className="artist-style-master-section nodrag nopan">
        <label>
          <span><Search size={14} /> 搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="画家英文名、中文名或风格标签" />
        </label>
        <div className="artist-style-master-two-cols">
          <label>
            <span><Filter size={14} /> 流派</span>
            <select value={movement} onChange={(event) => setMovement(event.target.value)}>
              <option value="all">全部流派</option>
              {toSelectOptions(movementOptions, isEnglish).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span><BookOpen size={14} /> 收藏分类</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">全部收藏分类</option>
              {toSelectOptions(categoryOptions, isEnglish).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <div className="artist-style-master-mode">
          <button
            type="button"
            className={outputMode === 'prompt' ? 'active' : ''}
            onClick={() => requestArtistStyleRun('prompt')}
          >
            <FileText size={15} /> 输出风格提示词
          </button>
          <button
            type="button"
            className={outputMode === 'image' ? 'active' : ''}
            onClick={() => requestArtistStyleRun('image')}
          >
            <ImageIcon size={15} /> 输出风格图片
          </button>
        </div>
      </section>

      <section className="artist-style-master-section nodrag nopan">
        <div className="artist-style-master-mini-grid" onWheelCapture={stopCanvasWheel}>
          {filteredStyles.map((style) => (
            <button key={style.id} type="button" className={selectedStyle?.id === style.id ? 'active' : ''} onClick={() => setSelectedId(style.id)}>
              <img src={style.thumbnailUrl || style.imageUrl} alt={displayArtistName(style, isEnglish)} />
              <span>{displayArtistName(style, isEnglish)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="artist-style-master-actions nodrag nopan">
        <button type="button" onClick={() => setGalleryOpen(true)}><Images size={16} /> 打开风格库</button>
        <button type="button" onClick={() => void copyPrompt()}><Copy size={16} /> 复制画家提示词</button>
        <button type="button" onClick={saveCurrentStyle}><Save size={16} /> 保存到艺术风格大师</button>
      </section>

      <footer className="artist-style-master-footer nodrag nopan">
        <span>{filteredStyles.length} 个匹配 · {library.styles.length} 个自定义</span>
        <button type="button" onClick={() => requestArtistStyleRun(outputMode)}>
          {outputMode === 'image' ? <ImageIcon size={17} /> : <FileText size={17} />}
          运行
        </button>
      </footer>

      {galleryModal}
      {lightbox}
      </div>
    </InspirationVisible>
  );
}

export default ArtistStyleMasterNode;
