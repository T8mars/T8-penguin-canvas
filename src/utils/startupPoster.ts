declare const __APP_VERSION__: string;

export const STARTUP_POSTER_SUPPRESSION_SCHEMA = 't8-startup-poster-suppression-v1' as const;
export const STARTUP_POSTER_SUPPRESSION_STORAGE_KEY = 't8.startup-poster.suppression.v1';
export const STARTUP_POSTER_SESSION_STORAGE_PREFIX = 't8.startup-poster.session-dismissed.v1';
export const STARTUP_POSTER_SUPPRESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const STARTUP_POSTER_MINIMUM_CANVAS_SETTLE_MS = 900;
export const STARTUP_POSTER_REQUIRED_STABLE_SAMPLES = 3;

export interface StartupPosterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StartupPosterSuppressionRecord {
  schema: typeof STARTUP_POSTER_SUPPRESSION_SCHEMA;
  appVersion: string;
  campaignId: string;
  suppressedAt: number;
  suppressUntil: number;
}

export type StartupPosterVisibilityReason =
  | 'visible'
  | 'session-dismissed'
  | 'seven-day-suppression';

export interface StartupPosterVisibilityDecision {
  visible: boolean;
  reason: StartupPosterVisibilityReason;
  suppressUntil: number | null;
}

export type StartupPosterStackPosition = 'current' | 'next-one' | 'next-two' | 'hidden';

export interface StartupPosterCanvasSurfaceSnapshot {
  documentReadyState: DocumentReadyState;
  documentVisible: boolean;
  canvasLoadState: string | null;
  shellWidth: number;
  shellHeight: number;
  flowWidth: number;
  flowHeight: number;
  paneWidth: number;
  paneHeight: number;
  renderedNodeCount: number;
  expectedNodeCount: number;
}

export type StartupPosterExternalOpenFailure =
  | 'invalid-target'
  | 'popup-blocked'
  | 'system-open-failed';

export interface StartupPosterExternalOpenResult {
  opened: boolean;
  method: 'electron' | 'browser' | null;
  reason?: StartupPosterExternalOpenFailure;
}

interface StartupPosterPopupWindow {
  opener: unknown;
  location: { replace(url: string): void };
  close?: () => void;
}

export function advanceStartupPosterIndex(current: number, delta: number, count: number) {
  const normalizedCount = Math.max(0, Math.trunc(count));
  if (normalizedCount <= 1) return 0;
  const normalizedCurrent = ((Math.trunc(current) % normalizedCount) + normalizedCount) % normalizedCount;
  return (normalizedCurrent + Math.trunc(delta) + normalizedCount) % normalizedCount;
}

export function startupPosterStackPosition(index: number, activeIndex: number, count: number): StartupPosterStackPosition {
  const normalizedCount = Math.max(0, Math.trunc(count));
  if (normalizedCount <= 0) return 'hidden';
  const normalizedIndex = ((Math.trunc(index) % normalizedCount) + normalizedCount) % normalizedCount;
  const normalizedActive = ((Math.trunc(activeIndex) % normalizedCount) + normalizedCount) % normalizedCount;
  const depth = (normalizedIndex - normalizedActive + normalizedCount) % normalizedCount;
  if (depth === 0) return 'current';
  if (depth === 1) return 'next-one';
  if (depth === 2) return 'next-two';
  return 'hidden';
}

export function isStartupPosterCanvasSurfaceReady(snapshot: StartupPosterCanvasSurfaceSnapshot) {
  const expectedNodeCount = Math.max(0, Math.trunc(snapshot.expectedNodeCount));
  return snapshot.documentReadyState !== 'loading'
    && snapshot.documentVisible
    && snapshot.canvasLoadState == null
    && snapshot.shellWidth > 0
    && snapshot.shellHeight > 0
    && snapshot.flowWidth > 0
    && snapshot.flowHeight > 0
    && snapshot.paneWidth > 0
    && snapshot.paneHeight > 0
    && snapshot.renderedNodeCount >= expectedNodeCount;
}

