import { create } from 'zustand';
import type { CanvasListItem } from '../types/canvas';
import type { CanvasListRecoveryState } from '../services/api';
import * as api from '../services/api';

const CANVAS_BOOTSTRAP_PAGE_SIZE = 50;
const CANVAS_FULL_REFRESH_PAGE_SIZE = 200;
const ACTIVE_CANVAS_STORAGE_KEY = 't8-canvas-active-id-v1';

interface CanvasStoreState {
  canvases: CanvasListItem[];
  activeId: string | null;
  loading: boolean;
  loadingMore: boolean;
  bootstrapped: boolean;
  error: string | null;
  completionNoticeCanvasIds: string[];
  total: number | null;
  hasMore: boolean;
  nextCursor: string | null;
  catalogPartial: boolean;
  recovery: CanvasListRecoveryState | null;

  bootstrapCanvases: (force?: boolean) => Promise<void>;
  loadCanvases: () => Promise<void>;
  loadMoreCanvases: () => Promise<void>;
  refreshCanvasMetadata: (id: string) => Promise<CanvasListItem | null>;
  createCanvas: (name?: string) => Promise<CanvasListItem | null>;
  deleteCanvas: (id: string) => Promise<void>;
  renameCanvas: (id: string, name: string) => Promise<void>;
  setActive: (id: string) => void;
  markCanvasCompletionNotice: (id: string) => void;
  clearCanvasCompletionNotice: (id: string) => void;
}

let bootstrapFlight: Promise<void> | null = null;
let fullRefreshFlight: Promise<void> | null = null;
let loadMoreFlight: Promise<void> | null = null;
const metadataRefreshFlights = new Map<string, Promise<CanvasListItem | null>>();
let recoveryPollTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryPollAttempt = 0;
let recoveryPollInFlight = false;
const RECOVERY_POLL_DELAYS = [350, 750, 1_500, 3_000] as const;

function readPersistedActiveId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(ACTIVE_CANVAS_STORAGE_KEY);
    if (!value || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function persistActiveId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_CANVAS_STORAGE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CANVAS_STORAGE_KEY);
  } catch {
    // Storage pressure or privacy mode must never block opening a canvas.
  }
}

function sortCanvasItems(items: CanvasListItem[]) {
  return [...items].sort((left, right) => {
    const updatedDelta = (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
    return updatedDelta || String(left.id).localeCompare(String(right.id));
  });
}

function mergeCanvasItems(current: CanvasListItem[], incoming: Array<CanvasListItem | null | undefined>) {
  const byId = new Map<string, CanvasListItem>();
  for (const item of current) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of incoming) {
    if (item?.id) byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
  }
  return sortCanvasItems([...byId.values()]);
}

function nextActiveId(
  currentId: string | null,
  persistedId: string | null,
  items: CanvasListItem[],
  requestedActiveItem: CanvasListItem | null,
) {
  if (currentId && items.some((item) => item.id === currentId)) return currentId;
  if (persistedId && requestedActiveItem?.id === persistedId) return persistedId;
  if (persistedId && items.some((item) => item.id === persistedId)) return persistedId;
  return items[0]?.id || null;
}

function clearRecoveryPoll(resetAttempt = true) {
  if (recoveryPollTimer) clearTimeout(recoveryPollTimer);
  recoveryPollTimer = null;
  if (resetAttempt) recoveryPollAttempt = 0;
}

export function stopCanvasCatalogRecoveryPolling() {
  clearRecoveryPoll();
}

function scheduleRecoveryPoll() {
  if (recoveryPollTimer) return;
  const state = useCanvasStore.getState();
  if (state.recovery?.status !== 'running') {
    clearRecoveryPoll();
    return;
  }
  const hidden = typeof document !== 'undefined' && document.hidden;
  const delay = hidden
    ? RECOVERY_POLL_DELAYS[RECOVERY_POLL_DELAYS.length - 1]
    : RECOVERY_POLL_DELAYS[Math.min(recoveryPollAttempt, RECOVERY_POLL_DELAYS.length - 1)];
  recoveryPollAttempt = Math.min(recoveryPollAttempt + 1, RECOVERY_POLL_DELAYS.length - 1);
  recoveryPollTimer = setTimeout(async () => {
    recoveryPollTimer = null;
    if (typeof document !== 'undefined' && document.hidden) {
      scheduleRecoveryPoll();
      return;
    }
    recoveryPollInFlight = true;
    try {
      await useCanvasStore.getState().bootstrapCanvases(true);
    } finally {
      recoveryPollInFlight = false;
    }
  }, delay);
}

