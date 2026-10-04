import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore, FolderOpen, Loader2, Pin, Search, X } from 'lucide-react';
import * as api from '../services/api';
import type { CanvasListItem } from '../types/canvas';
import { useCanvasStore } from '../stores/canvas';
import { prepareCanvasArchive, type CanvasArchiveHold } from '../utils/canvasArchiveLifecycle';

const ROW = 88, OVERSCAN = 4;
export default function CanvasCatalogManager({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('shell');
  const dialog = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null), confirmCancel = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<CanvasListItem | null>(null);
  const generation = useRef(0), composing = useRef(false);
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [sort, setSort] = useState<'updated' | 'opened'>('updated');
  const [draft, setDraft] = useState(''), [query, setQuery] = useState('');
  const [items, setItems] = useState<CanvasListItem[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false), [partial, setPartial] = useState(false);
  const [counts, setCounts] = useState({ active: 0, archived: 0 }), [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [scroll, setScroll] = useState(0), [height, setHeight] = useState(440), [refresh, setRefresh] = useState(0);
  const activeId = useCanvasStore((state) => state.activeId);
  const reload = () => setRefresh((value) => value + 1);
  useEffect(() => {
    if (content.current) content.current.inert = Boolean(confirmation);
    if (confirmation) confirmCancel.current?.focus();
    else search.current?.focus();
  }, [confirmation]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    previous?.blur();
    const root = document.getElementById('root'), priorInert = root?.inert || false;
    if (root) root.inert = true;
    search.current?.focus();
    return () => { generation.current += 1; if (root) root.inert = priorInert; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!list.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(list.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const token = ++generation.current;
    setLoading(true); setError(''); setItems([]); setCursor(null); setHasMore(false); setScroll(0);
    if (list.current) list.current.scrollTop = 0;
    void api.listCanvasPage({ limit: 50, status, sort, query }).then((page) => {
      if (generation.current !== token) return;
      setItems(page.items); setCursor(page.nextCursor); setHasMore(page.hasMore); setPartial(page.partial);
      setCounts(page.counts || { active: 0, archived: 0 }); setTotal(page.total);
    }).catch((err) => { if (generation.current === token) setError(String(err?.message || err)); })
      .finally(() => { if (generation.current === token) setLoading(false); });
  }, [status, sort, query, refresh]);
  const more = useCallback(async () => {
    if (!cursor || loading || !hasMore) return;
    const token = generation.current;
    setLoading(true); setError('');
    try {
      const page = await api.listCanvasPage({ limit: 50, status, sort, query, cursor });
      if (generation.current !== token) return;
      setItems((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()]);
      setCursor(page.nextCursor); setHasMore(page.hasMore); setPartial(page.partial); setTotal(page.total);
    } catch (err) { if (generation.current === token) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (generation.current === token) setLoading(false); }
  }, [cursor, hasMore, loading, status, sort, query]);
  const open = (item: CanvasListItem) => {
    useCanvasStore.setState((state) => ({ canvases: [...state.canvases.filter((canvas) => canvas.id !== item.id), item] }));
    useCanvasStore.getState().setActive(item.id);
    onClose();
  };
  const transition = async (item: CanvasListItem) => {
    if (busy) return;
    const action = item.status === 'archived' ? 'restore' : 'archive';
    setBusy(item.id); setError('');
    let hold: CanvasArchiveHold | null = null;
    let committed = false;
    try {
      if (action === 'archive') hold = await prepareCanvasArchive(item.id);
      const latest = await api.getCanvasMetadata(item.id);
      if (!latest || latest.catalogRevision !== item.catalogRevision || latest.status !== item.status
        || (hold?.revision != null && latest.revision !== hold.revision)) throw new Error(t('archive.changed'));
      const result = await api.transitionCanvasArchive(latest, action, crypto.randomUUID());
      committed = true;
      useCanvasStore.setState((state) => ({ canvases: [...state.canvases.filter((canvas) => canvas.id !== item.id), result.item] }));
      if (action === 'archive' && useCanvasStore.getState().activeId === item.id) {
        // Clear first: a later catalog refresh failure must not leave this
        // already-archived document mounted as an editable canvas.
        useCanvasStore.getState().setActive(null);
        const next = await api.listCanvasPage({ limit: 1, status: 'active' });
        useCanvasStore.getState().setActive(next.items[0]?.id || null);
      }
      await useCanvasStore.getState().bootstrapCanvases(true);
      reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(committed ? t('archive.committedRefreshFailed') : message.startsWith('canvas_archive_') ? t('archive.flushFailed') : message);
    } finally { hold?.release(); setBusy(null); }
  };
  const start = Math.max(0, Math.floor(scroll / ROW) - OVERSCAN), end = Math.min(items.length, start + Math.ceil(height / ROW) + OVERSCAN * 2);
  const button = 'inline-flex items-center gap-1 rounded-md border border-[var(--t8-border)] px-3 py-2 text-sm disabled:opacity-40 hover:bg-[var(--bg-secondary)]';
  const empty = partial ? 'archive.partial' : query ? 'catalog.noMatches' : status === 'active' && counts.archived > 0 ? 'archive.allArchived' : 'catalog.empty';
  return createPortal(<div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-0 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { if (confirmation) setConfirmation(null); else onClose(); } }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="canvas-manager-title" data-canvas-manager="true"
      className="relative flex h-full w-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl sm:h-[min(760px,94vh)] sm:w-[min(1100px,96vw)] sm:rounded-xl border border-[var(--t8-border)]"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && !composing.current && !busy) { event.preventDefault(); if (confirmation) setConfirmation(null); else onClose(); }
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]') || []).filter((element) => element.getClientRects().length && !element.closest('[inert]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div ref={content} className="contents">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--t8-border)] p-4">
        <h2 id="canvas-manager-title" className="text-lg font-semibold">{t('archive.manage')}</h2>
        <button type="button" className={button} aria-label={t('archive.close')} disabled={!!busy} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="flex flex-wrap gap-2 p-4">
        <div role="tablist" aria-label={t('archive.filter')} className="flex gap-2">
          {(['active','archived'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={status === value} className={`${button} ${status === value ? 'font-bold bg-[var(--bg-secondary)]' : ''}`} disabled={!!busy} onClick={() => setStatus(value)}>{t(`archive.${value}`)} ({counts[value]})</button>)}
        </div>
        <form className="flex min-w-[180px] flex-1 gap-2" onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }} onSubmit={(event) => { event.preventDefault(); if (!composing.current) setQuery(draft.trim()); }}>
          <input ref={search} value={draft} disabled={!!busy} aria-label={t('catalog.searchAria')} placeholder={t('archive.search')}
            className="min-w-0 flex-1 rounded-md border border-[var(--t8-border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={(event) => setDraft(event.currentTarget.value)} />
          <button type="submit" className={button} disabled={!!busy}><Search size={16} />{t('catalog.search')}</button>
        </form>
        <select value={sort} disabled={!!busy} aria-label={t('archive.sort')} className={button} onChange={(event) => setSort(event.currentTarget.value as typeof sort)}>
          <option value="updated">{t('archive.updated')}</option><option value="opened">{t('archive.opened')}</option>
        </select>
      </div>
      {partial && <div role="status" className="px-4 pb-2 text-sm">{t('archive.partial')} <button className="underline" disabled={!!busy} onClick={reload}>{t('archive.refresh')}</button></div>}
      {error && <div role="alert" className="mx-4 mb-2 rounded-md border border-red-400 p-3 text-sm">{error} <button className="underline" disabled={!!busy} onClick={reload}>{t('archive.refresh')}</button></div>}
      <div ref={list} className="min-h-0 flex-1 overflow-auto px-4" onScroll={(event) => setScroll(event.currentTarget.scrollTop)}>
        {items.length === 0 && <p className="py-12 text-center">{loading ? t('catalog.loading') : t(empty)}</p>}
        <div className="relative" style={{ height: items.length * ROW }}>
          {items.slice(start,end).map((item, index) => <div key={item.id} className="absolute left-0 right-0 flex items-center gap-3 border-b border-[var(--t8-border)] py-2" style={{ height: ROW, top: (start + index) * ROW }}>
            <div className="min-w-0 flex-1">
              <button type="button" disabled={!!busy} className={`max-w-full truncate text-left font-semibold ${item.id === activeId ? 'underline' : ''}`} onClick={() => open(item)} title={item.name}>{item.pinned ? '★ ' : ''}{item.name}</button>
              <div className="truncate text-xs opacity-60" title={item.id}>{item.id}</div>
              <div className="text-xs opacity-70">{t('catalog.nodeCount', { count: item.nodeCount })} · {new Date(sort === 'opened' && item.openedAt ? item.openedAt : item.updatedAt).toLocaleString(i18n.resolvedLanguage)}</div>
            </div>
            <button type="button" className={button} disabled={!!busy} aria-pressed={!!item.pinned} aria-label={t(item.pinned ? 'archive.unpin' : 'archive.pin')} onClick={async () => {
              setBusy(item.id); try { await api.updateCanvasDirectoryProfile(item.id, { pinned: !item.pinned }); reload(); }
              catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); }
            }}><Pin size={16} /></button>
            <button type="button" className={button} disabled={!!busy} onClick={() => open(item)} aria-label={t(item.status === 'archived' ? 'archive.preview' : 'archive.open')}><FolderOpen size={16} /><span className="hidden md:inline">{t(item.status === 'archived' ? 'archive.preview' : 'archive.open')}</span></button>
            <button type="button" className={button} disabled={!!busy || partial} onClick={() => setConfirmation(item)} aria-label={t(item.status === 'archived' ? 'archive.restore' : 'archive.archive')}>
              {busy === item.id ? <Loader2 size={16} className="animate-spin" /> : item.status === 'archived' ? <ArchiveRestore size={16} /> : <Archive size={16} />}<span className="hidden md:inline">{t(item.status === 'archived' ? 'archive.restore' : 'archive.archive')}</span>
            </button>
          </div>)}
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--t8-border)] p-4 text-xs">
        <span>{t('archive.summary', { count: items.length, total: total ?? '?' })} · {t('archive.notDelete')}</span>
        {hasMore && <button className={button} disabled={loading || !!busy} onClick={() => void more()}>{loading ? t('catalog.loading') : t('catalog.loadMore', { count: items.length })}</button>}
      </footer>
      </div>
      {confirmation && <div className="absolute inset-0 z-10 grid place-items-center bg-black/50 p-4">
        <div role="alertdialog" aria-modal="true" aria-labelledby="canvas-archive-confirmation" className="w-full max-w-lg rounded-lg border border-[var(--t8-border)] bg-[var(--bg-primary)] p-5 shadow-xl">
          <p id="canvas-archive-confirmation" className="break-words text-sm leading-6">{t(confirmation.status === 'archived' ? 'archive.confirmRestore' : 'archive.confirmArchive', { name: confirmation.name })}</p>
          <div className="mt-5 flex justify-end gap-3">
            <button ref={confirmCancel} type="button" className={button} onClick={() => setConfirmation(null)}>{t('common:actions.cancel')}</button>
            <button type="button" className={button} onClick={() => { const item = confirmation; setConfirmation(null); void transition(item); }}>{t(confirmation.status === 'archived' ? 'archive.restore' : 'archive.archive')}</button>
          </div>
        </div>
      </div>}
    </div>
  </div>, document.body);
}
