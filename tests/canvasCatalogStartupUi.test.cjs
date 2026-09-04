const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('canvas bootstrap is independent from Sidebar mounting and restores persisted active id', () => {
  const app = read('src/App.tsx');
  const store = read('src/stores/canvas.ts');
  const sidebar = read('src/components/Sidebar.tsx');

  assert.match(app, /useCanvasStore\(\(state\) => state\.bootstrapCanvases\)/);
  assert.match(app, /backendStatus === 'ok'\) void bootstrapCanvases\(\)/);
  assert.match(app, /!sidebarCollapsed && \([\s\S]{0,160}<Sidebar/);
  assert.doesNotMatch(sidebar, /useEffect\([\s\S]{0,160}loadCanvases\(/);

  assert.match(store, /CANVAS_BOOTSTRAP_PAGE_SIZE = 50/);
  assert.match(store, /ACTIVE_CANVAS_STORAGE_KEY = 't8-canvas-active-id-v1'/);
  assert.match(store, /activeId: persistedId/);
  assert.match(store, /page\.partial && persistedId/);
  assert.match(store, /if \(bootstrapFlight\) return bootstrapFlight/);
  assert.doesNotMatch(store, /scheduleBackgroundHydration|backgroundHydrationTimer/);
  assert.match(store, /RECOVERY_POLL_DELAYS = \[350, 750, 1_500, 3_000\]/);
  assert.match(store, /document !== 'undefined' && document\.hidden/);
});

test('Sidebar renders a bounded canvas window and only pages on explicit scroll/click', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  assert.match(sidebar, /const CANVAS_ROW_HEIGHT = 42/);
  assert.match(sidebar, /const CANVAS_VIEWPORT_HEIGHT = 224/);
  assert.match(sidebar, /const CANVAS_ROW_OVERSCAN = 4/);
  assert.match(sidebar, /data-canvas-windowed-list="true"/);
  assert.match(sidebar, /visibleCanvases\.map/);
  assert.doesNotMatch(sidebar, /\{canvases\.map\(/);
  assert.match(sidebar, /loadMoreCanvases\(\)/);
  assert.match(sidebar, /listCanvasPage\(\{ limit: 50, query \}\)/);
  assert.match(sidebar, /useCanvasStore\(\(state\) => state\.canvases\)/);
  assert.doesNotMatch(sidebar, /= useCanvasStore\(\);/);

  const maximumMountedRowsForFiveThousand = Math.ceil(224 / 42) + 4 * 2;
  assert.equal(maximumMountedRowsForFiveThousand, 14);
  assert.ok(maximumMountedRowsForFiveThousand < 5_000 / 100);
});
test('custom theme startup cache is bounded and excludes embedded audio payloads', () => {
  const app = read('src/App.tsx');
  assert.match(app, /CUSTOM_THEME_TEMPLATE_CACHE_MAX_BYTES = 128 \* 1024/);
  assert.match(app, /\.slice\(0, 1\)/);
  assert.match(app, /\.startsWith\('data:'\)/);
  assert.match(app, /sanitizeCachedThemeTemplate\(activeTemplate\)/);
  assert.match(app, /cachedThemeStringByteLength\(serialized\) > CUSTOM_THEME_TEMPLATE_CACHE_MAX_BYTES/);
  assert.match(app, /useThemeStore\.setState\(\{ customTemplates: cachedTemplates \}\)/);
  assert.doesNotMatch(app, /templates: customTemplates \}\)/);
  assert.match(app, /requestIdleCallback/);
});


test('catalog recovery is asynchronous, small-batch, and autosave list mirrors are throttled', () => {
  const route = read('backend/src/routes/canvas.js');
  assert.match(route, /CANVAS_LIST_RECOVERY_BATCH_SIZE = 2/);
  assert.match(route, /fs\.promises\.readFile/);
  assert.match(route, /await yieldCanvasListRecovery\(\)/);
  assert.match(route, /publishCanvasListRecoveryPrefix\(recovered, generation\)/);
  assert.doesNotMatch(route, /function recoverCanvasListFromFiles\(\)/);
  assert.match(route, /throttleListMirror: true/);
  assert.match(route, /CANVAS_LIST_MIRROR_THROTTLE_MS = 2_000/);
  assert.match(route, /canvasListMutationEpoch/);
  assert.match(route, /mergeEpoch/);
  assert.match(route, /code: 'canvas_catalog_recovering'/);
  assert.match(route, /res\.set\('Retry-After', '1'\)/);
  assert.doesNotMatch(route, /atomicWriteJsonAsync/);
  assert.match(route, /updateCanvasCatalogMetadata/);
});

test('post-save catalog refresh is one targeted request and does not hydrate five thousand canvases', () => {
  const api = read('src/services/api.ts');
  const store = read('src/stores/canvas.ts');
  const canvas = read('src/components/Canvas.tsx');
  const portrait = read('src/components/nodes/PortraitMasterNode.tsx');
  const apiBlock = api.slice(
    api.indexOf('export async function getCanvasMetadata'),
    api.indexOf('export async function createCanvas'),
  );
  const storeBlock = store.slice(
    store.indexOf('async refreshCanvasMetadata'),
    store.indexOf('async createCanvas'),
  );

  assert.match(apiBlock, /encodeURIComponent\(targetId\).*\/metadata/);
  assert.equal((apiBlock.match(/await request</g) || []).length, 1);
  assert.doesNotMatch(apiBlock, /listCanvasPage|while\s*\(/);
  assert.match(apiBlock, /Promise<CanvasListItem \| null>/);
  assert.match(storeBlock, /metadataRefreshFlights\.get\(targetId\)/);
  assert.match(storeBlock, /mergeCanvasItems\(state\.canvases, \[item\]\)/);
  assert.doesNotMatch(storeBlock, /total:/);

  const legacyRefreshCalls = [canvas, portrait]
    .reduce((count, source) => count + (source.match(/await loadCanvases\(\)/g) || []).length, 0);
  const targetedRefreshCalls = [canvas, portrait]
    .reduce((count, source) => count + (source.match(/await refreshCanvasMetadata\(/g) || []).length, 0);
  assert.equal(legacyRefreshCalls, 0);
  assert.equal(targetedRefreshCalls, 4);
});