function readElementSize(element: Element | null) {
  if (!(element instanceof HTMLElement)) return { width: 0, height: 0 };
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

export function readStartupPosterCanvasSurfaceSnapshot(expectedNodeCount = 0): StartupPosterCanvasSurfaceSnapshot {
  const shellSize = readElementSize(document.querySelector('.t8-canvas-shell'));
  const flowSize = readElementSize(document.querySelector('.react-flow'));
  const paneSize = readElementSize(document.querySelector('.react-flow__pane'));
  return {
    documentReadyState: document.readyState,
    documentVisible: document.visibilityState !== 'hidden',
    canvasLoadState: document.querySelector('[data-canvas-load-state]')?.getAttribute('data-canvas-load-state') ?? null,
    shellWidth: shellSize.width,
    shellHeight: shellSize.height,
    flowWidth: flowSize.width,
    flowHeight: flowSize.height,
    paneWidth: paneSize.width,
    paneHeight: paneSize.height,
    renderedNodeCount: document.querySelectorAll('.react-flow__node').length,
    expectedNodeCount: Math.max(0, Math.trunc(expectedNodeCount)),
  };
}

function startupPosterNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve(true);
    }, milliseconds);
    const handleAbort = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function waitForAnimationFrame(signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve(true);
    });
    const handleAbort = () => {
      window.cancelAnimationFrame(frame);
      resolve(false);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function waitForCanvasIdleOpportunity(signal: AbortSignal) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback !== 'function') {
    return waitForAnimationFrame(signal);
  }
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const handle = idleWindow.requestIdleCallback!((deadline) => {
      signal.removeEventListener('abort', handleAbort);
      resolve(!deadline.didTimeout && deadline.timeRemaining() > 0);
    }, { timeout: 1_200 });
    const handleAbort = () => {
      idleWindow.cancelIdleCallback?.(handle);
      resolve(false);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function waitForStartupPosterCanvasSurface(options: {
  expectedNodeCount?: number;
  minimumSettleMs?: number;
  requiredStableSamples?: number;
  signal: AbortSignal;
}) {
  const expectedNodeCount = Math.max(0, Math.trunc(options.expectedNodeCount ?? 0));
  const minimumSettleMs = Math.max(300, Math.min(5_000, Math.trunc(
    options.minimumSettleMs ?? STARTUP_POSTER_MINIMUM_CANVAS_SETTLE_MS,
  )));
  const requiredStableSamples = Math.max(2, Math.min(8, Math.trunc(
    options.requiredStableSamples ?? STARTUP_POSTER_REQUIRED_STABLE_SAMPLES,
  )));
  const startedAt = startupPosterNow();
  let previousSignature = '';
  let stableSamples = 0;

  while (!options.signal.aborted) {
    if (!await abortableDelay(120, options.signal)) break;
    if (!await waitForAnimationFrame(options.signal)) break;
    const snapshot = readStartupPosterCanvasSurfaceSnapshot(expectedNodeCount);
    if (!isStartupPosterCanvasSurfaceReady(snapshot)) {
      previousSignature = '';
      stableSamples = 0;
      continue;
    }
    const signature = [
      Math.round(snapshot.shellWidth),
      Math.round(snapshot.shellHeight),
      Math.round(snapshot.flowWidth),
      Math.round(snapshot.flowHeight),
      Math.round(snapshot.paneWidth),
      Math.round(snapshot.paneHeight),
      snapshot.renderedNodeCount,
    ].join(':');
    stableSamples = signature === previousSignature ? stableSamples + 1 : 1;
    previousSignature = signature;
    if (startupPosterNow() - startedAt < minimumSettleMs || stableSamples < requiredStableSamples) continue;
    if (!await waitForCanvasIdleOpportunity(options.signal)) continue;
    const finalSnapshot = readStartupPosterCanvasSurfaceSnapshot(expectedNodeCount);
    if (!isStartupPosterCanvasSurfaceReady(finalSnapshot)) continue;
    return {
      ready: true,
      waitedMs: Math.max(0, Math.round(startupPosterNow() - startedAt)),
      snapshot: finalSnapshot,
    };
  }

  return {
    ready: false,
    waitedMs: Math.max(0, Math.round(startupPosterNow() - startedAt)),
    snapshot: null,
  };
}

function preloadStartupPosterImage(url: string, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const image = new Image();
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      image.onload = null;
      image.onerror = null;
      resolve(loaded && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    };
    const finishLoaded = async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
      } catch {
        // A completed image with real dimensions is still safe when decode() is unavailable or rejects.
      }
      finish(true);
    };
    const handleAbort = () => finish(false);
    image.decoding = 'async';
    image.onload = () => { void finishLoaded(); };
    image.onerror = () => finish(false);
    signal.addEventListener('abort', handleAbort, { once: true });
    image.src = url;
    if (image.complete) void finishLoaded();
  });
}