export const useCanvasStore = create<CanvasStoreState>((set, get) => ({
  canvases: [],
  activeId: null,
  loading: false,
  loadingMore: false,
  bootstrapped: false,
  error: null,
  completionNoticeCanvasIds: [],
  total: null,
  hasMore: false,
  nextCursor: null,
  catalogPartial: false,
  recovery: null,

  async bootstrapCanvases(force = false) {
    if (!force && get().bootstrapped) return;
    if (!recoveryPollInFlight) clearRecoveryPoll();
    if (bootstrapFlight) return bootstrapFlight;
    const hadBootstrappedCatalog = get().bootstrapped;
    bootstrapFlight = (async () => {
      if (!get().bootstrapped) set({ loading: true, error: null });
      const persistedId = readPersistedActiveId();
      try {
        const page = await api.listCanvasPage({
          limit: CANVAS_BOOTSTRAP_PAGE_SIZE,
          activeId: persistedId,
        });
        const items = mergeCanvasItems([], [...page.items, page.activeItem]);
        const activeId = page.partial && persistedId
          ? persistedId
          : nextActiveId(get().activeId, persistedId, items, page.activeItem);
        const completeCatalog = !page.hasMore && !page.partial;
        set((state) => ({
          canvases: items,
          activeId,
          loading: false,
          bootstrapped: true,
          error: null,
          total: page.total ?? Math.max(items.length, state.total || 0),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          catalogPartial: page.partial,
          recovery: page.recovery,
          completionNoticeCanvasIds: completeCatalog
            ? state.completionNoticeCanvasIds.filter((id) => items.some((canvas) => canvas.id === id))
            : state.completionNoticeCanvasIds,
        }));
        persistActiveId(activeId);
        if (page.recovery.status === 'running') {
          scheduleRecoveryPoll();
        } else {
          clearRecoveryPoll();
        }
      } catch (error: any) {
        clearRecoveryPoll();
        set({
          loading: false,
          // A failed first request must not make the empty state look
          // authoritative. A later recovery refresh may fail without taking
          // an already usable catalog offline.
          bootstrapped: hadBootstrappedCatalog,
          error: error?.message || '加载画布列表失败',
        });
      }
    })().finally(() => {
      bootstrapFlight = null;
    });
    return bootstrapFlight;
  },

  async loadCanvases() {
    if (fullRefreshFlight) return fullRefreshFlight;
    fullRefreshFlight = (async () => {
      set({ loading: true, error: null });
      const persistedId = get().activeId || readPersistedActiveId();
      try {
        let page = await api.listCanvasPage({
          limit: CANVAS_FULL_REFRESH_PAGE_SIZE,
          activeId: persistedId,
        });
        let items = mergeCanvasItems([], [...page.items, page.activeItem]);
        let cursor = page.nextCursor;
        let guard = 0;
        while (page.hasMore && cursor && !page.partial && guard < 1_000) {
          page = await api.listCanvasPage({
            limit: CANVAS_FULL_REFRESH_PAGE_SIZE,
            cursor,
          });
          items = mergeCanvasItems(items, page.items);
          cursor = page.nextCursor;
          guard += 1;
        }
        const activeId = page.partial && persistedId
          ? persistedId
          : nextActiveId(get().activeId, persistedId, items, page.activeItem);
        set((state) => ({
          canvases: items,
          activeId,
          loading: false,
          bootstrapped: true,
          error: null,
          total: page.total ?? Math.max(items.length, state.total || 0),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          catalogPartial: page.partial,
          recovery: page.recovery,
          completionNoticeCanvasIds: !page.hasMore && !page.partial
            ? state.completionNoticeCanvasIds.filter((id) => items.some((canvas) => canvas.id === id))
            : state.completionNoticeCanvasIds,
        }));
        persistActiveId(activeId);
        if (page.recovery.status === 'running') scheduleRecoveryPoll();
        else clearRecoveryPoll();
      } catch (error: any) {
        set({ loading: false, error: error?.message || '加载画布列表失败' });
      }
    })().finally(() => {
      fullRefreshFlight = null;
    });
    return fullRefreshFlight;
  },

  async loadMoreCanvases() {
    const state = get();
    if (!state.hasMore || !state.nextCursor || state.loadingMore) return;
    if (loadMoreFlight) return loadMoreFlight;
    const cursor = state.nextCursor;
    loadMoreFlight = (async () => {
      set({ loadingMore: true });
      try {
        const page = await api.listCanvasPage({
          limit: CANVAS_BOOTSTRAP_PAGE_SIZE,
          cursor,
        });
        set((current) => {
          if (current.nextCursor !== cursor) return { loadingMore: false };
          const canvases = mergeCanvasItems(current.canvases, page.items);
          return {
            canvases,
            loadingMore: false,
            total: page.total ?? Math.max(canvases.length, current.total || 0),
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            catalogPartial: page.partial,
            recovery: page.recovery,
          };
        });
        if (page.recovery.status === 'running') scheduleRecoveryPoll();
        else clearRecoveryPoll();
      } catch (error: any) {
        set({ loadingMore: false, error: error?.message || '继续加载画布失败' });
      }
    })().finally(() => {
      loadMoreFlight = null;
    });
    return loadMoreFlight;
  },

  async refreshCanvasMetadata(id) {
    const targetId = String(id || '').trim();
    if (!targetId) return null;
    const existingFlight = metadataRefreshFlights.get(targetId);
    if (existingFlight) return existingFlight;
    const flight = (async () => {
      try {
        const item = await api.getCanvasMetadata(targetId);
        if (!item) return null;
        set((state) => ({
          canvases: mergeCanvasItems(state.canvases, [item]),
        }));
        return item;
      } catch {
        // A metadata refresh is advisory after a successful save. Keep the
        // current catalog/page state instead of escalating to a full reload.
        return null;
      }
    })();
    metadataRefreshFlights.set(targetId, flight);
    void flight.finally(() => {
      if (metadataRefreshFlights.get(targetId) === flight) metadataRefreshFlights.delete(targetId);
    });
    return flight;
  },
  async createCanvas(name) {
    set({ error: null });
    try {
      const item = await api.createCanvas(name);
      set((state) => {
        const existed = state.canvases.some((canvas) => canvas.id === item.id);
        const canvases = mergeCanvasItems(state.canvases, [item]);
        return {
          canvases,
          activeId: item.id,
          total: state.total == null
            ? (state.hasMore ? null : canvases.length)
            : state.total + (existed ? 0 : 1),
          error: null,
          completionNoticeCanvasIds: state.completionNoticeCanvasIds.filter((noticeId) => noticeId !== item.id),
        };
      });
      persistActiveId(item.id);
      return item;
    } catch (error: any) {
      set({ error: error?.message || '创建画布失败' });
      return null;
    }
  },

  async deleteCanvas(id) {
    try {
      await api.deleteCanvas(id);
      set((state) => {
        const canvases = state.canvases.filter((item) => item.id !== id);
        const activeId = state.activeId === id ? canvases[0]?.id || null : state.activeId;
        persistActiveId(activeId);
        return {
          canvases,
          activeId,
          total: state.total == null ? null : Math.max(0, state.total - 1),
          completionNoticeCanvasIds: state.completionNoticeCanvasIds.filter((noticeId) => noticeId !== id),
        };
      });
    } catch (error: any) {
      set({ error: error?.message || '删除失败' });
    }
  },

  async renameCanvas(id, name) {
    try {
      const updated = await api.renameCanvas(id, name);
      set((state) => ({
        canvases: sortCanvasItems(state.canvases.map((item) => (item.id === id ? updated : item))),
      }));
    } catch (error: any) {
      set({ error: error?.message || '重命名失败' });
    }
  },

  setActive(id) {
    persistActiveId(id);
    set((state) => ({
      activeId: id,
      completionNoticeCanvasIds: state.completionNoticeCanvasIds.filter((noticeId) => noticeId !== id),
    }));
  },

  markCanvasCompletionNotice(id) {
    set((state) => {
      if (!id || id === state.activeId || state.completionNoticeCanvasIds.includes(id)) return state;
      return { completionNoticeCanvasIds: [...state.completionNoticeCanvasIds, id] };
    });
  },

  clearCanvasCompletionNotice(id) {
    set((state) => ({
      completionNoticeCanvasIds: state.completionNoticeCanvasIds.filter((noticeId) => noticeId !== id),
    }));
  },
}));
