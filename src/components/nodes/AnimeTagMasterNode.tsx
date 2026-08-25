import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Images,
  Library,
  Plus,
  Save,
  Search,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PORT_COLOR } from '../../config/portTypes';
import { ANIME_TAG_MASTER_CATEGORIES, ANIME_TAG_MASTER_ITEMS } from '../../data/animeTagMasterManifest';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { defaultSizeOf, placeSingleNode } from '../../utils/nodePlacement';
import {
  ANIME_TAG_MASTER_EVENT,
  ANIME_TAG_MASTER_STORAGE_KEY,
  ANIME_TAG_ONLINE_CATEGORY_OPTIONS,
  ANIME_TAG_ONLINE_PROVIDERS,
  buildAnimeTagLivePreviewImageUrl,
  buildAnimeTagProxyPostsUrl,
  buildAnimeTagProxyTagsUrl,
  buildAnimeTagPreviewUrl,
  buildAnimeTagOutputPayload,
  buildAnimeTagPrompt,
  createAnimeTagPreviewFallbackSvg,
  createAnimeTagExport,
  getAnimeTagFullImageUrl,
  getAnimeTagPreviewImageUrl,
  importAnimeTagExport,
  mergeAnimeTagLibraries,
  normalizeAnimeTagItem,
  normalizeAnimeTagLibrary,
  pickAnimeTagPreviewQuery,
  resolveAnimeTagOnlineCategory,
  searchAnimeTags,
  slugifyAnimeTag,
  upsertAnimeTagInLibrary,
  type AnimeTagCategory,
  type AnimeTagItem,
  type AnimeTagOnlineCategoryId,
  type AnimeTagOutputMode,
  type AnimeTagUserLibrary,
} from '../../utils/animeTagMaster';
import { useUpdateNodeData } from './useUpdateNodeData';
import InspirationVisible from '../../i18n/InspirationVisible';

const EMPTY_LIBRARY: AnimeTagUserLibrary = { categories: [], items: [] };
const EMPTY_CUSTOM_DRAFT = {
  name: '',
  chineseName: '',
  category: '',
  tags: '',
  prompt: '',
  negativePrompt: '',
  imageUrl: '',
  attributes: '',
};

type AnimeTagLazyPreviewState = {
  status: 'loading' | 'ready' | 'empty' | 'error';
  imageUrl?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  error?: string;
};

type AnimeTagHoverPreviewState = {
  item: AnimeTagItem;
  x: number;
  y: number;
};

type AnimeTagOnlineRequestState = {
  provider: 'danbooru' | 'gelbooru';
  category: AnimeTagOnlineCategoryId;
  query: string;
  letter: string;
};

const handleStyle = {
  width: 12,
  height: 12,
  border: '2px solid var(--atm-handle-border, #0f172a)',
  boxShadow: '0 0 0 2px var(--atm-bg, #f7fee7)',
};
const ONLINE_FETCH_TIMEOUT_MS = 20000;
const PREVIEW_RETRY_DELAYS_MS = [650, 1400, 2600];

function stopCanvasWheel(event: React.WheelEvent) {
  event.stopPropagation();
}

function makeAbortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function waitForPreviewRetry(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };
    timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchPreviewPayload(url: string, signal?: AbortSignal) {
  if (signal?.aborted) throw makeAbortError();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ONLINE_FETCH_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } catch (error: any) {
    if (error?.name === 'AbortError' && timedOut) {
      throw new Error(`预览请求超时 ${Math.round(ONLINE_FETCH_TIMEOUT_MS / 1000)} 秒`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

async function fetchPreviewWithRetries(url: string, fallbackImageUrl = '', signal?: AbortSignal) {
  let lastError = '在线预览加载失败';
  for (let attempt = 0; attempt <= PREVIEW_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const { response, payload } = await fetchPreviewPayload(url, signal);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      const remoteItem = payload?.data?.item || {};
      const imageUrl = String(remoteItem.imageUrl || payload?.data?.imageUrl || '').trim();
      const thumbnailUrl = String(remoteItem.thumbnailUrl || payload?.data?.thumbnailUrl || imageUrl).trim();
      const usableImageUrl = imageUrl || thumbnailUrl || fallbackImageUrl;
      const sourceUrl = String(remoteItem.sourceUrl || payload?.data?.sourceUrl || '').trim();
      if (!usableImageUrl) {
        throw new Error('没有找到可预览图片');
      }
      return {
        imageUrl: usableImageUrl,
        thumbnailUrl: thumbnailUrl || usableImageUrl,
        sourceUrl,
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
      lastError = error?.message || '在线预览加载失败';
      if (attempt >= PREVIEW_RETRY_DELAYS_MS.length) break;
      await waitForPreviewRetry(PREVIEW_RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw new Error(`预览已重试 3 次：${lastError}`);
}

function readLibrary(): AnimeTagUserLibrary {
  if (typeof window === 'undefined') return EMPTY_LIBRARY;
  try {
    const raw = window.localStorage.getItem(ANIME_TAG_MASTER_STORAGE_KEY);
    return raw ? normalizeAnimeTagLibrary(JSON.parse(raw)) : EMPTY_LIBRARY;
  } catch {
    return EMPTY_LIBRARY;
  }
}

function writeLibrary(library: AnimeTagUserLibrary) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ANIME_TAG_MASTER_STORAGE_KEY, JSON.stringify(normalizeAnimeTagLibrary(library)));
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

function toCategoryOptions(items: readonly AnimeTagCategory[], english: boolean) {
  const englishNames: Record<string, string> = {
    artist: 'Artist',
    copyright: 'Copyright',
    character: 'Character',
    general: 'General',
    meta: 'Style / Meta',
  };
  return items.map((item) => ({
    value: item.id,
    label: english && item.builtIn
      ? englishNames[item.id] || item.name.split('/').at(-1)?.trim() || item.name
      : item.name,
  }));
}

function displayOnlineCategoryName(item: { id: string; name: string }, english: boolean) {
  if (!english) return item.name;
  const englishNames: Record<string, string> = {
    artist: 'Artist',
    copyright: 'Copyright',
    character: 'Character',
    'general-meta': 'General / Meta',
  };
  return englishNames[item.id] || item.name;
}

function displayAnimeTagName(item: AnimeTagItem | null | undefined, english: boolean) {
  if (!item) return '';
  return english && !item.userCreated ? item.name || item.chineseName : item.chineseName || item.name;
}

function displayAnimeTagCategory(item: AnimeTagItem | null | undefined, english: boolean) {
  if (!item) return '';
  if (!english || item.userCreated) return item.categoryName;
  const englishNames: Record<string, string> = {
    artist: 'Artist',
    copyright: 'Copyright',
    character: 'Character',
    general: 'General',
    meta: 'Style / Meta',
  };
  const builtIn = ANIME_TAG_MASTER_CATEGORIES.find((category) => category.id === item.categoryId);
  return englishNames[item.categoryId] || builtIn?.name.split('/').at(-1)?.trim() || item.categoryId || item.categoryName;
}

function categoryToOnlineCategory(value: string): AnimeTagOnlineCategoryId | null {
  const categoryId = String(value || '').trim().toLowerCase();
  if (categoryId === 'artist' || categoryId === 'copyright' || categoryId === 'character') return categoryId;
  if (categoryId === 'general' || categoryId === 'meta' || categoryId === 'general-meta') return 'general-meta';
  return null;
}

const legacyDefaultOnlineQueries = new Set(['1girl', '1 girl', 'hatsune_miku / 1girl', 'hatsune_miku / 1 girl']);

function initialOnlineQuery(value: unknown): string {
  const text = String(value || '').trim();
  return legacyDefaultOnlineQueries.has(text.toLowerCase()) ? '' : text;
}

function AnimeTagPreviewImage({
  item,
  alt,
  className,
  preferFull = false,
  allowLivePreview = true,
  previewState,
  onRetry,
}: {
  item?: AnimeTagItem | null;
  alt: string;
  className?: string;
  preferFull?: boolean;
  allowLivePreview?: boolean;
  previewState?: AnimeTagLazyPreviewState;
  onRetry?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [tryFull, setTryFull] = useState(false);
  useEffect(() => {
    setFailed(false);
    setTryFull(false);
  }, [allowLivePreview, item?.id, item?.imageUrl, item?.thumbnailUrl]);
  if (!item) return <span className="anime-tag-master-no-image"><Tags size={26} /> TAG</span>;
  const hasDirectImage = Boolean(item.imageUrl || item.thumbnailUrl);
  const isOnlineItem = item.source === 'danbooru' || item.source === 'gelbooru';
  const isMissingOnlinePreview = isOnlineItem && (failed || previewState?.status === 'empty' || previewState?.status === 'error');
  if (isMissingOnlinePreview) {
    return (
      <span
        role="button"
        tabIndex={0}
        className="anime-tag-master-no-image is-online-preview-missing"
        onClick={(event) => {
          event.stopPropagation();
          onRetry?.();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          onRetry?.();
        }}
        title={previewState?.error || '点击重试预览'}
      >
        <ImageIcon size={24} />
        未获取到预览
        <small>重试预览</small>
      </span>
    );
  }
  const isOnlinePreviewPlaceholder = !allowLivePreview
    && !hasDirectImage
    && isOnlineItem;
  if (isOnlinePreviewPlaceholder) {
    return (
      <span className="anime-tag-master-no-image is-online-preview-loading">
        <ImageIcon size={24} />
        {previewState?.status === 'loading' ? '预览加载中' : '滚动到此处加载'}
      </span>
    );
  }
  const previewSrc = !allowLivePreview && !hasDirectImage
    ? createAnimeTagPreviewFallbackSvg(item)
    : (preferFull || tryFull ? getAnimeTagFullImageUrl(item) : getAnimeTagPreviewImageUrl(item));
  const fullSrc = !allowLivePreview && !hasDirectImage ? '' : getAnimeTagFullImageUrl(item);
  const src = failed
    ? createAnimeTagPreviewFallbackSvg(item)
    : previewSrc;
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (!preferFull && !tryFull && fullSrc && fullSrc !== src) {
          setTryFull(true);
          return;
        }
        setFailed(true);
      }}
    />
  );
}

function AnimeTagMasterNode({ id, data, selected }: NodeProps) {
  const { i18n } = useTranslation();
  const isEnglish = (i18n.resolvedLanguage || i18n.language).toLowerCase().startsWith('en');
  const rf = useReactFlow();
  const update = useUpdateNodeData(id);
  const importRef = useRef<HTMLInputElement | null>(null);
  const customImageUploadRef = useRef<HTMLInputElement | null>(null);
  const onlineAbortRef = useRef<AbortController | null>(null);
  const [library, setLibrary] = useState<AnimeTagUserLibrary>(() => readLibrary());
  const [query, setQuery] = useState(String((data as any)?.animeTagQuery || ''));
  const [category, setCategory] = useState(String((data as any)?.animeTagCategory || 'all'));
  const [source, setSource] = useState(String((data as any)?.animeTagSource || 'all'));
  const [provider, setProvider] = useState<'danbooru' | 'gelbooru'>(
    (data as any)?.animeTagProvider === 'gelbooru' ? 'gelbooru' : 'danbooru',
  );
  const [onlineQuery, setOnlineQuery] = useState(() => initialOnlineQuery((data as any)?.animeTagOnlineQuery));
  const [onlineCategory, setOnlineCategory] = useState<AnimeTagOnlineCategoryId>(
    ((data as any)?.animeTagOnlineCategory || 'artist') as AnimeTagOnlineCategoryId,
  );
  const [onlineLetter, setOnlineLetter] = useState('all');
  const [onlinePage, setOnlinePage] = useState(1);
  const [onlineTagReturnPage, setOnlineTagReturnPage] = useState(1);
  const [onlineTotal, setOnlineTotal] = useState(0);
  const [onlineTotalPages, setOnlineTotalPages] = useState(1);
  const [onlineTotalKnown, setOnlineTotalKnown] = useState(true);
  const [onlineHasMore, setOnlineHasMore] = useState(false);
  const [onlineMode, setOnlineMode] = useState<'tags' | 'posts'>('tags');
  const [onlineActiveTag, setOnlineActiveTag] = useState<AnimeTagItem | null>(null);
  const [onlineResults, setOnlineResults] = useState<AnimeTagItem[]>([]);
  const [outputMode, setOutputMode] = useState<AnimeTagOutputMode>(
    (data as any)?.animeTagOutputMode === 'image' ? 'image' : 'tags',
  );
  const [selectedId, setSelectedId] = useState(String((data as any)?.animeTagSelectedId || ANIME_TAG_MASTER_ITEMS[0]?.id || ''));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<AnimeTagHoverPreviewState | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renameCategoryId, setRenameCategoryId] = useState('');
  const [renameCategoryName, setRenameCategoryName] = useState('');
  const [customDraft, setCustomDraft] = useState(EMPTY_CUSTOM_DRAFT);
  const [editingItemId, setEditingItemId] = useState('');
  const [status, setStatus] = useState('搜索动漫标签，运行后输出标签文本或图库参考图。');
  const [lazyPreviewById, setLazyPreviewById] = useState<Record<string, AnimeTagLazyPreviewState>>({});
  const lazyPreviewRef = useRef<Record<string, AnimeTagLazyPreviewState>>({});
  const onlineRequestRef = useRef<AnimeTagOnlineRequestState>({
    provider,
    category: onlineCategory,
    query: onlineQuery,
    letter: onlineLetter,
  });

  const patchOnlineRequest = useCallback((patch: Partial<AnimeTagOnlineRequestState>) => {
    onlineRequestRef.current = { ...onlineRequestRef.current, ...patch };
  }, []);

  const clearOnlineListing = useCallback(() => {
    setOnlineResults([]);
    setOnlineTotal(0);
    setOnlineTotalPages(1);
    setOnlineTotalKnown(true);
    setOnlineHasMore(false);
    setOnlineActiveTag(null);
  }, []);

  const updateSource = useCallback((value: string) => {
    const nextSource = String(value || 'all');
    setSource(nextSource);
    if (nextSource === 'danbooru' || nextSource === 'gelbooru') {
      patchOnlineRequest({ provider: nextSource });
      setProvider(nextSource);
      clearOnlineListing();
      setOnlinePage(1);
    }
  }, [clearOnlineListing, patchOnlineRequest]);

  const updateProvider = useCallback((value: string) => {
    const nextProvider = value === 'gelbooru' ? 'gelbooru' : 'danbooru';
    patchOnlineRequest({ provider: nextProvider });
    setProvider(nextProvider);
    setSource(nextProvider);
    if (categoryToOnlineCategory(category)) {
      setCategory(resolveAnimeTagOnlineCategory(nextProvider, categoryToOnlineCategory(category) || onlineCategory));
    }
    clearOnlineListing();
    setOnlinePage(1);
  }, [category, clearOnlineListing, onlineCategory, patchOnlineRequest]);

  const updateCategory = useCallback((value: string) => {
    const nextCategory = String(value || 'all');
    setCategory(nextCategory);
    const nextOnlineCategory = categoryToOnlineCategory(nextCategory);
    if (nextOnlineCategory) {
      patchOnlineRequest({ category: nextOnlineCategory });
      setOnlineCategory(nextOnlineCategory);
      setOnlineMode('tags');
      clearOnlineListing();
      setOnlinePage(1);
    }
  }, [clearOnlineListing, patchOnlineRequest]);

  const updateOnlineCategory = useCallback((value: AnimeTagOnlineCategoryId) => {
    const nextOnlineCategory = value || 'general-meta';
    patchOnlineRequest({ category: nextOnlineCategory });
    setOnlineCategory(nextOnlineCategory);
    const activeProvider = onlineRequestRef.current.provider === 'gelbooru' ? 'gelbooru' : 'danbooru';
    setCategory(resolveAnimeTagOnlineCategory(activeProvider, nextOnlineCategory));
    setOnlineMode('tags');
    clearOnlineListing();
    setOnlinePage(1);
  }, [clearOnlineListing, patchOnlineRequest]);

  const updateOnlineQuery = useCallback((value: string) => {
    const nextQuery = String(value || '');
    patchOnlineRequest({ query: nextQuery });
    setOnlineQuery(nextQuery);
    clearOnlineListing();
    setOnlineMode('tags');
    setOnlinePage(1);
  }, [clearOnlineListing, patchOnlineRequest]);

  const updateOnlineLetter = useCallback((value: string) => {
    const nextLetter = String(value || 'all');
    patchOnlineRequest({ letter: nextLetter });
    setOnlineLetter(nextLetter);
    setOnlineMode('tags');
    clearOnlineListing();
    setOnlinePage(1);
  }, [clearOnlineListing, patchOnlineRequest]);

  useEffect(() => {
    writeLibrary(library);
  }, [library]);

  useEffect(() => {
    onlineRequestRef.current = {
      provider,
      category: onlineCategory,
      query: onlineQuery,
      letter: onlineLetter,
    };
  }, [onlineCategory, onlineLetter, onlineQuery, provider]);

  useEffect(() => {
    lazyPreviewRef.current = lazyPreviewById;
  }, [lazyPreviewById]);

  useEffect(() => {
    const onLibraryChanged = () => setLibrary(readLibrary());
    window.addEventListener(ANIME_TAG_MASTER_EVENT, onLibraryChanged);
    return () => window.removeEventListener(ANIME_TAG_MASTER_EVENT, onLibraryChanged);
  }, []);

  const allItems = useMemo(() => {
    return [...ANIME_TAG_MASTER_ITEMS, ...library.items, ...onlineResults] as AnimeTagItem[];
  }, [library.items, onlineResults]);

  const categoryOptions = useMemo(() => {
    const merged = new Map<string, AnimeTagCategory>();
    [...ANIME_TAG_MASTER_CATEGORIES, ...library.categories].forEach((item) => {
      if (item.id) merged.set(item.id, item);
    });
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }, [library.categories]);

  const filteredItems = useMemo(() => {
    return searchAnimeTags(allItems, { query, category: onlineMode === 'posts' ? 'all' : category, source });
  }, [allItems, category, onlineMode, query, source]);

  const selectedTag = useMemo(() => {
    return allItems.find((item) => item.id === selectedId) || filteredItems[0] || allItems[0];
  }, [allItems, filteredItems, selectedId]);

  useEffect(() => {
    if (selectedTag && selectedTag.id !== selectedId) {
      setSelectedId(selectedTag.id);
    }
  }, [selectedId, selectedTag]);

  const itemWithLazyPreview = useCallback((item?: AnimeTagItem | null): AnimeTagItem | null => {
    if (!item) return null;
    const preview = lazyPreviewById[item.id];
    if (preview?.status !== 'ready' || !preview.imageUrl) return item;
    return {
      ...item,
      imageUrl: preview.imageUrl,
      thumbnailUrl: preview.thumbnailUrl || preview.imageUrl,
      sourceUrl: preview.sourceUrl || item.sourceUrl,
    };
  }, [lazyPreviewById]);

  const visiblePreviewItemsById = useMemo(() => {
    const byId = new Map<string, AnimeTagItem>();
    filteredItems.forEach((item) => byId.set(item.id, item));
    if (selectedTag) byId.set(selectedTag.id, selectedTag);
    return byId;
  }, [filteredItems, selectedTag]);

  const previewProviderFor = useCallback((item: AnimeTagItem): 'danbooru' | 'gelbooru' => (
    item.source === 'gelbooru' || item.source === 'danbooru' ? item.source : provider
  ), [provider]);

  const requestLazyPreview = useCallback(async (item: AnimeTagItem, signal?: AbortSignal): Promise<AnimeTagItem> => {
    if (item.imageUrl || item.thumbnailUrl) return item;
    const current = lazyPreviewRef.current[item.id];
    if (current?.status === 'ready' && current.imageUrl) {
      return {
        ...item,
        imageUrl: current.imageUrl,
        thumbnailUrl: current.thumbnailUrl || current.imageUrl,
        sourceUrl: current.sourceUrl || item.sourceUrl,
      };
    }
    const tagQuery = pickAnimeTagPreviewQuery(item);
    if (!tagQuery) return item;
    const primaryProvider = previewProviderFor(item);
    const previewProviders: Array<'danbooru' | 'gelbooru'> = item.source === 'danbooru' || item.source === 'gelbooru'
      ? [primaryProvider]
      : [primaryProvider, primaryProvider === 'danbooru' ? 'gelbooru' : 'danbooru'];
    setLazyPreviewById((prev) => ({
      ...prev,
      [item.id]: { ...prev[item.id], status: 'loading' },
    }));

    let lastError = '';
    try {
      for (const previewProvider of previewProviders) {
        const fallbackImageUrl = item.source === 'builtin'
          ? buildAnimeTagLivePreviewImageUrl(previewProvider, tagQuery, { safe: true })
          : '';
        try {
          const preview = await fetchPreviewWithRetries(
            buildAnimeTagPreviewUrl(previewProvider, tagQuery, { safe: true }),
            fallbackImageUrl,
            signal,
          );
          const sourceUrl = preview.sourceUrl || item.sourceUrl || '';
          const next: AnimeTagLazyPreviewState = {
            status: 'ready',
            imageUrl: preview.imageUrl,
            thumbnailUrl: preview.thumbnailUrl || preview.imageUrl,
            sourceUrl,
          };
          setLazyPreviewById((prev) => ({ ...prev, [item.id]: next }));
          return { ...item, imageUrl: preview.imageUrl, thumbnailUrl: preview.thumbnailUrl || preview.imageUrl, sourceUrl };
        } catch (error: any) {
          if (error?.name === 'AbortError') throw error;
          lastError = `${previewProvider}: ${error?.message || '在线预览加载失败'}`;
        }
      }
      setLazyPreviewById((prev) => ({ ...prev, [item.id]: { status: 'empty', error: lastError } }));
      return item;
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        setLazyPreviewById((prev) => ({
          ...prev,
          [item.id]: { status: 'error', error: error?.message || '在线预览加载失败' },
        }));
      }
      return item;
    }
  }, [previewProviderFor]);

  const queueVisiblePreview = useCallback((item?: AnimeTagItem | null, force = false) => {
    if (!item || item.imageUrl || item.thumbnailUrl) return;
    const state = lazyPreviewRef.current[item.id]?.status;
    if (!force && (state === 'loading' || state === 'ready' || state === 'empty' || state === 'error')) return;
    void requestLazyPreview(item);
  }, [requestLazyPreview]);

  const previewSeedItems = useMemo(() => {
    const byId = new Map<string, AnimeTagItem>();
    const previewSeedLimit = libraryOpen ? 12 : 8;
    if (selectedTag) byId.set(selectedTag.id, selectedTag);
    filteredItems.slice(0, previewSeedLimit).forEach((item) => byId.set(item.id, item));
    return Array.from(byId.values());
  }, [filteredItems, libraryOpen, selectedTag]);

  useEffect(() => {
    const candidates = previewSeedItems
      .filter((item) => !item.imageUrl && !item.thumbnailUrl)
      .filter((item) => {
        const state = lazyPreviewRef.current[item.id]?.status;
        return state !== 'loading' && state !== 'ready' && state !== 'empty' && state !== 'error';
      })
      .slice(0, libraryOpen ? 12 : 8);
    if (!candidates.length) return undefined;

    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      for (let i = 0; i < candidates.length && !cancelled; i += 4) {
        const batch = candidates.slice(i, i + 4);
        await Promise.all(batch.map((item) => requestLazyPreview(item, controller.signal)));
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [libraryOpen, previewSeedItems, requestLazyPreview]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-anime-tag-preview-id]'))
      .filter((element) => element.dataset.animeTagPreviewOwner === id);
    if (!elements.length) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      elements.forEach((element) => {
        const item = visiblePreviewItemsById.get(element.dataset.animeTagPreviewId || '');
        queueVisiblePreview(item);
      });
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const element = entry.target as HTMLElement;
        const item = visiblePreviewItemsById.get(element.dataset.animeTagPreviewId || '');
        queueVisiblePreview(item);
      });
    }, {
      root: null,
      rootMargin: '220px 0px',
      threshold: 0.01,
    });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [id, libraryOpen, onlineMode, onlinePage, queueVisiblePreview, visiblePreviewItemsById]);

  useEffect(() => {
    update({
      animeTagQuery: query,
      animeTagCategory: category,
      animeTagSource: source,
      animeTagProvider: provider,
      animeTagOnlineQuery: onlineQuery,
      animeTagOnlineCategory: onlineCategory,
      animeTagOutputMode: outputMode,
      animeTagSelectedId: selectedTag?.id,
    });
  }, [category, onlineCategory, onlineQuery, outputMode, provider, query, selectedTag?.id, source, update]);

  const openLightbox = useCallback((item: AnimeTagItem) => {
    const index = filteredItems.findIndex((candidate) => candidate.id === item.id);
    setSelectedId(item.id);
    setLightboxIndex(Math.max(0, index));
    void requestLazyPreview(item);
  }, [filteredItems, requestLazyPreview]);

  const showHoverPreview = useCallback((item: AnimeTagItem, event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setHoverPreview({ item, x: event.clientX, y: event.clientY });
    void requestLazyPreview(item);
  }, [requestLazyPreview]);

  const moveHoverPreview = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const { clientX, clientY } = event;
    setHoverPreview((current) => (current ? { ...current, x: clientX, y: clientY } : current));
  }, []);

  const hideHoverPreview = useCallback(() => {
    setHoverPreview(null);
  }, []);

  const moveLightbox = useCallback((delta: number) => {
    setLightboxIndex((current) => {
      const total = filteredItems.length;
      if (current === null || total < 1) return current;
      return (current + delta + total) % total;
    });
  }, [filteredItems]);

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

  const copyPrompt = useCallback(async (item = selectedTag) => {
    if (!item) return;
    const prompt = buildAnimeTagPrompt(item);
    await navigator.clipboard?.writeText(prompt);
    setStatus('已复制动漫标签提示词。');
  }, [selectedTag]);

  const loadOnlineTags = useCallback(async (
    nextPage = 1,
    refresh = false,
    requestPatch: Partial<AnimeTagOnlineRequestState> = {},
  ) => {
    const request = { ...onlineRequestRef.current, ...requestPatch };
    const requestProvider = request.provider === 'gelbooru' ? 'gelbooru' : 'danbooru';
    const requestCategory = request.category || 'general-meta';
    const requestQuery = String(request.query || '');
    const requestLetter = String(request.letter || 'all');
    onlineAbortRef.current?.abort();
    const controller = new AbortController();
    onlineAbortRef.current = controller;
    setStatus(`正在加载 ${requestProvider === 'danbooru' ? 'Danbooru' : 'Gelbooru'} 在线 tag 列表...`);
    try {
      const timeout = window.setTimeout(() => controller.abort(), ONLINE_FETCH_TIMEOUT_MS);
      const url = refresh
        ? '/api/anime-tags/tags/refresh'
        : buildAnimeTagProxyTagsUrl(requestProvider, requestCategory, {
          query: requestQuery,
          letter: requestLetter === 'all' ? '' : requestLetter,
          page: nextPage,
          pageSize: 60,
        });
      const response = await fetch(url, refresh ? {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          provider: requestProvider,
          category: requestCategory,
          q: requestQuery,
          letter: requestLetter === 'all' ? '' : requestLetter,
          page: nextPage,
          pageSize: 60,
        }),
      } : {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      window.clearTimeout(timeout);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.data?.items)
        ? payload.data.items.map((row: any) => normalizeAnimeTagItem(row))
        : [];
      setOnlineResults(items);
      setOnlineMode('tags');
      const loadedPage = Number(payload?.data?.page || nextPage);
      const hasMore = Boolean(payload?.data?.hasMore);
      const totalPages = Number(payload?.data?.totalPages || (hasMore ? loadedPage + 1 : loadedPage));
      setOnlinePage(loadedPage);
      setOnlineTagReturnPage(loadedPage);
      setOnlineTotal(Number(payload?.data?.total || items.length));
      setOnlineTotalPages(Math.max(1, totalPages));
      setOnlineTotalKnown(payload?.data?.totalKnown !== false);
      setOnlineHasMore(hasMore);
      setOnlineActiveTag(null);
      if (items[0]) {
        setSelectedId(items[0].id);
        setSource(requestProvider);
      }
      const warning = String(payload?.data?.warning || '').trim();
      const prefix = warning ? `${warning} ` : '';
      setStatus(items.length
        ? `${prefix}已加载 ${items.length} 个在线 tag，当前分类约 ${payload?.data?.total || items.length} 个。`
        : `${prefix}在线图库没有返回 tag，换个关键词或分类试试。`);
    } catch (error: any) {
      setStatus(`在线图库加载失败：${error?.message || '网络或跨域错误'}`);
    }
  }, []);

  const loadOnlinePosts = useCallback(async (tag: AnimeTagItem, nextPage = 1) => {
    const requestProvider = onlineRequestRef.current.provider === 'gelbooru' ? 'gelbooru' : 'danbooru';
    if (onlineMode !== 'posts') setOnlineTagReturnPage(onlinePage);
    onlineAbortRef.current?.abort();
    const controller = new AbortController();
    onlineAbortRef.current = controller;
    setStatus(`正在加载 ${tag.name} 的作品分页...`);
    try {
      const timeout = window.setTimeout(() => controller.abort(), ONLINE_FETCH_TIMEOUT_MS);
      const response = await fetch(buildAnimeTagProxyPostsUrl(requestProvider, tag.name, {
        page: nextPage,
        pageSize: 24,
      }), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      window.clearTimeout(timeout);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.data?.items)
        ? payload.data.items.map((row: any) => normalizeAnimeTagItem(row))
        : [];
      setOnlineResults(items);
      setOnlineMode('posts');
      setOnlineActiveTag(tag);
      const loadedPage = Number(payload?.data?.page || nextPage);
      const hasMore = Boolean(payload?.data?.hasMore);
      const payloadTotal = Number(payload?.data?.total || 0);
      const trustedTotal = payload?.data?.totalKnown !== false
        ? payloadTotal
        : Math.max(payloadTotal, Number(tag.postCount || 0), items.length);
      const siteTotal = Number(tag.postCount || 0);
      const isSafeFilteredGelbooru = requestProvider === 'gelbooru' && siteTotal > trustedTotal;
      const totalPages = trustedTotal > 0
        ? Math.ceil(trustedTotal / 24)
        : Number(payload?.data?.totalPages || (hasMore ? loadedPage + 1 : loadedPage));
      setOnlinePage(loadedPage);
      setOnlineTotal(trustedTotal || Number(tag.postCount || items.length));
      setOnlineTotalPages(Math.max(1, totalPages));
      setOnlineTotalKnown(payload?.data?.totalKnown !== false);
      setOnlineHasMore(hasMore);
      if (items[0]) {
        setSelectedId(items[0].id);
        setSource(requestProvider);
      }
      const warning = String(payload?.data?.warning || '').trim();
      const prefix = warning ? `${warning} ` : '';
      setStatus(items.length
        ? `${prefix}已加载 ${tag.name} 第 ${payload?.data?.page || nextPage} 页作品，当前安全结果 ${trustedTotal || items.length} 个${isSafeFilteredGelbooru ? `，Gelbooru 全站 ${siteTotal} 个` : ''}。`
        : `${prefix}${tag.name} 当前页没有作品。`);
    } catch (error: any) {
      setStatus(`作品分页加载失败：${error?.message || '网络或跨域错误'}`);
    }
  }, [onlineMode, onlinePage]);

  const searchOnline = useCallback(async () => {
    await loadOnlineTags(1, true);
  }, [loadOnlineTags]);

  const handleOnlineQueryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void searchOnline();
  }, [searchOnline]);

  const runLoadedQueryAsOnlineSearch = useCallback(async (value: string) => {
    if (source !== 'danbooru' && source !== 'gelbooru') return;
    const nextProvider = source;
    const nextOnlineCategory = categoryToOnlineCategory(category) || onlineCategory;
    const nextQuery = String(value || '').trim();
    patchOnlineRequest({
      provider: nextProvider,
      category: nextOnlineCategory,
      query: nextQuery,
      letter: 'all',
    });
    setProvider(nextProvider);
    setOnlineCategory(nextOnlineCategory);
    setOnlineQuery(nextQuery);
    setOnlineLetter('all');
    setOnlineMode('tags');
    clearOnlineListing();
    setOnlinePage(1);
    await loadOnlineTags(1, false, {
      provider: nextProvider,
      category: nextOnlineCategory,
      query: nextQuery,
      letter: 'all',
    });
  }, [category, clearOnlineListing, loadOnlineTags, onlineCategory, patchOnlineRequest, source]);

  const handleLoadedSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void runLoadedQueryAsOnlineSearch(event.currentTarget.value);
  }, [runLoadedQueryAsOnlineSearch]);

  const selectOnlineItem = useCallback((item: AnimeTagItem) => {
    setSelectedId(item.id);
    const isOnlineTag = (item.source === 'danbooru' || item.source === 'gelbooru') && item.id.includes('-tag-');
    if (isOnlineTag) void loadOnlinePosts(item, 1);
  }, [loadOnlinePosts]);

  const saveCurrentTag = useCallback(() => {
    if (!selectedTag) return;
    const tagToSave = itemWithLazyPreview(selectedTag) || selectedTag;
    const saved = normalizeAnimeTagItem({
      ...tagToSave,
      id: `saved-${tagToSave.id}`,
      source: 'custom',
      userCreated: true,
    });
    setLibrary((current) => upsertAnimeTagInLibrary(current, saved, {
      id: saved.categoryId,
      name: saved.categoryName,
    }));
    setStatus('已保存到动漫标签大师自定义库。');
  }, [itemWithLazyPreview, selectedTag]);

  const addCategory = useCallback(() => {
    const name = newCategoryName.trim();
    if (!name) return;
    const next: AnimeTagCategory = { id: slugifyAnimeTag(name), name };
    setLibrary((current) => mergeAnimeTagLibraries(current, { categories: [next], items: [] }));
    setNewCategoryName('');
    setStatus('新增分类已保存。');
  }, [newCategoryName]);

  const renameCategory = useCallback(() => {
    if (!renameCategoryId || !renameCategoryName.trim()) return;
    const name = renameCategoryName.trim();
    setLibrary((current) => normalizeAnimeTagLibrary({
      categories: current.categories.map((item) => (item.id === renameCategoryId ? { ...item, name } : item)),
      items: current.items.map((item) => (
        item.categoryId === renameCategoryId ? { ...item, categoryName: name } : item
      )),
    }));
    setStatus('分类已重命名。');
  }, [renameCategoryId, renameCategoryName]);

  const deleteCategory = useCallback(() => {
    if (!renameCategoryId) return;
    setLibrary((current) => normalizeAnimeTagLibrary({
      categories: current.categories.filter((item) => item.id !== renameCategoryId),
      items: current.items.map((item) => (
        item.categoryId === renameCategoryId ? { ...item, categoryId: 'uncategorized', categoryName: '未分类' } : item
      )),
    }));
    setRenameCategoryId('');
    setRenameCategoryName('');
    setStatus('分类已删除，相关标签移动到未分类。');
  }, [renameCategoryId]);

  const saveCustomTag = useCallback(() => {
    if (!customDraft.name.trim() || (!customDraft.tags.trim() && !customDraft.prompt.trim())) {
      setStatus('新增动漫标签至少需要名称和标签/提示词。');
      return;
    }
    const categoryName = customDraft.category.trim() || '未分类';
    const existing = editingItemId ? library.items.find((item) => item.id === editingItemId) : undefined;
    const tag = normalizeAnimeTagItem({
      id: editingItemId || undefined,
      name: customDraft.name,
      chineseName: customDraft.chineseName || customDraft.name,
      categoryId: slugifyAnimeTag(categoryName),
      categoryName,
      tags: customDraft.tags.split(/[,\s，、]+/).filter(Boolean),
      prompt: customDraft.prompt || customDraft.tags,
      negativePrompt: customDraft.negativePrompt,
      imageUrl: customDraft.imageUrl,
      thumbnailUrl: customDraft.imageUrl,
      attributes: customDraft.attributes,
      source: 'custom',
      postCount: existing?.postCount,
      userCreated: true,
    });
    setLibrary((current) => upsertAnimeTagInLibrary(current, tag, { id: tag.categoryId, name: tag.categoryName }));
    setSelectedId(tag.id);
    setCustomDraft(EMPTY_CUSTOM_DRAFT);
    setEditingItemId('');
    setStatus(editingItemId ? '自定义动漫标签已更新。' : '自定义动漫标签已保存。');
  }, [customDraft, editingItemId, library.items]);

  const editUserTag = useCallback((item: AnimeTagItem) => {
    if (!item.userCreated) return;
    setEditingItemId(item.id);
    setCustomDraft({
      name: item.name,
      chineseName: item.chineseName,
      category: item.categoryName,
      tags: [...item.tags].join(', '),
      prompt: item.prompt,
      negativePrompt: item.negativePrompt || '',
      imageUrl: item.imageUrl || '',
      attributes: item.attributes || '',
    });
    setStatus('正在编辑自定义动漫标签。');
  }, []);

  const deleteUserTag = useCallback((itemId: string) => {
    setLibrary((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== itemId),
    }));
    if (editingItemId === itemId) {
      setEditingItemId('');
      setCustomDraft(EMPTY_CUSTOM_DRAFT);
    }
    setStatus('自定义动漫标签已删除。');
  }, [editingItemId]);

  const exportLibrary = useCallback(() => {
    downloadJson(`anime-tag-master-${Date.now()}.json`, createAnimeTagExport(library));
    setStatus('已导出动漫标签大师配置。');
  }, [library]);

  const importLibrary = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = importAnimeTagExport(parsed);
      setLibrary((current) => mergeAnimeTagLibraries(current, imported));
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
      const name = file.name.replace(/\.[^.]+$/, '');
      setCustomDraft((draft) => ({
        ...draft,
        name: draft.name || name,
        chineseName: draft.chineseName || name,
        imageUrl,
      }));
      setStatus('已上传标签图，保存后进入对应自定义分类。');
    };
    reader.onerror = () => setStatus('读取图片失败，请重试。');
    reader.readAsDataURL(file);
  }, []);

  const runAnimeTagOutput = useCallback(async (mode: AnimeTagOutputMode) => {
    if (!selectedTag) throw new Error('请先选择一个动漫标签');
    let outputTag = itemWithLazyPreview(selectedTag) || selectedTag;
    if (mode === 'image' && !outputTag.imageUrl && !outputTag.thumbnailUrl) {
      setStatus('正在从 Danbooru / Gelbooru 懒加载当前标签图像...');
      outputTag = await requestLazyPreview(outputTag);
    }
    const payload = buildAnimeTagOutputPayload(outputTag, mode);
    const nodes = rf.getNodes();
    const me = rf.getNode(id);
    const mySize = defaultSizeOf('anime-tag-master');
    const baseX = (me?.position.x ?? 0) + ((me as any)?.measured?.width || mySize.w) + 80;
    const baseY = me?.position.y ?? 0;
    const position = placeSingleNode(baseX, baseY, 'output', nodes, { source: `placement:anime-tag-master-output:${id}` });
    const outputNode: Node = {
      id: `anime-tag-output-${mode}-${Date.now()}`,
      type: 'output',
      position,
      data: {
        ...payload.data,
        title: mode === 'image' ? `${outputTag.chineseName} 标签图` : `${outputTag.chineseName} 标签提示词`,
        animeTagOutputMode: mode,
        sourceNodeId: id,
      },
    };
    rf.addNodes(outputNode);
    update({
      lastAnimeTagOutputMode: mode,
      lastAnimeTagText: payload.data.directOutputText,
      lastAnimeTagImageUrl: payload.data.directImageUrl || '',
    });
    setStatus(mode === 'image'
      ? (outputTag.imageUrl || outputTag.thumbnailUrl ? '已输出动漫标签图像。' : '在线图库暂未返回预览，已输出标签占位参考图。')
      : '已输出动漫标签提示词。');
  }, [id, itemWithLazyPreview, requestLazyPreview, rf, selectedTag, update]);

  const handleRun = useCallback(() => {
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const mode: AnimeTagOutputMode = liveData?.animeTagOutputMode === 'image' ? 'image' : 'tags';
    return runAnimeTagOutput(mode);
  }, [id, rf, runAnimeTagOutput]);

  const requestAnimeTagRun = useCallback((mode: AnimeTagOutputMode) => {
    setOutputMode(mode);
    update({
      animeTagOutputMode: mode,
      animeTagSelectedId: selectedTag?.id,
    });
    requestCanvasNodeRun(id);
  }, [id, selectedTag?.id, update]);
  useRunTrigger(id, handleRun, 'anime-tag-master');

  const displaySelectedTag = itemWithLazyPreview(selectedTag);
  const imageItems = filteredItems
    .map((item) => itemWithLazyPreview(item))
    .filter((item): item is AnimeTagItem => Boolean(item));
  const activeLightboxTag = lightboxIndex === null ? null : imageItems[lightboxIndex] || imageItems[0];
  const onlineLetters = ['all', '#', ...'abcdefghijklmnopqrstuvwxyz'.split('')];
  const goOnlinePage = useCallback((nextPage: number) => {
    const page = Math.max(1, Math.min(onlineTotalPages, nextPage));
    if (onlineMode === 'posts' && onlineActiveTag) {
      void loadOnlinePosts(onlineActiveTag, page);
    } else {
      void loadOnlineTags(page, false);
    }
  }, [loadOnlinePosts, loadOnlineTags, onlineActiveTag, onlineMode, onlineTotalPages]);

  const returnToOnlineTags = useCallback(() => {
    setOnlineMode('tags');
    setOnlineActiveTag(null);
    void loadOnlineTags(onlineTagReturnPage, false);
  }, [loadOnlineTags, onlineTagReturnPage]);

  const shouldShowOnlinePagination = onlineResults.length > 0 || onlineTotal > 0 || onlineMode === 'posts';
  const renderOnlinePagination = useCallback((variant: 'modal' | 'compact') => {
    if (!shouldShowOnlinePagination) return null;
    const safeFilteredSiteTotal = onlineMode === 'posts'
      && onlineActiveTag?.source === 'gelbooru'
      && typeof onlineActiveTag.postCount === 'number'
      && onlineActiveTag.postCount > onlineTotal
      ? onlineActiveTag.postCount
      : 0;
    return (
      <div className={`anime-tag-master-pagination is-${variant}`}>
        <button type="button" disabled={onlinePage <= 1} onClick={() => goOnlinePage(onlinePage - 1)}>上一页</button>
        <span>
          {onlineMode === 'posts' && onlineActiveTag ? `${onlineActiveTag.name} · ` : ''}
          第 {onlinePage} / {onlineTotalPages} 页 · 共{onlineTotalKnown ? '' : '约'} {onlineTotal || onlineResults.length} 个
          {safeFilteredSiteTotal ? `安全结果 · Gelbooru 全站 ${safeFilteredSiteTotal.toLocaleString()} 个` : ''}
        </span>
        <button type="button" disabled={!onlineHasMore && onlinePage >= onlineTotalPages} onClick={() => goOnlinePage(onlinePage + 1)}>下一页</button>
        {onlineMode === 'posts' ? (
          <button type="button" className="anime-tag-master-pagination-back" onClick={returnToOnlineTags}>返回标签列表</button>
        ) : null}
      </div>
    );
  }, [
    goOnlinePage,
    onlineActiveTag,
    onlineHasMore,
    onlineMode,
    onlinePage,
    onlineResults.length,
    onlineTotal,
    onlineTotalKnown,
    onlineTotalPages,
    returnToOnlineTags,
    shouldShowOnlinePagination,
  ]);

  const renderPreviewEye = useCallback((item: AnimeTagItem) => (
    <span
      className="anime-tag-master-preview-eye"
      title="100% 大图预览"
      onMouseEnter={(event) => showHoverPreview(item, event)}
      onMouseMove={moveHoverPreview}
      onMouseLeave={hideHoverPreview}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openLightbox(item);
      }}
    >
      <Eye size={15} />
    </span>
  ), [hideHoverPreview, moveHoverPreview, openLightbox, showHoverPreview]);

  const renderPreviewImage = useCallback((
    item: AnimeTagItem | null | undefined,
    alt: string,
    preferFull = false,
    allowLivePreview = true,
  ) => (
    <span
      className="anime-tag-master-preview-wrap"
      data-anime-tag-preview-owner={id}
      data-anime-tag-preview-id={item?.id || undefined}
    >
      <AnimeTagPreviewImage
        item={item}
        alt={alt}
        preferFull={preferFull}
        allowLivePreview={allowLivePreview}
        previewState={item ? lazyPreviewById[item.id] : undefined}
        onRetry={item ? () => queueVisiblePreview(item, true) : undefined}
      />
      {item ? renderPreviewEye(item) : null}
    </span>
  ), [id, lazyPreviewById, queueVisiblePreview, renderPreviewEye]);

  const hoverPreviewItem = hoverPreview ? itemWithLazyPreview(hoverPreview.item) || hoverPreview.item : null;
  const hoverPreviewStyle = hoverPreview ? (() => {
    const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const height = typeof window === 'undefined' ? 720 : window.innerHeight;
    return {
      left: `${Math.min(Math.max(16, hoverPreview.x + 18), Math.max(16, width - 460))}px`,
      top: `${Math.min(Math.max(16, hoverPreview.y + 18), Math.max(16, height - 520))}px`,
    };
  })() : undefined;

  const hoverPreviewPopover = hoverPreviewItem ? createPortal(
    <InspirationVisible>
      <div className="anime-tag-master-hover-preview-popover nodrag nopan" style={hoverPreviewStyle}>
        <AnimeTagPreviewImage item={hoverPreviewItem} alt={`${hoverPreviewItem.name} 100% 大图预览`} preferFull />
        <span>100%</span>
      </div>
    </InspirationVisible>,
    document.body,
  ) : null;

  const libraryModal = libraryOpen ? createPortal(
    <InspirationVisible>
      <div className="anime-tag-master-modal-backdrop nodrag nopan" onWheelCapture={(event) => event.stopPropagation()}>
      <section className="anime-tag-master-modal" data-anime-tag-library-modal onWheelCapture={stopCanvasWheel}>
        <header className="anime-tag-master-modal-header">
          <div>
            <div className="anime-tag-master-kicker">灵感之源</div>
            <h2>动漫标签大师</h2>
            <p>管理常用动漫标签，按需懒加载 Danbooru / Gelbooru 在线图库。</p>
          </div>
          <button type="button" className="atm-icon-button" aria-label="关闭动漫标签库" onClick={() => setLibraryOpen(false)}>
            <X size={18} />
          </button>
        </header>

        <div className="anime-tag-master-modal-tools">
          <label className="anime-tag-master-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleLoadedSearchKeyDown} placeholder="搜索中文 / 英文 / booru tag" />
          </label>
          <select value={category} onChange={(event) => updateCategory(event.target.value)}>
            <option value="all">全部分类</option>
            {toCategoryOptions(categoryOptions, isEnglish).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={source} onChange={(event) => updateSource(event.target.value)}>
            <option value="all">全部来源</option>
            <option value="builtin">内置</option>
            <option value="custom">自定义</option>
            <option value="danbooru">Danbooru</option>
            <option value="gelbooru">Gelbooru</option>
          </select>
          <button type="button" onClick={exportLibrary}><Download size={15} /> 导出</button>
          <button type="button" onClick={() => importRef.current?.click()}><Upload size={15} /> 导入</button>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={importLibrary} />
        </div>

        <div className="anime-tag-master-modal-layout">
          <div className="anime-tag-master-gallery-panel" onWheelCapture={stopCanvasWheel}>
            {renderOnlinePagination('modal')}
            <div className="anime-tag-master-gallery">
              {filteredItems.map((item) => {
                const displayItem = itemWithLazyPreview(item) || item;
                return (
                <article key={item.id} className={`anime-tag-master-card ${selectedTag?.id === item.id ? 'is-selected' : ''}`}>
                  <button type="button" className="anime-tag-master-thumb-button" onClick={() => openLightbox(item)}>
                    {renderPreviewImage(displayItem, `${item.name} ${item.chineseName}`, false, false)}
                  </button>
                  <div className="anime-tag-master-card-body">
                    <strong>{displayAnimeTagName(item, isEnglish)}</strong>
                    <span>{item.name}</span>
                    <small>{displayAnimeTagCategory(item, isEnglish)} · {item.source}</small>
                    {typeof item.postCount === 'number' ? <small>{item.postCount.toLocaleString()} posts{item.source === 'gelbooru' ? ' · 全站' : ''}</small> : null}
                    <p>{item.tags.slice(0, 12).join(', ')}</p>
                    <div className="anime-tag-master-card-actions">
                      <button type="button" onClick={() => selectOnlineItem(item)}>选用</button>
                      {(item.source === 'danbooru' || item.source === 'gelbooru') && item.id.includes('-tag-') ? (
                        <button type="button" onClick={() => void loadOnlinePosts(item, 1)}>查看作品</button>
                      ) : null}
                      <button type="button" onClick={() => void copyPrompt(item)}>复制标签</button>
                      {item.userCreated ? <button type="button" onClick={() => editUserTag(item)}>编辑</button> : null}
                      {item.userCreated ? <button type="button" className="danger" onClick={() => deleteUserTag(item.id)}>删除</button> : null}
                    </div>
                  </div>
                </article>
                );
              })}
            </div>
          </div>

          <aside className="anime-tag-master-manager" onWheelCapture={stopCanvasWheel}>
            <h3><Library size={16} /> 在线图库懒加载</h3>
            <div className="anime-tag-master-inline-form">
              <select value={provider} onChange={(event) => updateProvider(event.target.value)}>
                {ANIME_TAG_ONLINE_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <select value={onlineCategory} onChange={(event) => updateOnlineCategory(event.target.value as AnimeTagOnlineCategoryId)}>
                {ANIME_TAG_ONLINE_CATEGORY_OPTIONS.map((item) => <option key={item.id} value={item.id}>{displayOnlineCategoryName(item, isEnglish)}</option>)}
              </select>
              <input value={onlineQuery} onChange={(event) => updateOnlineQuery(event.target.value)} onKeyDown={handleOnlineQueryKeyDown} placeholder="输入 booru tag，可留空浏览" />
              <button type="button" onClick={() => void searchOnline()}>懒加载搜索</button>
            </div>
            <div className="anime-tag-master-letter-row">
              {onlineLetters.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  className={onlineLetter === letter ? 'active' : ''}
                  onClick={() => {
                    updateOnlineLetter(letter);
                  }}
                >
                  {letter === 'all' ? '全部' : letter.toUpperCase()}
                </button>
              ))}
            </div>

            <h3><Save size={16} /> 保存当前标签</h3>
            <button type="button" className="anime-tag-master-wide-button" onClick={saveCurrentTag}>保存到自定义库</button>

            <h3><Plus size={16} /> 新增分类</h3>
            <div className="anime-tag-master-inline-form">
              <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="分类名称，例如：洛丽塔服饰" />
              <button type="button" onClick={addCategory}>新增分类</button>
            </div>

            <h3><BookOpen size={16} /> 重命名 / 删除分类</h3>
            <select value={renameCategoryId} onChange={(event) => {
              setRenameCategoryId(event.target.value);
              const item = library.categories.find((candidate) => candidate.id === event.target.value);
              setRenameCategoryName(item?.name || '');
            }}>
              <option value="">选择自定义分类</option>
              {library.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <div className="anime-tag-master-inline-form">
              <input value={renameCategoryName} onChange={(event) => setRenameCategoryName(event.target.value)} placeholder="新分类名" />
              <button type="button" onClick={renameCategory}>重命名分类</button>
              <button type="button" className="danger" onClick={deleteCategory}>删除分类</button>
            </div>

            <h3><Tags size={16} /> {editingItemId ? '编辑自定义动漫标签' : '新增自定义动漫标签'}</h3>
            <input value={customDraft.name} onChange={(event) => setCustomDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="原始 tag / 英文名" />
            <input value={customDraft.chineseName} onChange={(event) => setCustomDraft((draft) => ({ ...draft, chineseName: event.target.value }))} placeholder="中文翻译" />
            <input value={customDraft.category} onChange={(event) => setCustomDraft((draft) => ({ ...draft, category: event.target.value }))} placeholder="分类" />
            <div className="anime-tag-master-custom-upload">
              {customDraft.imageUrl ? (
                <img src={customDraft.imageUrl} alt="自定义动漫标签预览" />
              ) : (
                <div className="anime-tag-master-custom-upload-placeholder">未上传</div>
              )}
              <div>
                <button type="button" onClick={() => customImageUploadRef.current?.click()}>
                  <Upload size={15} /> 上传标签图
                </button>
                <small>可直接上传本地图片，保存后进入对应自定义分类。</small>
              </div>
              <input type="file" accept="image/*" ref={customImageUploadRef} className="hidden" onChange={handleCustomImageUpload} />
            </div>
            <textarea value={customDraft.tags} onChange={(event) => setCustomDraft((draft) => ({ ...draft, tags: event.target.value }))} placeholder="标签，用逗号分隔，例如：1girl, solo, kimono" />
            <textarea value={customDraft.prompt} onChange={(event) => setCustomDraft((draft) => ({ ...draft, prompt: event.target.value }))} placeholder="提示词说明，可留空时使用标签" />
            <input value={customDraft.negativePrompt} onChange={(event) => setCustomDraft((draft) => ({ ...draft, negativePrompt: event.target.value }))} placeholder="负面提示词（可选）" />
            <textarea value={customDraft.attributes} onChange={(event) => setCustomDraft((draft) => ({ ...draft, attributes: event.target.value }))} placeholder="属性信息 / 用途说明" />
            <div className="anime-tag-master-custom-actions">
              <button type="button" className="anime-tag-master-wide-button" onClick={saveCustomTag}>
                {editingItemId ? '更新自定义标签' : '保存自定义标签'}
              </button>
              {editingItemId ? (
                <button type="button" className="anime-tag-master-wide-button" onClick={() => {
                  setEditingItemId('');
                  setCustomDraft(EMPTY_CUSTOM_DRAFT);
                }}>
                  取消编辑
                </button>
              ) : null}
            </div>

            <div className="anime-tag-master-status">{status}</div>
          </aside>
        </div>
      </section>
      </div>
    </InspirationVisible>,
    document.body,
  ) : null;

  const lightbox = activeLightboxTag ? createPortal(
    <InspirationVisible>
      <div className="anime-tag-master-lightbox-backdrop nodrag nopan" data-anime-tag-lightbox onWheelCapture={(event) => event.stopPropagation()}>
      <button type="button" className="atm-icon-button lightbox-close" aria-label="关闭预览" onClick={() => setLightboxIndex(null)}>
        <X size={18} />
      </button>
      <button type="button" className="atm-icon-button lightbox-prev" aria-label="上一张" onClick={() => moveLightbox(-1)}>
        <ChevronLeft size={22} />
      </button>
      <figure className="anime-tag-master-lightbox">
        <AnimeTagPreviewImage item={activeLightboxTag} alt={`${activeLightboxTag.name} ${activeLightboxTag.chineseName}`} preferFull />
        <figcaption>
          <strong>{displayAnimeTagName(activeLightboxTag, isEnglish)}</strong>
          <span>{activeLightboxTag.name} · {displayAnimeTagCategory(activeLightboxTag, isEnglish)}</span>
          <p>{activeLightboxTag.tags.slice(0, 18).join(', ')}</p>
          <button type="button" onClick={() => void copyPrompt(activeLightboxTag)}>复制标签提示词</button>
        </figcaption>
      </figure>
      <button type="button" className="atm-icon-button lightbox-next" aria-label="下一张" onClick={() => moveLightbox(1)}>
        <ChevronRight size={22} />
      </button>
      </div>
    </InspirationVisible>,
    document.body,
  ) : null;

  return (
    <InspirationVisible>
      <div
        className={`anime-tag-master-node ${selected ? 'is-selected' : ''}`}
        data-anime-tag-master-root
        onWheelCapture={(event) => event.stopPropagation()}
      >
      <Handle id="text" type="target" position={Position.Left} style={{ ...handleStyle, background: PORT_COLOR.text, top: 166 }} />
      <Handle id="image" type="target" position={Position.Left} style={{ ...handleStyle, background: PORT_COLOR.image, top: 204 }} />
      <Handle id="text" type="source" position={Position.Right} style={{ ...handleStyle, background: PORT_COLOR.text, top: 164 }} />
      <Handle id="image" type="source" position={Position.Right} style={{ ...handleStyle, background: PORT_COLOR.image, top: 204 }} />

      <header className="anime-tag-master-header" data-anime-tag-master-drag-surface>
        <div className="anime-tag-master-icon"><Tags size={22} /></div>
        <div>
          <h3>动漫标签大师</h3>
          <p>Danbooru / Gelbooru 懒加载标签图鉴</p>
        </div>
        <button type="button" className="atm-icon-button nodrag nopan" aria-label="打开动漫标签库" onClick={() => setLibraryOpen(true)}>
          <Images size={18} />
        </button>
      </header>

      <section className="anime-tag-master-section nodrag nopan">
        <div className="anime-tag-master-selected">
          {renderPreviewImage(displaySelectedTag, displayAnimeTagName(displaySelectedTag, isEnglish) || '动漫标签')}
          <div>
            <strong>{displayAnimeTagName(selectedTag, isEnglish) || '请选择标签'}</strong>
            <span>{selectedTag?.name || 'No tag selected'}</span>
            <small>{displayAnimeTagCategory(selectedTag, isEnglish) || '打开标签库选择'}</small>
          </div>
        </div>
        <p className="anime-tag-master-cue">{selectedTag?.tags.slice(0, 14).join(', ')}</p>
      </section>

      <section className="anime-tag-master-section anime-tag-master-compact-search nodrag nopan">
        <label className="anime-tag-master-compact-query">
          <Search size={15} />
          <input aria-label="搜索已加载动漫标签" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleLoadedSearchKeyDown} placeholder="搜索已加载标签" />
        </label>
        <div className="anime-tag-master-filter-row">
          <select aria-label="标签分类" value={category} onChange={(event) => updateCategory(event.target.value)}>
            <option value="all">全部分类</option>
            {toCategoryOptions(categoryOptions, isEnglish).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select aria-label="标签来源" value={source} onChange={(event) => updateSource(event.target.value)}>
            <option value="all">全部来源</option>
            <option value="builtin">内置</option>
            <option value="custom">自定义</option>
            <option value="danbooru">Danbooru</option>
            <option value="gelbooru">Gelbooru</option>
          </select>
        </div>
        <div className="anime-tag-master-online is-compact">
          <select aria-label="在线图库来源" value={provider} onChange={(event) => updateProvider(event.target.value)}>
            {ANIME_TAG_ONLINE_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select aria-label="在线图库分类" value={onlineCategory} onChange={(event) => updateOnlineCategory(event.target.value as AnimeTagOnlineCategoryId)}>
            {ANIME_TAG_ONLINE_CATEGORY_OPTIONS.map((item) => <option key={item.id} value={item.id}>{displayOnlineCategoryName(item, isEnglish)}</option>)}
          </select>
          <input aria-label="在线图库搜索词" value={onlineQuery} onChange={(event) => updateOnlineQuery(event.target.value)} onKeyDown={handleOnlineQueryKeyDown} placeholder="输入 booru tag" />
          <button type="button" className="anime-tag-master-online-search" aria-label="在线懒加载搜索" title="在线懒加载搜索" onClick={() => void searchOnline()}>
            <Search size={16} /> 搜索
          </button>
        </div>
        <div className="anime-tag-master-mode">
          <button
            type="button"
            className={outputMode === 'tags' ? 'active' : ''}
            onClick={() => requestAnimeTagRun('tags')}
          >
            <FileText size={15} /> 输出标签
          </button>
          <button
            type="button"
            className={outputMode === 'image' ? 'active' : ''}
            onClick={() => requestAnimeTagRun('image')}
          >
            <ImageIcon size={15} /> 输出图像
          </button>
        </div>
      </section>

      <section className="anime-tag-master-section nodrag nopan">
        <div className="anime-tag-master-grid">
          {filteredItems.map((item) => {
            const displayItem = itemWithLazyPreview(item) || item;
            return (
              <button key={item.id} type="button" className={selectedTag?.id === item.id ? 'active' : ''} onClick={() => selectOnlineItem(item)}>
                {renderPreviewImage(displayItem, displayAnimeTagName(item, isEnglish), false, false)}
                <span className="anime-tag-master-grid-title">{displayAnimeTagName(item, isEnglish)}</span>
              </button>
            );
          })}
        </div>
        {renderOnlinePagination('compact')}
      </section>

      <section className="anime-tag-master-actions nodrag nopan">
        <button type="button" onClick={() => setLibraryOpen(true)}><Images size={16} /> 打开标签库</button>
        <button type="button" onClick={() => void copyPrompt()}><Copy size={16} /> 复制标签提示词</button>
        <button type="button" onClick={saveCurrentTag}><Save size={16} /> 保存到动漫标签大师</button>
      </section>

      <footer className="anime-tag-master-footer nodrag nopan">
        <span>{filteredItems.length} 个匹配 · {library.items.length} 个自定义</span>
        <button type="button" onClick={() => requestAnimeTagRun(outputMode)}>
          {outputMode === 'image' ? <ImageIcon size={17} /> : <FileText size={17} />}
          运行
        </button>
      </footer>

      {libraryModal}
      {lightbox}
      {hoverPreviewPopover}
      </div>
    </InspirationVisible>
  );
}

export default AnimeTagMasterNode;