export async function preloadStartupPosterImages(urls: readonly string[], signal: AbortSignal) {
  let pending = [...new Set(urls.map((url) => String(url || '').trim()).filter(Boolean))];
  if (pending.length === 0) return true;
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt += 1) {
    const results = await Promise.all(pending.map(async (url) => ({
      url,
      loaded: await preloadStartupPosterImage(url, signal),
    })));
    pending = results.filter((result) => !result.loaded).map((result) => result.url);
    if (pending.length === 0) return true;
    if (attempt < 2 && !await abortableDelay(attempt === 0 ? 180 : 600, signal)) break;
  }
  return false;
}

function isSafeStartupPosterTarget(url: string) {
  try {
    const target = new URL(url);
    return target.protocol === 'https:' || target.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function openStartupPosterExternalTarget(options: {
  url: string;
  electronOpen?: ((url: string) => Promise<unknown>) | null;
  openWindow?: ((url: string, target: string) => StartupPosterPopupWindow | null) | null;
}): Promise<StartupPosterExternalOpenResult> {
  if (!isSafeStartupPosterTarget(options.url)) {
    return { opened: false, method: null, reason: 'invalid-target' };
  }
  if (options.electronOpen) {
    try {
      const result = await options.electronOpen(options.url);
      if (result && typeof result === 'object' && 'success' in result
        && (result as { success?: unknown }).success === false) {
        return { opened: false, method: 'electron', reason: 'system-open-failed' };
      }
      // Older desktop bridges returned void after successfully dispatching shell.openExternal.
      return { opened: true, method: 'electron' };
    } catch {
      return { opened: false, method: 'electron', reason: 'system-open-failed' };
    }
  }
  if (!options.openWindow) {
    return { opened: false, method: 'browser', reason: 'popup-blocked' };
  }
  let popup: StartupPosterPopupWindow | null = null;
  try {
    // Opening an about:blank handle first lets us detect a blocked popup. Passing
    // `noopener` directly makes Chromium return null even when the tab opened.
    popup = options.openWindow('about:blank', '_blank');
    if (!popup) return { opened: false, method: 'browser', reason: 'popup-blocked' };
    popup.opener = null;
    popup.location.replace(options.url);
    return { opened: true, method: 'browser' };
  } catch {
    try { popup?.close?.(); } catch { /* Best-effort cleanup only. */ }
    return { opened: false, method: 'browser', reason: 'popup-blocked' };
  }
}

function normalizedToken(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function normalizedNow(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : Date.now();
}

function tryRemove(storage: StartupPosterStorage | null | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage is a best-effort preference boundary. A failure must never block startup.
  }
}

function parseSuppressionRecord(raw: string | null): StartupPosterSuppressionRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StartupPosterSuppressionRecord>;
    if (parsed.schema !== STARTUP_POSTER_SUPPRESSION_SCHEMA) return null;
    if (typeof parsed.appVersion !== 'string' || !parsed.appVersion.trim()) return null;
    if (typeof parsed.campaignId !== 'string' || !parsed.campaignId.trim()) return null;
    if (!Number.isSafeInteger(parsed.suppressedAt) || Number(parsed.suppressedAt) < 0) return null;
    if (!Number.isSafeInteger(parsed.suppressUntil) || Number(parsed.suppressUntil) <= Number(parsed.suppressedAt)) return null;
    return parsed as StartupPosterSuppressionRecord;
  } catch {
    return null;
  }
}

