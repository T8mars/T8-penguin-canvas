import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CopyPlus, Eye, EyeOff, Grid2X2, Lock, Redo2, Undo2, Unlock, X } from 'lucide-react';
import SmartImage from './SmartImage';
import { arrangeMoodboard, moodboardVisibleIds, moveMoodboardCards, normalizeMoodboard, updateMoodboardCards,
  type MoodboardItem, type MoodboardLayout } from '../utils/materialMoodboard';

interface Props {
  items: MoodboardItem[];
  value?: unknown;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (layout: MoodboardLayout, initial: MoodboardLayout) => boolean | Promise<boolean>;
  onInsert?: (ids: string[]) => void;
}
const button: CSSProperties = { border: '1px solid var(--t8-border, #64748b)', borderRadius: 7,
  padding: '6px 10px', background: 'var(--bg-secondary, #1e293b)', color: 'inherit', cursor: 'pointer', fontSize: 12 };
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

export default function MaterialMoodboard({ items, value, readOnly = false, onClose, onSave, onInsert }: Props) {
  const { t } = useTranslation('creativeUx');
  const initial = useRef(normalizeMoodboard(value, items));
  const [draft, setDraft] = useState(initial.current);
  const draftRef = useRef(draft); draftRef.current = draft;
  const [past, setPast] = useState<MoodboardLayout[]>([]), [future, setFuture] = useState<MoodboardLayout[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<MoodboardLayout | null>(null);
  const [group, setGroup] = useState(''), [zoom, setZoom] = useState(1), [compare, setCompare] = useState<string[]>([]);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [viewport, setViewport] = useState({ x: 0, y: 0, w: 1000, h: 600 });
  const dialog = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const endDrag = useRef<(() => void) | null>(null);
  const layout = useMemo(() => normalizeMoodboard(preview || draft, items), [preview, draft, items]);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const ids = useMemo(() => moodboardVisibleIds(layout, viewport), [layout, viewport]);
  const visibleIds = useMemo(() => moodboardVisibleIds(layout), [layout]);
  const extent = useMemo(() => Object.values(layout.cards).filter((c) => !c.hidden).reduce((size, c) => ({
    w: Math.max(size.w, c.x + c.w + 160), h: Math.max(size.h, c.y + c.h + 160),
  }), { w: 1100, h: 700 }), [layout]);
  const selection = selected.filter((id) => layout.cards[id] && !layout.cards[id].hidden);
  const canEdit = !readOnly && !saving && !preview;

  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root'), wasInert = root?.inert || false;
    if (root) root.inert = true;
    dialog.current?.focus();
    return () => { endDrag.current?.(); if (root) root.inert = wasInert; if (active?.isConnected) active.focus(); };
  }, []);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const update = () => setViewport({ x: element.scrollLeft / zoom, y: element.scrollTop / zoom,
      w: element.clientWidth / zoom, h: element.clientHeight / zoom });
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [zoom]);
  useEffect(() => { if (readOnly) endDrag.current?.(); }, [readOnly]);
  useLayoutEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [preview, compare.length, layout, readOnly]);
  useEffect(() => {
    for (const child of Array.from(dialog.current?.children || [])) {
      if (child instanceof HTMLElement && !child.hasAttribute('data-moodboard-comparison')) child.inert = compare.length > 0;
    }
    if (compare.length) dialog.current?.querySelector<HTMLButtonElement>('[data-moodboard-comparison] button')?.focus();
  }, [compare.length]);

  const commit = (next: MoodboardLayout, previous = draftRef.current) => {
    if (!canEdit || JSON.stringify(previous) === JSON.stringify(next)) return;
    setPast((stack) => [...stack, previous].slice(-50)); setFuture([]); setDraft(next); setError('');
  };
  const undo = () => {
    const previous = past[past.length - 1]; if (!previous || !canEdit) return;
    const current = draftRef.current;
    setFuture((stack) => [...stack, current]); setPast((stack) => stack.slice(0, -1)); setDraft(previous);
  };
  const redo = () => {
    const next = future[future.length - 1]; if (!next || !canEdit) return;
    const current = draftRef.current;
    setPast((stack) => [...stack, current]); setFuture((stack) => stack.slice(0, -1)); setDraft(next);
  };
  const beginDrag = (event: ReactPointerEvent, id: string, resize = false) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-moodboard-control]') && !resize) return;
    event.stopPropagation();
    if (event.shiftKey && !resize) { setSelected((current) => current.includes(id) ? current.filter((v) => v !== id) : [...current, id]); return; }
    const nextIds = selection.includes(id) ? selection : [id]; setSelected(nextIds);
    if (!canEdit || layout.cards[id]?.locked) return;
    event.preventDefault(); endDrag.current?.();
    const start = layout, startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    let latest = start;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = (e.clientX - startX) / zoom, dy = (e.clientY - startY) / zoom;
      latest = resize ? updateMoodboardCards(start, [id], { w: start.cards[id].w + dx, h: start.cards[id].h + dy })
        : moveMoodboardCards(start, nextIds, dx, dy);
      setDraft(latest);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel); endDrag.current = null;
    };
    const cancel = () => { cleanup(); setDraft(start); };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      cleanup(); commit(latest, start);
    };
    endDrag.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel);
  };
  const save = async () => {
    if (readOnly || saving || preview) return;
    setSaving(true); setError('');
    try { if (await onSave(normalizeMoodboard(draft, items), initial.current)) onClose(); else setError(t('moodboard.conflict')); }
    catch { setError(t('moodboard.saveError')); }
    finally { setSaving(false); }
  };
  const media = (id: string, full = false) => {
    const item = itemMap.get(id);
    if (!item) return <div style={{ padding: 16 }}>{t('moodboard.missing')}</div>;
    if (full && item.kind === 'image' && item.url) return <img src={item.url} alt={item.name || ''} decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
    if (item.kind === 'image' && item.url) return <SmartImage src={item.url} alt={item.name || ''} thumbSize={360}
      style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} draggable={false} />;
    if (full && item.kind === 'video' && item.url) return <video src={item.url} controls preload="metadata" style={{ width: '100%', height: '100%' }} />;
    if (full && item.kind === 'audio' && item.url) return <audio src={item.url} controls preload="metadata" style={{ width: '100%' }} />;
    return <div style={{ padding: 16, overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text || item.name || item.kind}</div>;
  };

  return createPortal(<div className="nodrag nopan nowheel" style={{ position: 'fixed', inset: 0, zIndex: 1002, background: '#0009', padding: 12 }}
    onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('moodboard.title')} tabIndex={-1} data-material-moodboard data-canvas-editing-dialog
      style={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', color: 'var(--text-primary, #e2e8f0)',
        background: 'var(--bg-primary, #0f172a)', border: '1px solid var(--t8-border, #64748b)' }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); if (compare.length) setCompare([]); else if (preview) setPreview(null); else if (!saving) closeRef.current(); }
        const editing = (e.target as HTMLElement).matches('input,textarea,select,[contenteditable=true]');
        if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(visibleIds); }
        if (!editing && (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
          e.preventDefault(); if (e.shiftKey || e.key.toLowerCase() === 'y') redo(); else undo();
        }
        if (e.key === 'Tab') {
          const scope = compare.length ? dialog.current?.querySelector('[data-moodboard-comparison]') : dialog.current;
          const focusable = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"], video, audio') || []).filter((el) => el.getClientRects().length && !el.closest('[inert]'));
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <header style={{ ...row, padding: '12px 16px', borderBottom: '1px solid var(--t8-border, #64748b)' }}>
        <strong>{t('moodboard.title')}</strong><span style={{ fontSize: 12, opacity: .65 }}>{t('moodboard.count', { count: items.length })}</span>
        <button style={{ ...button, marginLeft: 'auto' }} onClick={onClose} disabled={saving} aria-label={t('moodboard.close')}><X size={16} /></button>
      </header>
      <div style={{ padding: '8px 16px', fontSize: 12, opacity: .75 }}>{readOnly ? t('moodboard.readOnly') : t('moodboard.hint')}</div>
      <div style={{ ...row, padding: '0 16px 10px' }}>
        <button style={button} disabled={!canEdit || !past.length} onClick={undo} title={t('moodboard.undo')}><Undo2 size={14} /></button>
        <button style={button} disabled={!canEdit || !future.length} onClick={redo} title={t('moodboard.redo')}><Redo2 size={14} /></button>
        <button style={button} onClick={() => setSelected(visibleIds)}>{t('moodboard.selectAll')}</button>
        <button style={button} disabled={!canEdit || !selection.length} onClick={() => setPreview(arrangeMoodboard(layout, selection, Math.max(500, viewport.w - 60)))}><Grid2X2 size={13} /> {t('moodboard.arrange')}</button>
        <button style={button} disabled={!selection.length} onClick={() => setCompare(selection.slice(0, 4))}><Eye size={13} /> {t('moodboard.compare')}</button>
        <input aria-label={t('moodboard.group')} placeholder={t('moodboard.group')} value={group} onChange={(e) => setGroup(e.currentTarget.value)} maxLength={80} style={{ ...button, width: 115 }} />
        <button style={button} disabled={!canEdit || !selection.length || !group.trim()} onClick={() => commit(updateMoodboardCards(layout, selection, { group: group.trim() }))}>{t('moodboard.applyGroup')}</button>
        <button style={button} disabled={!canEdit || !selection.length} onClick={() => commit(updateMoodboardCards(layout, selection, { group: '' }))}>{t('moodboard.ungroup')}</button>
        <button style={button} disabled={!canEdit || !selection.length} title={t(selection.length && selection.every((id) => layout.cards[id].locked) ? 'moodboard.unlock' : 'moodboard.lock')}
          onClick={() => commit(updateMoodboardCards(layout, selection, { locked: !selection.every((id) => layout.cards[id].locked) }))}>
          {selection.length && selection.every((id) => layout.cards[id].locked) ? <Unlock size={13} /> : <Lock size={13} />}
        </button>
        <button style={button} disabled={!canEdit || !selection.length} title={t('moodboard.hide')} onClick={() => commit(updateMoodboardCards(layout, selection, { hidden: true }))}><EyeOff size={13} /></button>
        <button style={button} disabled={!canEdit} onClick={() => commit(updateMoodboardCards(layout, Object.keys(layout.cards), { hidden: false }))}>{t('moodboard.restore')}</button>
        <label style={{ fontSize: 12 }}>{t('moodboard.zoom')} <select style={button} value={zoom} onChange={(e) => setZoom(Number(e.currentTarget.value))}>
          {[.25, .5, .75, 1, 1.5, 2].map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}</select></label>
        <label style={{ fontSize: 12 }}>{t('moodboard.rotation')} <input type="number" step={5} aria-label={t('moodboard.rotation')}
          disabled={!canEdit || selection.length !== 1 || layout.cards[selection[0]]?.locked} value={selection.length === 1 ? layout.cards[selection[0]].rotation : 0}
          style={{ ...button, width: 70 }} onChange={(e) => { const rotation = Number(e.currentTarget.value); commit(updateMoodboardCards(layout, selection, { rotation })); }} /></label>
      </div>
      {preview && <div role="status" style={{ ...row, padding: 8, background: 'var(--bg-secondary, #334155)' }}>
        <span>{t('moodboard.previewHint')}</span>
        <button style={button} onClick={() => { const current = draftRef.current; setPast((stack) => [...stack, current].slice(-50)); setFuture([]); setDraft(preview); setPreview(null); }}>{t('moodboard.confirmLayout')}</button>
        <button style={button} onClick={() => setPreview(null)}>{t('moodboard.cancelLayout')}</button>
      </div>}
      <div ref={scroll} data-moodboard-viewport style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-secondary, #17202f)' }}>
        <div style={{ width: extent.w * zoom, height: extent.h * zoom }}>
          <div style={{ position: 'relative', width: extent.w, height: extent.h, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
            onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected([]); }}>
            {ids.map((id) => {
              const card = layout.cards[id], item = itemMap.get(id), chosen = selection.includes(id);
              return <article key={id} data-moodboard-card={id} role="button" tabIndex={0} aria-pressed={chosen} aria-label={item?.name || id}
                style={{ position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, transform: `rotate(${card.rotation}deg)`,
                  borderRadius: 9, border: `2px solid ${chosen ? 'var(--t8-accent, #2dd4bf)' : 'var(--t8-border, #64748b)'}`, background: 'var(--bg-primary, #0f172a)',
                  display: 'flex', flexDirection: 'column', boxSizing: 'border-box', cursor: card.locked ? 'default' : 'grab', touchAction: 'none' }}
                onPointerDown={(e) => beginDrag(e, id)} onDoubleClick={() => setCompare([id])}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected((current) => e.shiftKey ? current.includes(id) ? current.filter((v) => v !== id) : [...current, id] : [id]); }
                  if (e.key.startsWith('Arrow') && canEdit) { e.preventDefault(); const step = e.shiftKey ? 20 : 5;
                    commit(moveMoodboardCards(layout, [id], e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)); }
                }}>
                <div style={{ padding: '5px 8px', fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {card.locked && <Lock size={11} style={{ display: 'inline' }} />} {card.group && `[${card.group}] `}{item?.name || id}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{media(id)}</div>
                {!card.locked && canEdit && <button data-moodboard-control style={{ position: 'absolute', right: 0, bottom: 0, width: 20, height: 20, cursor: 'nwse-resize', background: 'var(--accent, #2dd4bf)', border: 0, borderRadius: 4 }}
                  title={t('moodboard.resize')} aria-label={t('moodboard.resize')} onPointerDown={(e) => beginDrag(e, id, true)}>↘</button>}
              </article>;
            })}
          </div>
        </div>
      </div>
      {error && <div role="alert" style={{ padding: 10, color: 'var(--danger, #f87171)' }}>{error}</div>}
      <footer style={{ ...row, padding: 12, borderTop: '1px solid var(--t8-border, #64748b)' }}>
        <span style={{ fontSize: 12 }}>{t('moodboard.selected', { count: selection.length })}</span>
        {onInsert && <button style={button} disabled={readOnly || !selection.some((id) => itemMap.has(id)) || Boolean(preview)}
          onClick={() => onInsert(selection.filter((id) => itemMap.has(id)))}><CopyPlus size={13} /> {t('moodboard.insert')}</button>}
        <button style={{ ...button, marginLeft: 'auto' }} disabled={saving} onClick={onClose}>{t('moodboard.cancel')}</button>
        <button style={{ ...button, background: 'var(--t8-accent, #2dd4bf)', color: 'var(--t8-accent-text, #062d29)' }} disabled={readOnly || saving || Boolean(preview)} onClick={() => void save()}>{t('moodboard.save')}</button>
      </footer>
      {compare.length > 0 && <div data-moodboard-comparison style={{ position: 'absolute', inset: 20, padding: 16, borderRadius: 10,
        background: 'var(--bg-primary, #0f172a)', display: 'flex', flexDirection: 'column', zIndex: 2, border: '1px solid var(--t8-border, #64748b)' }}>
        <div style={row}><span>{t('moodboard.compareHint')}</span><button style={{ ...button, marginLeft: 'auto' }} onClick={() => setCompare([])}>{t('moodboard.close')}</button></div>
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${Math.min(compare.length, 2)}, minmax(0, 1fr))`, gap: 12, overflow: 'auto' }}>
          {compare.map((id) => <div key={id} style={{ display: 'flex', flexDirection: 'column', minHeight: 200 }}><p>{itemMap.get(id)?.name || id}</p><div style={{ flex: 1, minHeight: 0 }}>{media(id, true)}</div></div>)}
        </div>
      </div>}
    </div>
  </div>, document.body);
}
