import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('placement shelf can be cleared without auto-restoring old canvas nodes', () => {
  const canvas = read('../src/components/Canvas.tsx');

  assert.match(canvas, /onClear/);
  assert.match(canvas, /aria-label=\{t\('controls\.shelfClear'\)\}/);
  assert.match(canvas, /title=\{t\('controls\.shelfClear'\)\}/);
  assert.match(canvas, /placementShelfClearedCanvasIdsRef/);
  assert.match(canvas, /placementShelfClearedCanvasIdsRef\.current\.add\(activeId\)/);
  assert.match(canvas, /placementShelfClearedCanvasIdsRef\.current\.has\(requestedCanvasId\)/);
  assert.match(canvas, /setPlacementShelfItems\(placementShelfClearedCanvasIdsRef\.current\.has\(requestedCanvasId\)\s*\?\s*\[\]\s*:\s*placementShelfItemsFromCanvasNodes\(fixedNs, '画布'\)\)/);
});

test('selection context menu can add current nodes to placement shelf', () => {
  const canvas = read('../src/components/Canvas.tsx');

  assert.match(canvas, /type PlacementShelfSource = '粘贴' \| '发送' \| '生成' \| '画布' \| '手动'/);
  assert.match(canvas, /addNodesToPlacementShelf/);
  assert.match(canvas, /placementShelfItemFromNode\(node, '手动'\)/);
  assert.match(canvas, /添加到放置栏/);
  assert.match(canvas, /LucideIcons\.Archive/);
});

test('placement shelf can be hidden and restored from the consolidated canvas tools menu', () => {
  const canvas = read('../src/components/Canvas.tsx');
  const css = read('../src/styles/index.css');

  assert.match(canvas, /const \[placementShelfHidden, setPlacementShelfHidden\] = useState\(false\)/);
  assert.match(canvas, /onHide=\{\(\) => setPlacementShelfHidden\(true\)\}/);
  assert.match(canvas, /data-canvas-floating-ui="placement-shelf-hide"/);
  assert.match(canvas, /aria-label=\{t\('controls\.shelfHide'\)\}/);
  assert.match(canvas, /title=\{t\('controls\.shelfHide'\)\}/);
  assert.match(canvas, /data-canvas-floating-ui="control-tools-menu"/);
  assert.match(canvas, /data-canvas-floating-ui="placement-shelf-toggle"/);
  assert.match(canvas, /className=\{!placementShelfHidden \? 'is-active' : ''\}/);
  assert.match(canvas, /role="menuitemcheckbox"/);
  assert.match(canvas, /aria-checked=\{!placementShelfHidden\}/);
  assert.match(canvas, /setPlacementShelfHidden\(\(value\) => !value\)/);
  assert.match(canvas, /\{!placementShelfHidden && \(\s*<PlacementShelf/);
  assert.match(canvas, /setPlacementShelfHidden\(false\);[\s\S]*setPlacementShelfOpen\(true\);/);
  assert.match(canvas, /setPlacementShelfHidden\(true\);[\s\S]*setPlacementShelfItems\(\[\]\);/);

  assert.match(css, /\.t8-control-rail-placement-shelf/);
  assert.match(css, /\.t8-control-tools-menu/);
  assert.match(css, /\.t8-placement-shelf__hide/);
  assert.match(css, /\.t8-placement-shelf\[data-placement-shelf-hidden="false"\]/);
  assert.match(css, /html\[data-theme-visual\] \.t8-canvas-shell \.t8-control-rail-placement-shelf/);
});

test('placement shelf retains every canvas material and paginates only rendered previews', () => {
  const canvas = read('../src/components/Canvas.tsx');

  assert.doesNotMatch(canvas, /placementShelfItemsFromCanvasNodes[\s\S]{0,500}\.slice\(0, 60\)/);
  assert.doesNotMatch(canvas, /return next\.slice\(0, 60\)/);
  assert.match(canvas, /const \[expandedVisibleCount, setExpandedVisibleCount\] = useState\(20\)/);
  assert.match(canvas, /items\.slice\(0, open \? expandedVisibleCount : 5\)/);
  assert.match(canvas, /setExpandedVisibleCount\(\(count\) => Math\.min\(items\.length, count \+ 20\)\)/);
  assert.match(canvas, /controls\.shelfLoadMore/);
  assert.match(canvas, /limit: items\.length/);
});
