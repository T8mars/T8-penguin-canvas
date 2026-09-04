import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCanvasStartupReadiness,
  INITIAL_CANVAS_SURFACE_READINESS,
  type CanvasStartupReadinessInput,
  type CanvasSurfaceReadiness,
} from '../src/utils/canvasStartupReadiness';

function readiness(overrides: Partial<CanvasStartupReadinessInput> = {}) {
  return deriveCanvasStartupReadiness({
    backendStatus: 'ok',
    catalogBootstrapped: true,
    catalogLoading: false,
    catalogError: null,
    activeCanvasId: null,
    surface: INITIAL_CANVAS_SURFACE_READINESS,
    ...overrides,
  });
}

function surface(overrides: Partial<CanvasSurfaceReadiness>): CanvasSurfaceReadiness {
  return { ...INITIAL_CANVAS_SURFACE_READINESS, ...overrides };
}

test('shell, catalog, document, and flow readiness stay distinct', () => {
  assert.deepEqual(
    readiness({ backendStatus: 'checking', catalogBootstrapped: false }).stage,
    'connecting',
  );
  assert.deepEqual(
    readiness({ backendStatus: 'error', catalogBootstrapped: false }).stage,
    'backend-error',
  );
  const catalogLoading = readiness({ catalogBootstrapped: false, catalogLoading: true });
  assert.equal(catalogLoading.stage, 'catalog');
  assert.equal(catalogLoading.canCreateCanvas, false);
  assert.equal(catalogLoading.canAddNodes, false);

  const catalogFailed = readiness({
    catalogBootstrapped: false,
    catalogLoading: false,
    catalogError: 'catalog unavailable',
  });
  assert.equal(catalogFailed.stage, 'catalog-error');
  assert.equal(catalogFailed.error, 'catalog unavailable');
});

test('an authoritative empty catalog enables creation without pretending nodes are ready', () => {
  const empty = readiness();
  assert.equal(empty.stage, 'empty');
  assert.equal(empty.catalogReady, true);
  assert.equal(empty.canCreateCanvas, true);
  assert.equal(empty.canAddNodes, false);
});

test('node interaction requires the active canvas, revision, and Flow readiness to match', () => {
  const activeCanvasId = 'canvas-a';
  const stale = readiness({
    activeCanvasId,
    surface: surface({ phase: 'ready', canvasId: 'canvas-b', loadedCanvasId: 'canvas-b', revision: 3, flowCanvasId: 'canvas-b' }),
  });
  assert.equal(stale.stage, 'document');
  assert.equal(stale.canAddNodes, false);

  const flow = readiness({
    activeCanvasId,
    surface: surface({ phase: 'flow', canvasId: activeCanvasId, loadedCanvasId: activeCanvasId, revision: 3 }),
  });
  assert.equal(flow.stage, 'flow');
  assert.equal(flow.canAddNodes, false);

  const ready = readiness({
    activeCanvasId,
    surface: surface({
      phase: 'ready',
      canvasId: activeCanvasId,
      loadedCanvasId: activeCanvasId,
      revision: 3,
      flowCanvasId: activeCanvasId,
    }),
  });
  assert.equal(ready.stage, 'ready');
  assert.equal(ready.canCreateCanvas, true);
  assert.equal(ready.canAddNodes, true);
});

test('current-canvas failure remains explicit and retryable while catalog creation stays available', () => {
  const failed = readiness({
    activeCanvasId: 'canvas-a',
    surface: surface({ phase: 'failed', canvasId: 'canvas-a', error: 'revision unavailable' }),
  });
  assert.equal(failed.stage, 'canvas-error');
  assert.equal(failed.error, 'revision unavailable');
  assert.equal(failed.canCreateCanvas, true);
  assert.equal(failed.canAddNodes, false);
});
