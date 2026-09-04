const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('startup feedback does not equate a mounted shell with an interactive canvas', () => {
  const app = read('src/App.tsx');
  const sidebar = read('src/components/Sidebar.tsx');
  const canvas = read('src/components/Canvas.tsx');
  const store = read('src/stores/canvas.ts');

  assert.doesNotMatch(app, /addNodeRef\.current\?\.\(type\)/);
  assert.match(app, /canvasStartupReadiness\.canAddNodes/);
  assert.match(app, /<CanvasStartupFeedback/);
  assert.match(app, /onRetryLoadRef=\{retryCanvasLoadRef\}/);

  assert.match(sidebar, /if \(!canCreateCanvas\)/);
  assert.match(sidebar, /if \(!canAddNodes\)/);
  assert.match(sidebar, /aria-disabled=\{!canAddNodes\}/);
  assert.match(sidebar, /&& canvasBootstrapped[\s\S]{0,100}&& canvases\.length === 0/);
  assert.doesNotMatch(sidebar, /markCanvasPerformance\('canvas-catalog-interactive'\), \[\]\)/);

  assert.match(canvas, /phase: 'document'/);
  assert.match(canvas, /phase: 'flow'/);
  assert.match(canvas, /phase: 'ready'/);
  assert.match(canvas, /onReadinessChange\?\.\(surfaceReadiness\)/);

  assert.match(store, /bootstrapped: hadBootstrappedCatalog/);
  assert.match(store, /async createCanvas\(name\) \{\s*set\(\{ error: null \}\)/);
});

test('startup feedback exposes real stages, slow-start guidance, retry, and accessible status', () => {
  const feedback = read('src/components/CanvasStartupFeedback.tsx');
  const styles = read('src/styles/index.css');
  const translations = read('src/i18n/resources.ts');

  for (const key of ['backend', 'catalog', 'document', 'flow']) {
    assert.match(feedback, new RegExp(`startup\\.steps\\.${key}`));
  }
  assert.match(feedback, /5_000/);
  assert.match(feedback, /15_000/);
  assert.match(feedback, /aria-live="polite"/);
  assert.match(feedback, /onClick=\{onRetry\}/);
  assert.match(styles, /\.t8-sidebar-node\[aria-disabled="true"\]/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(translations, /首次启动或画布较多时会稍久，请勿重复点击/);
  assert.match(translations, /The first launch or a large canvas library may take longer/);
});