export function startupPosterSessionKey(appVersion: string, campaignId: string) {
  const version = encodeURIComponent(normalizedToken(appVersion, 'development'));
  const campaign = encodeURIComponent(normalizedToken(campaignId, 'default'));
  return `${STARTUP_POSTER_SESSION_STORAGE_PREFIX}:${version}:${campaign}`;
}

export function evaluateStartupPosterVisibility(options: {
  appVersion: string;
  campaignId: string;
  now: number;
  persistentStorage?: StartupPosterStorage | null;
  sessionStorage?: StartupPosterStorage | null;
}): StartupPosterVisibilityDecision {
  const appVersion = normalizedToken(options.appVersion, 'development');
  const campaignId = normalizedToken(options.campaignId, 'default');
  const now = normalizedNow(options.now);
  const sessionKey = startupPosterSessionKey(appVersion, campaignId);

  try {
    if (options.sessionStorage?.getItem(sessionKey) === '1') {
      return { visible: false, reason: 'session-dismissed', suppressUntil: null };
    }
  } catch {
    // Fail open when browser storage is unavailable.
  }

  let raw: string | null = null;
  try {
    raw = options.persistentStorage?.getItem(STARTUP_POSTER_SUPPRESSION_STORAGE_KEY) ?? null;
  } catch {
    return { visible: true, reason: 'visible', suppressUntil: null };
  }
  if (!raw) return { visible: true, reason: 'visible', suppressUntil: null };

  const record = parseSuppressionRecord(raw);
  const matchesCurrentBuild = record?.appVersion === appVersion && record.campaignId === campaignId;
  if (!record || !matchesCurrentBuild || now >= record.suppressUntil) {
    tryRemove(options.persistentStorage, STARTUP_POSTER_SUPPRESSION_STORAGE_KEY);
    return { visible: true, reason: 'visible', suppressUntil: null };
  }

  return {
    visible: false,
    reason: 'seven-day-suppression',
    suppressUntil: record.suppressUntil,
  };
}

export function persistStartupPosterDismissal(options: {
  appVersion: string;
  campaignId: string;
  now: number;
  suppressForSevenDays: boolean;
  persistentStorage?: StartupPosterStorage | null;
  sessionStorage?: StartupPosterStorage | null;
}) {
  const appVersion = normalizedToken(options.appVersion, 'development');
  const campaignId = normalizedToken(options.campaignId, 'default');
  const now = normalizedNow(options.now);
  const sessionKey = startupPosterSessionKey(appVersion, campaignId);

  try {
    options.sessionStorage?.setItem(sessionKey, '1');
  } catch {
    // The module-level mounted session still prevents an in-place duplicate.
  }

  if (!options.suppressForSevenDays) {
    tryRemove(options.persistentStorage, STARTUP_POSTER_SUPPRESSION_STORAGE_KEY);
    return null;
  }

  const record: StartupPosterSuppressionRecord = {
    schema: STARTUP_POSTER_SUPPRESSION_SCHEMA,
    appVersion,
    campaignId,
    suppressedAt: now,
    suppressUntil: now + STARTUP_POSTER_SUPPRESSION_MS,
  };
  try {
    options.persistentStorage?.setItem(
      STARTUP_POSTER_SUPPRESSION_STORAGE_KEY,
      JSON.stringify(record),
    );
    return record;
  } catch {
    return null;
  }
}

export function buildStartupPosterAppVersion() {
  return normalizedToken(
    typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
    'development',
  );
}

export async function resolveStartupPosterAppVersion(options: {
  buildVersion?: string;
  getRuntimeInfo?: (() => Promise<{ version?: unknown }>) | null;
  timeoutMs?: number;
} = {}) {
  const fallback = normalizedToken(options.buildVersion, buildStartupPosterAppVersion());
  if (!options.getRuntimeInfo) return fallback;

  const timeoutMs = Math.max(50, Math.min(5_000, Math.trunc(options.timeoutMs ?? 1_200)));
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const info = await Promise.race([
      options.getRuntimeInfo(),
      new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return normalizedToken(info?.version, fallback);
  } catch {
    return fallback;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
