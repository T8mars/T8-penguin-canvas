import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  BookmarkPlus,
  Check,
  Copy,
  Download,
  FileDown,
  FileUp,
  Image as ImageIcon,
  Languages,
  Library,
  Music,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  countBuiltInPromptTemplatesByCategory,
  getBuiltInPromptTemplates,
  getPromptTemplateCategories,
  getPromptTemplateCategoryLabel,
  getPromptTemplateDescription,
  getPromptTemplateText,
  getPromptTemplateTitle,
  type PromptTemplateCategory,
  type PromptTemplateAttachment,
  type PromptTemplateItem,
  type PromptTemplateKind,
  type PromptTemplateLanguage,
} from '../data/promptTemplateLibrary';
import {
  createCustomPromptTemplate,
  exportPromptTemplateBackup,
  importPromptTemplateBackup,
  loadPromptTemplateUserState,
  savePromptTemplateUserState,
  type PromptTemplateUserState,
} from '../services/promptTemplateLibrary';
import * as api from '../services/api';
import ImageHoverPreview from './ImageHoverPreview';
import SmartImage from './SmartImage';

interface PromptTemplateLibraryModalProps {
  open: boolean;
  initialKind: PromptTemplateKind;
  value: string;
  onApply: (value: string) => void;
  onClose: () => void;
  isDark: boolean;
  isPixel: boolean;
}

type SourceFilter = 'all' | 'builtin' | 'mine';

type PromptCategoryDialogState =
  | { mode: 'add'; kind: PromptTemplateKind; value: string }
  | { mode: 'rename'; category: PromptTemplateCategory; value: string };

interface EditDraft {
  id?: string;
  kind: PromptTemplateKind;
  categoryId: string;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  promptZh: string;
  promptEn: string;
  negativeZh: string;
  negativeEn: string;
  tags: string;
  attachments: PromptTemplateAttachment[];
}

function textForSearch(item: PromptTemplateItem) {
  return [
    item.titleZh,
    item.titleEn,
    item.descriptionZh,
    item.descriptionEn,
    item.promptZh,
    item.promptEn,
    item.negativeZh,
    item.negativeEn,
    item.tags.join(' '),
    (item.attachments || []).map((attachment) => attachment.title || attachment.url).join(' '),
    item.source,
  ].join(' ').toLowerCase();
}

async function copyText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function downloadJson(filename: string, data: unknown) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function kindLabelZh(kind: PromptTemplateKind) {
  return kind === 'image' ? '图像' : '视频';
}

function categoryFallback(kind: PromptTemplateKind) {
  return kind === 'image' ? 'image-portrait-character' : 'video-cinematic-shot';
}

function makeEditDraft(item: PromptTemplateItem | null, kind: PromptTemplateKind, categoryId: string): EditDraft {
  return {
    id: item?.source === 'custom' ? item.id : undefined,
    kind: item?.kind || kind,
    categoryId: item?.categoryId || categoryId || categoryFallback(kind),
    titleZh: item?.source === 'custom' ? item.titleZh : (item ? `${item.titleZh} 副本` : '我的提示词模板'),
    titleEn: item?.source === 'custom' ? item.titleEn : (item ? `${item.titleEn || item.titleZh} Copy` : 'My Prompt Template'),
    descriptionZh: item?.descriptionZh || '',
    descriptionEn: item?.descriptionEn || '',
    promptZh: item?.promptZh || '',
    promptEn: item?.promptEn || item?.promptZh || '',
    negativeZh: item?.negativeZh || '',
    negativeEn: item?.negativeEn || item?.negativeZh || '',
    tags: item?.tags?.join(', ') || '',
    attachments: item?.attachments || [],
  };
}

function attachmentKindLabel(kind: PromptTemplateAttachment['kind']) {
  if (kind === 'image') return '图像';
  if (kind === 'video') return '视频';
  return '音频';
}

function attachmentIcon(kind: PromptTemplateAttachment['kind']) {
  if (kind === 'image') return <ImageIcon size={12} />;
  if (kind === 'video') return <Video size={12} />;
  return <Music size={12} />;
}

