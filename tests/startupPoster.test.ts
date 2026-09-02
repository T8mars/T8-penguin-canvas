import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  advanceStartupPosterIndex,
  isStartupPosterCanvasSurfaceReady,
  openStartupPosterExternalTarget,
  STARTUP_POSTER_SUPPRESSION_MS,
  STARTUP_POSTER_SUPPRESSION_STORAGE_KEY,
  evaluateStartupPosterVisibility,
  persistStartupPosterDismissal,
  resolveStartupPosterAppVersion,
  startupPosterStackPosition,
  startupPosterSessionKey,
  type StartupPosterStorage,
} from '../src/utils/startupPoster';

const root = path.resolve(import.meta.dirname, '..');
const componentSource = readFileSync(path.join(root, 'src/components/StartupPosterCarousel.tsx'), 'utf8');
const canvasSource = readFileSync(path.join(root, 'src/components/Canvas.tsx'), 'utf8');
const styles = readFileSync(path.join(root, 'src/components/StartupPosterCarousel.css'), 'utf8');

class MemoryStorage implements StartupPosterStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const campaignId = 'campaign-v1';
const appVersion = '3.1.3';
const now = 1_800_000_000_000;

test('same Electron version stays suppressed for exactly seven full days', () => {
  const persistentStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const record = persistStartupPosterDismissal({
    appVersion,
    campaignId,
    now,
    suppressForSevenDays: true,
    persistentStorage,
    sessionStorage,
  });
  assert.equal(record?.suppressUntil, now + STARTUP_POSTER_SUPPRESSION_MS);

  const beforeBoundary = evaluateStartupPosterVisibility({
    appVersion,
    campaignId,
    now: now + STARTUP_POSTER_SUPPRESSION_MS - 1,
    persistentStorage,
    sessionStorage: new MemoryStorage(),
  });
  assert.deepEqual(beforeBoundary, {
    visible: false,
    reason: 'seven-day-suppression',
    suppressUntil: now + STARTUP_POSTER_SUPPRESSION_MS,
  });

  const exactBoundary = evaluateStartupPosterVisibility({
    appVersion,
    campaignId,
    now: now + STARTUP_POSTER_SUPPRESSION_MS,
    persistentStorage,
    sessionStorage: new MemoryStorage(),
  });
  assert.deepEqual(exactBoundary, { visible: true, reason: 'visible', suppressUntil: null });
  assert.equal(persistentStorage.getItem(STARTUP_POSTER_SUPPRESSION_STORAGE_KEY), null);
});

test('an Electron version upgrade invalidates the old timer immediately and can start a new timer', () => {
  const persistentStorage = new MemoryStorage();
  persistStartupPosterDismissal({
    appVersion: '3.1.3',
    campaignId,
    now,
    suppressForSevenDays: true,
    persistentStorage,
    sessionStorage: new MemoryStorage(),
  });

  assert.deepEqual(evaluateStartupPosterVisibility({
    appVersion: '3.1.4',
    campaignId,
    now: now + 1_000,
    persistentStorage,
    sessionStorage: new MemoryStorage(),
  }), { visible: true, reason: 'visible', suppressUntil: null });

  const restarted = persistStartupPosterDismissal({
    appVersion: '3.1.4',
    campaignId,
    now: now + 2_000,
    suppressForSevenDays: true,
    persistentStorage,
    sessionStorage: new MemoryStorage(),
  });
  assert.equal(restarted?.appVersion, '3.1.4');
  assert.equal(restarted?.suppressUntil, now + 2_000 + STARTUP_POSTER_SUPPRESSION_MS);
});

test('unchecked dismissal lasts only for the current renderer session', () => {
  const persistentStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  persistStartupPosterDismissal({
    appVersion,
    campaignId,
    now,
    suppressForSevenDays: false,
    persistentStorage,
    sessionStorage,
  });
  assert.equal(persistentStorage.getItem(STARTUP_POSTER_SUPPRESSION_STORAGE_KEY), null);
  assert.deepEqual(evaluateStartupPosterVisibility({
    appVersion,
    campaignId,
    now: now + 1,
    persistentStorage,
    sessionStorage,
  }), { visible: false, reason: 'session-dismissed', suppressUntil: null });
  assert.equal(sessionStorage.getItem(startupPosterSessionKey(appVersion, campaignId)), '1');
  assert.equal(evaluateStartupPosterVisibility({
    appVersion,
    campaignId,
    now: now + 1,
    persistentStorage,
    sessionStorage: new MemoryStorage(),
  }).visible, true);
});

test('malformed or unavailable storage fails open instead of blocking startup', () => {
  const malformed = new MemoryStorage();
  malformed.setItem(STARTUP_POSTER_SUPPRESSION_STORAGE_KEY, '{bad-json');
  assert.equal(evaluateStartupPosterVisibility({
    appVersion,
    campaignId,
    now,
    persistentStorage: malformed,
    sessionStorage: null,
  }).visible, true);
  assert.equal(malformed.getItem(STARTUP_POSTER_SUPPRESSION_STORAGE_KEY), null);

  const throwing: StartupPosterStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(evaluateStartupPosterVisibility({
    appVersion,
    campaignId,
    now,
    persistentStorage: throwing,
    sessionStorage: throwing,
  }).visible, true);
});

