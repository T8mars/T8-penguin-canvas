import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeOutputAspectSize,
  normalizeOutputViewState,
  resolveOutputGridColumns,
} from '../src/utils/outputView';

test('legacy OutputNode data remains legacy-auto without a forced height', () => {
  assert.deepEqual(normalizeOutputViewState(undefined), { version: 1, mode: 'legacy-auto' });
  assert.deepEqual(normalizeOutputViewState({ mode: 'free', width: 120, height: 80 }), { version: 1, mode: 'free' });
});

test('versioned free and aspect view dimensions are normalized', () => {
  assert.deepEqual(
    normalizeOutputViewState({ mode: 'free', width: 640, height: 480 }),
    { version: 1, mode: 'free', width: 640, height: 480 },
  );
  assert.deepEqual(
    normalizeOutputViewState({ mode: 'aspect', width: 360, height: 720 }),
    { version: 1, mode: 'aspect', width: 360, height: 720 },
  );
});

test('aspect sizing uses measured chrome instead of a magic header constant', () => {
  assert.deepEqual(computeOutputAspectSize({
    rootWidth: 640,
    rootHeight: 700,
    mediaWidth: 600,
    mediaHeight: 500,
    aspect: 16 / 9,
  }), { width: 640, height: 538 });
  assert.deepEqual(computeOutputAspectSize({
    rootWidth: 360,
    rootHeight: 700,
    mediaWidth: 320,
    mediaHeight: 568,
    aspect: 9 / 16,
  }), { width: 360, height: 701 });
});

test('adaptive image grid respects narrow and wide nodes', () => {
  assert.equal(resolveOutputGridColumns(1, 900), 1);
  assert.equal(resolveOutputGridColumns(6, 390), 1);
  assert.equal(resolveOutputGridColumns(4, 800), 2);
  assert.equal(resolveOutputGridColumns(6, 800), 3);
  assert.equal(resolveOutputGridColumns(8, 1100), 4);
});

test('full image source is reserved for the explicit detail viewer', () => {
  const hover = readFileSync(new URL('../src/components/ImageHoverPreview.tsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/components/ImageDetailViewer.tsx', import.meta.url), 'utf8');
  const output = readFileSync(new URL('../src/components/nodes/OutputNode.tsx', import.meta.url), 'utf8');
  assert.match(hover, /previewImageUrl\(src, 1024\)/);
  assert.match(hover, /onOpen\?\.\(\)/);
  assert.match(viewer, /data-canvas-floating-ui="image-detail-viewer"/);
  assert.match(output, /outputView: normalized/);
  assert.match(output, /keepAspectRatio=\{outputView\.mode === 'aspect'\}/);
});