export default function PromptTemplateLibraryModal({
  open,
  initialKind,
  value,
  onApply,
  onClose,
  isDark,
  isPixel,
}: PromptTemplateLibraryModalProps) {
  const { t } = useTranslation(['nodes', 'common']);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<PromptTemplateUserState>(() => loadPromptTemplateUserState());
  const [activeKind, setActiveKind] = useState<PromptTemplateKind>(initialKind);
  const [categoryId, setCategoryId] = useState('all');
  const [language, setLanguage] = useState<PromptTemplateLanguage>(state.language || 'zh');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [promptCategoryDialog, setPromptCategoryDialog] = useState<PromptCategoryDialogState | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (open) {
      const next = loadPromptTemplateUserState();
      setState(next);
      setLanguage(next.language || 'zh');
      setActiveKind(initialKind);
      setMessage('');
      setEditDraft(null);
      setPromptCategoryDialog(null);
    }
  }, [initialKind, open]);

  useEffect(() => {
    if (!open) return;
    const onPromptTemplatesChanged = () => {
      const next = loadPromptTemplateUserState();
      setState(next);
    };
    window.addEventListener('penguin:prompt-templates-changed', onPromptTemplatesChanged);
    return () => window.removeEventListener('penguin:prompt-templates-changed', onPromptTemplatesChanged);
  }, [open]);

  const persist = useCallback((updater: (prev: PromptTemplateUserState) => PromptTemplateUserState) => {
    setState((prev) => savePromptTemplateUserState(updater(prev)));
  }, []);

  const categories = useMemo(
    () => getPromptTemplateCategories(activeKind, state.customCategories),
    [activeKind, state.customCategories],
  );

  useEffect(() => {
    if (categoryId !== 'all' && !categories.some((cat) => cat.id === categoryId)) {
      setCategoryId('all');
    }
  }, [categories, categoryId]);

  const hidden = useMemo(() => new Set(state.hiddenBuiltInIds), [state.hiddenBuiltInIds]);
  const builtIn = useMemo(() => getBuiltInPromptTemplates().filter((item) => !hidden.has(item.id)), [hidden]);
  const allItems = useMemo(() => [...builtIn, ...state.customItems], [builtIn, state.customItems]);
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems
      .filter((item) => item.kind === activeKind)
      .forEach((item) => {
        counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
      });
    return counts;
  }, [activeKind, allItems]);
  const builtInCounts = useMemo(() => countBuiltInPromptTemplatesByCategory(), []);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems
      .filter((item) => item.kind === activeKind)
      .filter((item) => categoryId === 'all' || item.categoryId === categoryId)
      .filter((item) => sourceFilter === 'all' || (sourceFilter === 'mine' ? item.source === 'custom' : item.source !== 'custom'))
      .filter((item) => !q || textForSearch(item).includes(q))
      .sort((a, b) => {
        const sourceWeight = (item: PromptTemplateItem) => (item.source === 'infinite-canvas' ? 0 : item.source === 'custom' ? 1 : 2);
        return sourceWeight(a) - sourceWeight(b) || getPromptTemplateTitle(a, language).localeCompare(getPromptTemplateTitle(b, language));
      })
      .slice(0, 320);
  }, [activeKind, allItems, categoryId, language, search, sourceFilter]);

  const selected = useMemo(
    () => visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || null,
    [selectedId, visibleItems],
  );

  useEffect(() => {
    if (visibleItems.length && !visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0].id);
    }
    if (!visibleItems.length && selectedId) setSelectedId('');
  }, [selectedId, visibleItems]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  const shellClass = isPixel
    ? 'px-card text-[var(--px-ink)]'
    : `rounded-xl border shadow-2xl ${
        isDark ? 'border-white/10 bg-zinc-950 text-zinc-100' : 'border-black/10 bg-white text-zinc-900'
      }`;
  const buttonClass = isPixel
    ? 'px-btn px-btn--sm'
    : `inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors ${
        isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'
      }`;
  const primaryClass = isPixel
    ? 'px-btn px-btn--sm px-btn--yellow'
    : 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-cyan-400 px-3 text-xs font-bold text-slate-950 hover:bg-cyan-300';
  const inputClass = isPixel
    ? 'px-input'
    : `rounded-md border px-3 py-2 text-sm outline-none ${
        isDark ? 'border-white/10 bg-white/5 text-white placeholder:text-white/35' : 'border-black/10 bg-black/[0.03] text-zinc-900 placeholder:text-zinc-400'
      }`;
  const subtle = isPixel ? 'opacity-70' : isDark ? 'text-white/55' : 'text-zinc-500';

  const setLang = (next: PromptTemplateLanguage) => {
    setLanguage(next);
    persist((prev) => ({ ...prev, language: next }));
  };

  const applyTemplate = (mode: 'replace' | 'append' | 'full') => {
    if (!selected) return;
    const text = getPromptTemplateText(selected, language, mode === 'full');
    if (mode === 'append') {
      const base = value.trim();
      onApply(base ? `${base}\n${text}` : text);
    } else {
      onApply(text);
    }
    onClose();
  };

  const saveDraft = () => {
    if (!editDraft?.promptZh.trim() || !editDraft.titleZh.trim()) {
      setMessage(t('promptTemplates.validationRequired'));
      return;
    }
    const nextItem = createCustomPromptTemplate({
      id: editDraft.id,
      kind: editDraft.kind,
      categoryId: editDraft.categoryId || categoryFallback(editDraft.kind),
      titleZh: editDraft.titleZh,
      titleEn: editDraft.titleEn,
      descriptionZh: editDraft.descriptionZh,
      descriptionEn: editDraft.descriptionEn,
      promptZh: editDraft.promptZh,
      promptEn: editDraft.promptEn,
      negativeZh: editDraft.negativeZh,
      negativeEn: editDraft.negativeEn,
      tags: editDraft.tags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean),
      attachments: editDraft.attachments,
    });
    persist((prev) => {
      const exists = prev.customItems.some((item) => item.id === nextItem.id);
      return {
        ...prev,
        customItems: exists ? prev.customItems.map((item) => (item.id === nextItem.id ? { ...nextItem, createdAt: item.createdAt } : item)) : [nextItem, ...prev.customItems],
      };
    });
    setSelectedId(nextItem.id);
    setActiveKind(nextItem.kind);
    setCategoryId(nextItem.categoryId);
    setEditDraft(null);
    setMessage(t('promptTemplates.savedToMine'));
  };

  const saveCurrentAsTemplate = () => {
    if (!value.trim()) {
      setMessage(t('promptTemplates.emptyCurrent'));
      return;
    }
    const category = categoryId === 'all' ? categoryFallback(activeKind) : categoryId;
    setEditDraft(makeEditDraft({
      id: '',
      kind: activeKind,
      categoryId: category,
      titleZh: '来自当前输入框',
      titleEn: 'From Current Prompt',
      descriptionZh: '从当前节点提示词保存',
      descriptionEn: 'Saved from the current node prompt',
      promptZh: value,
      promptEn: value,
      negativeZh: '',
      negativeEn: '',
      tags: ['我的模板'],
      source: 'custom',
    }, activeKind, category));
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (selected.source === 'custom') {
      if (!window.confirm(t('promptTemplates.deleteConfirm', { title: getPromptTemplateTitle(selected, language) }))) return;
      persist((prev) => ({ ...prev, customItems: prev.customItems.filter((item) => item.id !== selected.id) }));
      setMessage(t('promptTemplates.deleted'));
      return;
    }
    if (!window.confirm(t('promptTemplates.hideConfirm', { title: getPromptTemplateTitle(selected, language) }))) return;
    persist((prev) => ({ ...prev, hiddenBuiltInIds: Array.from(new Set([...prev.hiddenBuiltInIds, selected.id])) }));
    setMessage(t('promptTemplates.hidden'));
  };

  const addCategory = () => {
    setMessage('');
    setPromptCategoryDialog({ mode: 'add', kind: activeKind, value: '' });
  };

  const renameCategory = (category: PromptTemplateCategory) => {
    if (category.builtIn) return;
    setMessage('');
    setPromptCategoryDialog({
      mode: 'rename',
      category,
      value: language === 'en' ? category.labelEn : category.labelZh,
    });
  };

  const submitPromptCategoryDialog = () => {
    if (!promptCategoryDialog) return;
    const name = promptCategoryDialog.value.trim();
    if (!name) {
      setMessage(t('promptTemplates.categoryNameRequired'));
      return;
    }
    if (promptCategoryDialog.mode === 'rename') {
      const category = promptCategoryDialog.category;
      persist((prev) => ({
        ...prev,
        customCategories: prev.customCategories.map((cat) => (
          cat.id === category.id ? { ...cat, labelZh: name, labelEn: name } : cat
        )),
      }));
      setPromptCategoryDialog(null);
      setMessage(t('promptTemplates.renamedCategory', { name }));
      return;
    }
    const id = `custom-${activeKind}-${Date.now().toString(36)}`;
    const category: PromptTemplateCategory = {
      id,
      kind: promptCategoryDialog.kind,
      labelZh: name,
      labelEn: name,
      descriptionZh: '我的提示词分类',
      descriptionEn: 'My prompt category',
      order: 1000 + state.customCategories.length,
      builtIn: false,
    };
    persist((prev) => ({ ...prev, customCategories: [...prev.customCategories, category] }));
    setCategoryId(id);
    setPromptCategoryDialog(null);
    setMessage(t('promptTemplates.createdCategory', { name }));
  };

  const deleteCategory = (category: PromptTemplateCategory) => {
    if (category.builtIn) return;
    if (!window.confirm(t('promptTemplates.deleteCategoryConfirm', { name: getPromptTemplateCategoryLabel(category, language) }))) return;
    const fallback = categoryFallback(category.kind);
    persist((prev) => ({
      ...prev,
      customCategories: prev.customCategories.filter((cat) => cat.id !== category.id),
      customItems: prev.customItems.map((item) => (item.categoryId === category.id ? { ...item, categoryId: fallback } : item)),
    }));
    setCategoryId('all');
  };

  const handleExport = () => {
    downloadJson('t8-prompt-template-library.json', exportPromptTemplateBackup(state));
    setMessage(t('promptTemplates.exported'));
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const next = importPromptTemplateBackup(payload, state, 'merge');
      setState(next);
      setMessage(t('promptTemplates.imported', { count: next.customItems.length }));
    } catch (error: any) {
      setMessage(error?.message || t('promptTemplates.importFailed'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveSelectedToResource = async () => {
    if (!selected) return;
    setBusy('resource');
    try {
      let categoryIdForResource = '';
      const cats = await api.getResourceCategories('set');
      if (cats.success) {
        categoryIdForResource = cats.data.find((cat) => /提示词|prompt/i.test(cat.name))?.id || '';
      }
      if (!categoryIdForResource) {
        const created = await api.addResourceCategory('set', '提示词模板');
        if (created.success) categoryIdForResource = created.data.id;
      }
      const title = getPromptTemplateTitle(selected, language);
      const prompt = language === 'en' ? selected.promptEn || selected.promptZh : selected.promptZh || selected.promptEn;
      const negative = language === 'en' ? selected.negativeEn || selected.negativeZh || '' : selected.negativeZh || selected.negativeEn || '';
      const saved = await api.addResourceSet({
        materialSetKind: 'text',
        categoryId: categoryIdForResource || undefined,
        title: `提示词模板 · ${title}`,
        tags: ['提示词模板', kindLabelZh(selected.kind), selected.categoryId, ...selected.tags].slice(0, 20),
        materialSetItems: [
          { kind: 'text', name: '正向提示词', text: prompt },
          ...(negative ? [{ kind: 'text' as const, name: '负向提示词', text: negative }] : []),
          ...((selected.attachments || []).map((attachment) => ({
            kind: attachment.kind,
            name: attachment.title || attachmentKindLabel(attachment.kind),
            url: attachment.url,
            mime: attachment.mime,
          }))),
          {
            kind: 'text',
            name: '模板信息',
            text: JSON.stringify({
              id: selected.id,
              kind: selected.kind,
              categoryId: selected.categoryId,
              titleZh: selected.titleZh,
              titleEn: selected.titleEn,
              source: selected.source,
              tags: selected.tags,
            }, null, 2),
          },
        ],
      });
      if (!saved.success) throw new Error(saved.error || t('promptTemplates.resourceSaveFailed'));
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
      setMessage((saved as any).duplicate ? t('promptTemplates.resourceDuplicate') : t('promptTemplates.resourceSaved'));
    } catch (error: any) {
      setMessage(error?.message || t('promptTemplates.resourceSaveFailed'));
    } finally {
      setBusy('');
    }
  };

  const activeCategory = categories.find((cat) => cat.id === categoryId) || null;
  const selectedText = selected ? getPromptTemplateText(selected, language, false) : '';
  const selectedFullText = selected ? getPromptTemplateText(selected, language, true) : '';
  const handleCopyText = async (text: string) => {
    const copied = await copyText(text);
    setMessage(copied ? t('promptTemplates.copied') : t('promptTemplates.copyUnavailable'));
  };

  return createPortal(
    <div
      data-canvas-floating-ui="prompt-template-library"
      className="fixed inset-0 z-[10140] flex items-center justify-center bg-black/50 p-3"
      onMouseDown={onClose}
    >
      <section
        className={`${shellClass} flex h-[min(88vh,900px)] w-[min(1180px,calc(100vw-24px))] flex-col overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-label={t('promptTemplates.title')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={`flex items-center justify-between gap-3 px-4 py-3 ${isPixel ? 'border-b-2 border-[var(--px-ink)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Library size={16} />
              <span>{t('promptTemplates.title')}</span>
            </div>
            <div className={`mt-0.5 text-[11px] ${subtle}`}>
              {t('promptTemplates.subtitle')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={buttonClass} onClick={() => setLang(language === 'zh' ? 'en' : 'zh')} title={t('promptTemplates.contentLanguageToggle')}>
              <Languages size={13} /> {language === 'zh' ? '中文' : 'EN'}
            </button>
            <button type="button" className={buttonClass} onClick={onClose} title={t('common:actions.close')}>
              <X size={14} />
            </button>
          </div>
        </header>

        <div className={`grid grid-cols-[190px_minmax(260px,330px)_minmax(0,1fr)] gap-0 min-h-0 flex-1 ${isPixel ? '' : ''}`}>
          <aside className={`min-h-0 overflow-y-auto p-3 ${isPixel ? 'border-r-2 border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-r border-white/10 bg-white/[0.02]' : 'border-r border-black/10 bg-black/[0.02]'}`}>
            <div className="grid grid-cols-2 gap-2">
              {(['image', 'video'] as PromptTemplateKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={isPixel ? `px-btn px-btn--sm ${activeKind === kind ? 'px-btn--yellow' : ''}` : `h-9 rounded-md border text-xs font-bold ${activeKind === kind ? 'border-cyan-300 bg-cyan-400 text-slate-950' : isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
                  onClick={() => {
                    setActiveKind(kind);
                    setCategoryId('all');
                    setSelectedId('');
                    setPromptCategoryDialog(null);
                  }}
                >
                  {t(kind === 'image' ? 'promptTemplates.image' : 'promptTemplates.video')}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`mt-3 w-full text-left ${isPixel ? 'px-btn px-btn--sm' : `rounded-md px-2 py-2 text-xs font-bold ${categoryId === 'all' ? 'bg-cyan-400 text-slate-950' : isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}`}
              onClick={() => setCategoryId('all')}
            >
              {t('promptTemplates.all')} <span className="opacity-60">({allItems.filter((item) => item.kind === activeKind).length})</span>
            </button>

            <div className="mt-2 space-y-1">
              {categories.map((category) => {
                const active = category.id === categoryId;
                return (
                  <div key={category.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs ${active ? (isPixel ? 'border-2 border-[var(--px-ink)] bg-[var(--px-yellow)]' : 'bg-cyan-500/15 text-cyan-300') : isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                      onClick={() => setCategoryId(category.id)}
                      title={getPromptTemplateCategoryLabel(category, language)}
                    >
                      <span className="block truncate font-bold">{getPromptTemplateCategoryLabel(category, language)}</span>
                      <span className={`block text-[10px] ${subtle}`}>
                        {t('promptTemplates.builtInCount', { count: categoryCounts[category.id] || 0, builtIn: builtInCounts[category.id] || 0 })}
                      </span>
                    </button>
                    {!category.builtIn && (
                      <div className="hidden shrink-0 group-hover:flex">
                        <button type="button" className="p-1 opacity-70 hover:opacity-100" onClick={() => renameCategory(category)} title={t('promptTemplates.rename')}><Pencil size={11} /></button>
                        <button type="button" className="p-1 text-red-400 opacity-70 hover:opacity-100" onClick={() => deleteCategory(category)} title={t('promptTemplates.delete')}><Trash2 size={11} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button type="button" className={`mt-3 w-full ${buttonClass}`} onClick={addCategory}>
              <Plus size={13} /> {t('promptTemplates.category')}
            </button>
            {promptCategoryDialog && (
              <form
                data-prompt-template-category-dialog
                className={`mt-2 rounded-md border p-2 ${isPixel ? 'border-[var(--px-ink)] bg-[var(--px-surface)]' : isDark ? 'border-white/10 bg-white/[0.04]' : 'border-black/10 bg-white'}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPromptCategoryDialog();
                }}
              >
                <div className={`mb-1 text-[10px] font-bold ${subtle}`}>
                  {promptCategoryDialog.mode === 'add'
                    ? t('promptTemplates.newCategory', { kind: t(promptCategoryDialog.kind === 'image' ? 'promptTemplates.image' : 'promptTemplates.video') })
                    : t('promptTemplates.renameCategory')}
                </div>
                <input
                  className={`${inputClass} h-8 w-full`}
                  value={promptCategoryDialog.value}
                  onChange={(event) => setPromptCategoryDialog((dialog) => (dialog ? { ...dialog, value: event.target.value } : dialog))}
                  placeholder={t('promptTemplates.categoryPlaceholder')}
                  autoFocus
                />
                <div className="mt-2 flex justify-end gap-1.5">
                  <button type="button" className={buttonClass} onClick={() => setPromptCategoryDialog(null)}>{t('common:actions.cancel')}</button>
                  <button type="submit" className={primaryClass}>{t('common:actions.save')}</button>
                </div>
              </form>
            )}
            {state.hiddenBuiltInIds.length > 0 && (
              <button
                type="button"
                className={`mt-2 w-full ${buttonClass}`}
                onClick={() => {
                  persist((prev) => ({ ...prev, hiddenBuiltInIds: [] }));
                  setMessage(t('promptTemplates.restoredBuiltin'));
                }}
              >
                <RotateCcw size={13} /> {t('promptTemplates.restoreBuiltin')}
              </button>
            )}
          </aside>

          <section className={`min-h-0 overflow-hidden p-3 ${isPixel ? 'border-r-2 border-[var(--px-ink)]' : isDark ? 'border-r border-white/10' : 'border-r border-black/10'}`}>
            <div className="space-y-2">
              <div className="relative">
                <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${subtle}`} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('promptTemplates.searchPlaceholder')}
                  className={`${inputClass} h-9 w-full pl-8`}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['all', 'builtin', 'mine'] as SourceFilter[]).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={isPixel ? `px-btn px-btn--sm ${sourceFilter === filter ? 'px-btn--yellow' : ''}` : `h-8 rounded-md border text-[11px] font-bold ${sourceFilter === filter ? 'border-cyan-300 bg-cyan-400 text-slate-950' : isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
                    onClick={() => setSourceFilter(filter)}
                  >
                    {t(filter === 'all' ? 'promptTemplates.all' : filter === 'builtin' ? 'promptTemplates.builtin' : 'promptTemplates.mine')}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={buttonClass} onClick={saveCurrentAsTemplate}>
                  <BookmarkPlus size={13} /> {t('promptTemplates.saveCurrent')}
                </button>
                <button type="button" className={buttonClass} onClick={() => setEditDraft(makeEditDraft(null, activeKind, categoryId === 'all' ? categoryFallback(activeKind) : categoryId))}>
                  <Plus size={13} /> {t('promptTemplates.newTemplate')}
                </button>
              </div>
            </div>

            <div className="mt-3 min-h-0 overflow-y-auto pr-1" style={{ height: 'calc(100% - 126px)' }}>
              {visibleItems.length === 0 ? (
                <div className={`flex h-52 items-center justify-center rounded border border-dashed text-xs ${subtle}`}>
                  {t('promptTemplates.noMatches')}
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleItems.map((item) => {
                    const active = selected?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`w-full rounded-lg border p-2 text-left transition ${active ? (isPixel ? 'border-[var(--px-ink)] bg-[var(--px-yellow)]' : 'border-cyan-300 bg-cyan-400/10') : isDark ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]' : 'border-black/10 bg-black/[0.025] hover:bg-black/[0.05]'}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-xs font-bold">{getPromptTemplateTitle(item, language)}</span>
                          <span className={`flex shrink-0 items-center gap-1 text-[10px] ${subtle}`}>
                            {(item.attachments?.length || 0) > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                <Paperclip size={10} /> {item.attachments?.length}
                              </span>
                            )}
                            {t(item.source === 'custom' ? 'promptTemplates.mine' : 'promptTemplates.builtin')}
                          </span>
                        </div>
                        <div className={`mt-1 line-clamp-2 text-[10px] leading-relaxed ${subtle}`}>
                          {getPromptTemplateDescription(item, language) || getPromptTemplateText(item, language).slice(0, 120)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <main className="flex min-h-0 flex-col p-3">
            {message && (
              <div className={`mb-2 rounded px-2 py-1 text-[11px] ${isPixel ? 'border-2 border-[var(--px-ink)] bg-[var(--px-yellow)]' : isDark ? 'bg-white/10 text-white/75' : 'bg-black/5 text-zinc-600'}`}>
                {message}
              </div>
            )}

            {editDraft ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold">{t(editDraft.id ? 'promptTemplates.editMine' : 'promptTemplates.newMine')}</div>
                  <button type="button" className={buttonClass} onClick={() => setEditDraft(null)}>
                    <X size={13} /> {t('common:actions.cancel')}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputClass} value={editDraft.titleZh} onChange={(event) => setEditDraft({ ...editDraft, titleZh: event.target.value })} placeholder={t('promptTemplates.chineseTitle')} />
                  <input className={inputClass} value={editDraft.titleEn} onChange={(event) => setEditDraft({ ...editDraft, titleEn: event.target.value })} placeholder={t('promptTemplates.englishTitle')} />
                  <select className={inputClass} value={editDraft.kind} onChange={(event) => {
                    const kind = event.target.value as PromptTemplateKind;
                    setEditDraft({ ...editDraft, kind, categoryId: categoryFallback(kind) });
                  }}>
                    <option value="image">{t('promptTemplates.imageTemplate')}</option>
                    <option value="video">{t('promptTemplates.videoTemplate')}</option>
                  </select>
                  <select className={inputClass} value={editDraft.categoryId} onChange={(event) => setEditDraft({ ...editDraft, categoryId: event.target.value })}>
                    {getPromptTemplateCategories(editDraft.kind, state.customCategories).map((cat) => (
                      <option key={cat.id} value={cat.id}>{getPromptTemplateCategoryLabel(cat, language)}</option>
                    ))}
                  </select>
                </div>
                <textarea className={`${inputClass} min-h-[58px] resize-none`} value={editDraft.descriptionZh} onChange={(event) => setEditDraft({ ...editDraft, descriptionZh: event.target.value })} placeholder={t('promptTemplates.chineseDescription')} />
                <textarea className={`${inputClass} min-h-[58px] resize-none`} value={editDraft.descriptionEn} onChange={(event) => setEditDraft({ ...editDraft, descriptionEn: event.target.value })} placeholder={t('promptTemplates.englishDescription')} />
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
                  <textarea className={`${inputClass} min-h-[220px] resize-none`} value={editDraft.promptZh} onChange={(event) => setEditDraft({ ...editDraft, promptZh: event.target.value })} placeholder={t('promptTemplates.chinesePositive')} />
                  <textarea className={`${inputClass} min-h-[220px] resize-none`} value={editDraft.promptEn} onChange={(event) => setEditDraft({ ...editDraft, promptEn: event.target.value })} placeholder={t('promptTemplates.englishPositive')} />
                  <textarea className={`${inputClass} min-h-[110px] resize-none`} value={editDraft.negativeZh} onChange={(event) => setEditDraft({ ...editDraft, negativeZh: event.target.value })} placeholder={t('promptTemplates.chineseNegative')} />
                  <textarea className={`${inputClass} min-h-[110px] resize-none`} value={editDraft.negativeEn} onChange={(event) => setEditDraft({ ...editDraft, negativeEn: event.target.value })} placeholder={t('promptTemplates.englishNegative')} />
                </div>
                <input className={inputClass} value={editDraft.tags} onChange={(event) => setEditDraft({ ...editDraft, tags: event.target.value })} placeholder={t('promptTemplates.tagsPlaceholder')} />
                {editDraft.attachments.length > 0 && (
                  <div className={`rounded border px-2 py-1.5 text-[11px] ${isPixel ? 'border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-white/10 bg-white/[0.03] text-white/60' : 'border-black/10 bg-black/[0.025] text-zinc-500'}`}>
                    {t('promptTemplates.attachmentsRetained', { count: editDraft.attachments.length })}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" className={buttonClass} onClick={() => setEditDraft(null)}>{t('common:actions.cancel')}</button>
                  <button type="button" className={primaryClass} onClick={saveDraft}>
                    <Save size={13} /> {t('promptTemplates.saveTemplate')}
                  </button>
                </div>
              </div>
            ) : selected ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold">{getPromptTemplateTitle(selected, language)}</div>
                    <div className={`mt-1 text-[11px] ${subtle}`}>
                      {t(selected.kind === 'image' ? 'promptTemplates.image' : 'promptTemplates.video')} · {activeCategory ? getPromptTemplateCategoryLabel(activeCategory, language) : selected.categoryId} · {t(selected.source === 'custom' ? 'promptTemplates.mine' : 'promptTemplates.builtin')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" className={buttonClass} onClick={() => setEditDraft(makeEditDraft(selected, activeKind, selected.categoryId))} title={t(selected.source === 'custom' ? 'promptTemplates.edit' : 'promptTemplates.copyAfterEdit')}>
                      <Pencil size={13} /> {t(selected.source === 'custom' ? 'promptTemplates.edit' : 'promptTemplates.copy')}
                    </button>
                    <button type="button" className={buttonClass} onClick={deleteSelected} title={t(selected.source === 'custom' ? 'promptTemplates.delete' : 'promptTemplates.hide')}>
                      <Trash2 size={13} /> {t(selected.source === 'custom' ? 'promptTemplates.delete' : 'promptTemplates.hide')}
                    </button>
                  </div>
                </div>

                <div className={`mt-3 rounded-lg border p-3 text-xs leading-relaxed ${isPixel ? 'border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-black/[0.025]'}`}>
                  {getPromptTemplateDescription(selected, language)}
                </div>

                {(selected.attachments?.length || 0) > 0 && (
                  <div
                    data-prompt-template-media-preview
                    className={`mt-3 rounded-lg border p-3 ${
                      isPixel ? 'border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-black/[0.025]'
                    }`}
                  >
                    <div className={`mb-2 flex items-center justify-between gap-2 text-[10px] font-bold ${subtle}`}>
                      <span className="inline-flex items-center gap-1.5">
                        <Paperclip size={12} /> {t('promptTemplates.assets')}
                      </span>
                      <span>{t('promptTemplates.assetCount', { count: selected.attachments?.length || 0 })}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                      {(selected.attachments || []).map((attachment) => (
                        <div
                          key={attachment.id}
                          className={`overflow-hidden rounded-md border ${
                            isPixel ? 'border-[var(--px-ink)] bg-[var(--px-surface)]' : isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-white/70'
                          }`}
                        >
                          <div className="group/prompt-media relative h-28 overflow-hidden bg-black/80">
                            {attachment.kind === 'image' ? (
                              <>
                                <SmartImage
                                  src={attachment.previewUrl || attachment.url}
                                  alt={attachment.title || t('promptTemplates.associatedImage')}
                                  className="h-full w-full object-contain"
                                  thumbSize={360}
                                  draggable={false}
                                />
                                <ImageHoverPreview
                                  src={attachment.url}
                                  alt={attachment.title || t('promptTemplates.associatedImage')}
                                  buttonClassName="absolute right-1.5 top-1.5 z-10 h-7 w-7 p-0 opacity-0 shadow-md transition group-hover/prompt-media:opacity-100 focus:opacity-100"
                                />
                              </>
                            ) : attachment.kind === 'video' ? (
                              <video
                                src={attachment.url}
                                poster={attachment.previewUrl}
                                controls
                                preload="metadata"
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-2 text-white">
                                <Music size={28} />
                                <audio src={attachment.url} controls preload="none" className="w-full" />
                              </div>
                            )}
                          </div>
                          <div className={`flex items-center gap-1.5 px-2 py-1.5 text-[10px] ${subtle}`}>
                            {attachmentIcon(attachment.kind)}
                            <span className="min-w-0 flex-1 truncate" title={attachment.title || attachment.url}>
                              {attachment.title || attachment.url.split('/').pop() || t(`promptTemplates.${attachment.kind}`)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden">
                  <div className="min-h-0 overflow-y-auto rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap select-text" style={{
                    borderColor: isPixel ? 'var(--px-ink, #1a1410)' : isDark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)',
                    background: isPixel ? 'var(--px-surface, #fff7df)' : isDark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.025)',
                  }}>
                    <div className={`mb-2 text-[10px] font-bold ${subtle}`}>{t('promptTemplates.positive')}</div>
                    {selectedText}
                    {(language === 'en' ? selected.negativeEn || selected.negativeZh : selected.negativeZh || selected.negativeEn) && (
                      <>
                        <div className={`mb-2 mt-4 text-[10px] font-bold ${subtle}`}>{t('promptTemplates.negative')}</div>
                        {language === 'en' ? selected.negativeEn || selected.negativeZh : selected.negativeZh || selected.negativeEn}
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={buttonClass} onClick={() => void handleCopyText(selectedText)}>
                      <Copy size={13} /> {t('promptTemplates.copyPositive')}
                    </button>
                    <button type="button" className={buttonClass} onClick={() => void handleCopyText(selectedFullText)}>
                      <FileDown size={13} /> {t('promptTemplates.copyBoth')}
                    </button>
                    <button type="button" className={buttonClass} onClick={saveSelectedToResource} disabled={busy === 'resource'}>
                      <Download size={13} /> {t(busy === 'resource' ? 'promptTemplates.saving' : 'promptTemplates.resourceLibrary')}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={buttonClass} onClick={() => applyTemplate('append')}>
                      <Plus size={13} /> {t('promptTemplates.append')}
                    </button>
                    <button type="button" className={buttonClass} onClick={() => applyTemplate('full')}>
                      <Check size={13} /> {t('promptTemplates.positiveNegative')}
                    </button>
                    <button type="button" className={primaryClass} onClick={() => applyTemplate('replace')}>
                      <Check size={13} /> {t('promptTemplates.replace')}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className={`flex flex-1 items-center justify-center text-sm ${subtle}`}>{t('promptTemplates.selectOrCreate')}</div>
            )}
          </main>
        </div>

        <footer className={`flex items-center justify-between gap-2 px-4 py-3 ${isPixel ? 'border-t-2 border-[var(--px-ink)]' : isDark ? 'border-t border-white/10' : 'border-t border-black/10'}`}>
          <div className={`text-[11px] ${subtle}`}>
            {t('promptTemplates.footer')}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleImport(event.target.files?.[0] || null)}
            />
            <button type="button" className={buttonClass} onClick={() => fileRef.current?.click()}>
              <FileUp size={13} /> {t('promptTemplates.import')}
            </button>
            <button type="button" className={buttonClass} onClick={handleExport}>
              <FileDown size={13} /> {t('promptTemplates.export')}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