test('runtime Electron version is authoritative with bounded build-version fallback', async () => {
  assert.equal(await resolveStartupPosterAppVersion({
    buildVersion: '3.1.3',
    getRuntimeInfo: async () => ({ version: '3.1.4' }),
  }), '3.1.4');
  assert.equal(await resolveStartupPosterAppVersion({
    buildVersion: '3.1.3',
    getRuntimeInfo: async () => { throw new Error('ipc unavailable'); },
  }), '3.1.3');
  assert.equal(await resolveStartupPosterAppVersion({
    buildVersion: '3.1.3',
    timeoutMs: 50,
    getRuntimeInfo: async () => new Promise(() => {}),
  }), '3.1.3');
});

test('multi-poster deck wraps in both directions and exposes only two real backing cards', () => {
  assert.equal(advanceStartupPosterIndex(0, 1, 4), 1);
  assert.equal(advanceStartupPosterIndex(0, -1, 4), 3);
  assert.equal(advanceStartupPosterIndex(3, 1, 4), 0);
  assert.equal(advanceStartupPosterIndex(8, -1, 1), 0);
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => startupPosterStackPosition(index, 0, 4)),
    ['current', 'next-one', 'next-two', 'hidden'],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => startupPosterStackPosition(index, 3, 4)),
    ['next-one', 'next-two', 'hidden', 'current'],
  );
});

test('canvas surface gate requires a visible stable ReactFlow surface and all expected nodes', () => {
  const readySurface = {
    documentReadyState: 'complete' as const,
    documentVisible: true,
    canvasLoadState: null,
    shellWidth: 1280,
    shellHeight: 720,
    flowWidth: 1280,
    flowHeight: 720,
    paneWidth: 1280,
    paneHeight: 720,
    renderedNodeCount: 12,
    expectedNodeCount: 12,
  };
  assert.equal(isStartupPosterCanvasSurfaceReady(readySurface), true);
  assert.equal(isStartupPosterCanvasSurfaceReady({ ...readySurface, documentVisible: false }), false);
  assert.equal(isStartupPosterCanvasSurfaceReady({ ...readySurface, canvasLoadState: 'loading' }), false);
  assert.equal(isStartupPosterCanvasSurfaceReady({ ...readySurface, paneWidth: 0 }), false);
  assert.equal(isStartupPosterCanvasSurfaceReady({ ...readySurface, renderedNodeCount: 11 }), false);
});

test('external target opening accepts Electron legacy success and avoids Chromium noopener false failures', async () => {
  assert.deepEqual(await openStartupPosterExternalTarget({
    url: 'https://api.seedance.nz/canvas',
    electronOpen: async () => undefined,
  }), { opened: true, method: 'electron' });
  assert.deepEqual(await openStartupPosterExternalTarget({
    url: 'https://api.seedance.nz/canvas',
    electronOpen: async () => ({ success: false }),
  }), { opened: false, method: 'electron', reason: 'system-open-failed' });

  let openedUrl = '';
  let openedTarget = '';
  let replacedUrl = '';
  const popup = {
    opener: {} as unknown,
    location: { replace(url: string) { replacedUrl = url; } },
  };
  assert.deepEqual(await openStartupPosterExternalTarget({
    url: 'https://api.seedance.nz/canvas',
    openWindow(url, target) {
      openedUrl = url;
      openedTarget = target;
      return popup;
    },
  }), { opened: true, method: 'browser' });
  assert.equal(openedUrl, 'about:blank');
  assert.equal(openedTarget, '_blank');
  assert.equal(popup.opener, null);
  assert.equal(replacedUrl, 'https://api.seedance.nz/canvas');
  assert.deepEqual(await openStartupPosterExternalTarget({
    url: 'https://api.seedance.nz/canvas',
    openWindow: () => null,
  }), { opened: false, method: 'browser', reason: 'popup-blocked' });
});

test('startup poster waits for authoritative Canvas readiness and exposes the selected stacked interaction', () => {
  assert.match(canvasSource, /<StartupPosterCarousel[\s\S]*ready=\{creatorAgentCanvasReady\}[\s\S]*expectedNodeCount=/);
  assert.match(componentSource, /https:\/\/api\.seedance\.nz\/canvas/);
  assert.match(componentSource, /window\.t8pc\?\.getInfo/);
  assert.match(componentSource, /window\.t8pc\?\.openExternal/);
  assert.match(componentSource, /waitForStartupPosterCanvasSurface/);
  assert.match(componentSource, /preloadStartupPosterImages/);
  assert.match(componentSource, /data-canvas-settle-ms=\{canvasSettleMs\}/);
  assert.doesNotMatch(componentSource, /window\.open\(activePoster\.targetUrl, '_blank', 'noopener,noreferrer'\)/);
  assert.match(componentSource, /onWheel=\{handleWheel\}/);
  assert.doesNotMatch(componentSource, /onWheelCapture=/);
  assert.match(componentSource, /onPointerMove=\{handlePointerMove\}/);
  assert.match(componentSource, /event\.key === 'ArrowLeft'/);
  assert.match(componentSource, /event\.key === 'ArrowRight'/);
  assert.match(componentSource, /data-multiple=\{multiple \? 'true' : 'false'\}/);
  assert.match(styles, /\.t8-startup-poster__card\.is-next-one/);
  assert.match(styles, /\.t8-startup-poster__card\.is-next-two/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
