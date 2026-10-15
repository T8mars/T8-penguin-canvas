/** Layout-only projection. Card IDs are material slot IDs, never deduped by URL. */
export interface MoodboardCard {
  x: number; y: number; w: number; h: number;
  rotation: number; locked: boolean; hidden: boolean; group: string;
}
export interface MoodboardLayout {
  schema: 't8-material-moodboard-v1';
  cards: Record<string, MoodboardCard>;
}
export interface MoodboardItem { id: string; kind: string; url?: string; text?: string; name?: string }

const finite = (value: unknown, fallback: number, min: number, max: number) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
);
export function normalizeMoodboard(raw: unknown, items: readonly Pick<MoodboardItem, 'id'>[]): MoodboardLayout {
  const record = raw && typeof raw === 'object' ? raw as Partial<MoodboardLayout> : {};
  const entries = record.schema === 't8-material-moodboard-v1' && record.cards && typeof record.cards === 'object'
    ? Object.entries(record.cards) : [];
  const normalized = new Map<string, MoodboardCard>();
  for (const [id, value] of entries) {
    if (!id || !value || typeof value !== 'object') continue;
    normalized.set(id, {
      x: finite(value.x, 24, 0, 100000), y: finite(value.y, 24, 0, 100000),
      w: finite(value.w, 220, 100, 8000), h: finite(value.h, 190, 80, 8000),
      rotation: finite(value.rotation, 0, -3600, 3600),
      locked: value.locked === true, hidden: value.hidden === true,
      group: typeof value.group === 'string' ? value.group.slice(0, 80) : '',
    });
  }
  const bottom = Array.from(normalized.values()).reduce((end, card) => Math.max(end, card.y + card.h), 0);
  let added = 0;
  for (const item of items) {
    if (!item.id || normalized.has(item.id)) continue;
    normalized.set(item.id, { x: 24 + (added % 4) * 244, y: 24 + bottom + Math.floor(added / 4) * 214,
      w: 220, h: 190, rotation: 0, locked: false, hidden: false, group: '' });
    added += 1;
  }
  return { schema: 't8-material-moodboard-v1', cards: Object.fromEntries(normalized) };
}

export function updateMoodboardCards(
  layout: MoodboardLayout, ids: readonly string[], patch: Partial<MoodboardCard>,
): MoodboardLayout {
  const selected = new Set(ids);
  return normalizeMoodboard({ ...layout, cards: Object.fromEntries(Object.entries(layout.cards).map(([id, card]) => {
    if (!selected.has(id)) return [id, card];
    // Visibility restoration must also work for a hidden, locked imported card.
    // It does not grant permission to move/resize/rotate/group the card.
    const effective = card.locked ? { ...(patch.locked === undefined ? {} : { locked: patch.locked }),
      ...(patch.hidden === false ? { hidden: false } : {}) } : patch;
    return [id, { ...card, ...effective }];
  })) }, []);
}

/** Preview only; preserves rotation, size, hidden/locked state and source order. */
export function arrangeMoodboard(layout: MoodboardLayout, ids: readonly string[], width = 1000): MoodboardLayout {
  const selected = new Set(ids);
  const next = { ...layout.cards };
  const movable = Object.entries(layout.cards).filter(([id, card]) => selected.has(id) && !card.locked && !card.hidden);
  const left = movable.reduce((min, [, card]) => Math.min(min, card.x), Infinity);
  const top = movable.reduce((min, [, card]) => Math.min(min, card.y), Infinity);
  let x = left; let y = top; let rowHeight = 0;
  for (const [id, card] of movable) {
    const angle = card.rotation * Math.PI / 180;
    const w = Math.abs(Math.cos(angle)) * card.w + Math.abs(Math.sin(angle)) * card.h;
    const h = Math.abs(Math.sin(angle)) * card.w + Math.abs(Math.cos(angle)) * card.h;
    if (x > left && x + w > left + Math.max(300, width)) { x = left; y += rowHeight + 24; rowHeight = 0; }
    next[id] = { ...card, x: x + (w - card.w) / 2, y: y + (h - card.h) / 2 };
    x += w + 24; rowHeight = Math.max(rowHeight, h);
  }
  return normalizeMoodboard({ ...layout, cards: next }, []);
}

export function moveMoodboardCards(layout: MoodboardLayout, ids: readonly string[], dx: number, dy: number): MoodboardLayout {
  const selected = new Set(ids);
  const movable = Object.entries(layout.cards).filter(([id, card]) => selected.has(id) && !card.locked && !card.hidden);
  const safeDx = Math.max(Number.isFinite(dx) ? dx : 0, -movable.reduce((min, [, c]) => Math.min(min, c.x), Infinity));
  const safeDy = Math.max(Number.isFinite(dy) ? dy : 0, -movable.reduce((min, [, c]) => Math.min(min, c.y), Infinity));
  return normalizeMoodboard({ ...layout, cards: Object.fromEntries(Object.entries(layout.cards).map(([id, card]) => [id,
    selected.has(id) && !card.locked && !card.hidden ? { ...card, x: card.x + safeDx, y: card.y + safeDy } : card,
  ])) }, []);
}

export function moodboardVisibleIds(layout: MoodboardLayout, viewport?: { x: number; y: number; w: number; h: number }): string[] {
  return Object.entries(layout.cards).filter(([, c]) => !c.hidden && (!viewport || (
    c.x + c.w >= viewport.x - 300 && c.y + c.h >= viewport.y - 300
    && c.x <= viewport.x + viewport.w + 300 && c.y <= viewport.y + viewport.h + 300
  ))).map(([id]) => id);
}
