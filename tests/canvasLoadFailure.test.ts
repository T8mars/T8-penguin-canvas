import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  authoritativeCanvasRevision,
  hasCanvasWriteAuthority,
  requireAuthoritativeCanvasRevision,
  readCurrentCanvasAuthority,
  StaleCanvasLoadError,
} from '../src/utils/canvasLoadAuthority.ts';
import { canvasDatabaseRecoveryPlanFromPayload } from '../src/utils/canvasDatabaseRecovery.ts';

test('canvas write authority requires a successful load with a strict server revision', () => {
  assert.equal(authoritativeCanvasRevision(7), 7);
  for (const invalid of [undefined, null, 0, -1, 1.5, '7', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(authoritativeCanvasRevision(invalid), null);
    assert.throws(() => requireAuthoritativeCanvasRevision(invalid), /revision/);
  }

  assert.equal(hasCanvasWriteAuthority({
    activeCanvasId: 'canvas-a',
    loadedCanvasId: null,
    loaded: false,
    revision: undefined,
  }), false);
  assert.equal(hasCanvasWriteAuthority({
    activeCanvasId: 'canvas-a',
    loadedCanvasId: 'canvas-b',
    loaded: true,
    revision: 8,
  }), false);
  assert.equal(hasCanvasWriteAuthority({
    activeCanvasId: 'canvas-a',
    loadedCanvasId: 'canvas-a',
    loaded: true,
    revision: 8,
  }), true);
});

test('GET 500 or timeout keeps edits at zero PUTs until a retry restores the server graph', () => {
  const serverGraph = [{ id: 'server-node', data: { label: 'old graph' } }];
  for (const failure of ['GET 500', 'timeout']) {
    let loaded = false;
    let loadedCanvasId: string | null = null;
    let revision: number | null = null;
    let putCalls = 0;
    let renderedGraph = [...serverGraph, { id: 'unsafe-local-edit', data: { label: failure } }];
    const attemptPut = () => {
      if (hasCanvasWriteAuthority({ activeCanvasId: 'canvas-a', loadedCanvasId, loaded, revision })) {
        putCalls += 1;
      }
    };

    attemptPut();
    assert.equal(putCalls, 0, `${failure} must not authorize a PUT`);

    revision = requireAuthoritativeCanvasRevision(11);
    renderedGraph = structuredClone(serverGraph);
    loadedCanvasId = 'canvas-a';
    loaded = true;

    assert.deepEqual(renderedGraph, serverGraph, `${failure} retry must restore the authoritative graph`);
    assert.equal(putCalls, 0, 'hydration itself must not autosave');
    attemptPut();
    assert.equal(putCalls, 1, 'an explicit post-recovery edit may save');
  }
});

test('Canvas keeps failed loads non-editable and exposes an explicit retry', () => {
  const source = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const routeSource = readFileSync(new URL('../backend/src/routes/canvas.js', import.meta.url), 'utf8');
  const loadStart = source.indexOf('.getCanvasData(requestedCanvasId)');
  const catchStart = source.indexOf('.catch((e) =>', loadStart);
  const catchEnd = source.indexOf('return () => {', catchStart);
  assert.ok(loadStart >= 0 && catchStart > loadStart && catchEnd > catchStart);
  const failedLoad = source.slice(catchStart, catchEnd);

  assert.match(failedLoad, /setCanvasLoadFailure\(\{[\s\S]*canvasId: requestedCanvasId,[\s\S]*message,[\s\S]*recovery: api\.canvasDatabaseRecoveryPlanFromError\(e\)/);
  assert.match(failedLoad, /setLoadedCanvasId\(null\)/);
  assert.match(failedLoad, /setLoaded\(false\)/);
  assert.doesNotMatch(failedLoad, /setNodes\(\[\]\)|setEdges\(\[\]\)|setLoaded\(true\)|histReset\(/);
  assert.match(source, /const revision = requireAuthoritativeCanvasRevision\(data\.revision\)/);
  assert.match(source, /if \(!loaded \|\| loadedCanvasId !== activeId\)/);
  assert.match(source, /data-canvas-load-state=\{loadFailure \? 'failed' : 'loading'\}/);
  assert.match(source, /setCanvasLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(source, /restoreCanvasDatabaseCanonicalBackup\(failure\.recovery\.planId\)/);
  assert.match(source, /window\.confirm\(t\('canvas:state\.restoreBackupConfirm'/);
  assert.match(source, /hasCanvasWriteAuthority\(\{/);
  assert.match(source, /const putBaseRevision = requireAuthoritativeCanvasRevision/);
  assert.match(routeSource, /explicitCanonicalBackupRecoveryAvailable !== true/);
  assert.match(routeSource, /canvasDatabaseRecoveryPlans\.delete\(planId\)/);
  assert.match(routeSource, /confirmation !== CANVAS_DATABASE_RECOVERY_CONFIRMATION/);
  assert.doesNotMatch(routeSource, /res\.json\(\{[\s\S]{0,300}authorization/);
});

test('only a live, bounded server recovery plan enables the explicit backup action', () => {
  const planId = '11111111-1111-4111-8111-111111111111';
  const expiresAt = Date.now() + 60_000;
  const valid = {
    recovery: {
      available: true,
      planId,
      expiresAt,
      potentiallyDiscardedWriteCount: 2,
      reasons: ['captured-write-sequence-behind-acknowledged-watermark'],
    },
  };
  assert.deepEqual(canvasDatabaseRecoveryPlanFromPayload(valid), {
    available: true,
    planId,
    expiresAt,
    potentiallyDiscardedWriteCount: 2,
    reasons: ['captured-write-sequence-behind-acknowledged-watermark'],
  });
  const expired = {
    recovery: {
      available: true,
      planId,
      expiresAt: Date.now() - 1,
      potentiallyDiscardedWriteCount: 2,
      reasons: ['captured-write-sequence-behind-acknowledged-watermark'],
    },
  };
  assert.equal(canvasDatabaseRecoveryPlanFromPayload(expired), null);
  assert.equal(canvasDatabaseRecoveryPlanFromPayload(new Error('untrusted')), null);
});

test('load refreshes a real earlier response once after the known save revision advances', async () => {
  let known = 1, reads = 0;
  const result = await readCurrentCanvasAuthority({ minimumRevision: () => known, cancelled: () => false,
    load: async () => { reads++; if (reads === 1) { known = 2; return { revision: 1, value: 'older' }; } return { revision: 2, value: 'saved' }; } });
  assert.equal(reads, 2); assert.equal(result.value, 'saved'); assert.equal(known, 2);
});

test('current authority loads once; stale or continuously advancing authority never loops or downgrades', async () => {
  let reads = 0;
  assert.equal((await readCurrentCanvasAuthority({ minimumRevision: () => 2, cancelled: () => false,
    load: async () => { reads++; return { revision: 2 }; } })).revision, 2);
  assert.equal(reads, 1);
  for (const advances of [false, true]) {
    reads = 0; let known = 2;
    await assert.rejects(readCurrentCanvasAuthority({ minimumRevision: () => known, cancelled: () => false,
      load: async () => { reads++; if (reads === 2 && advances) known = 3; return { revision: advances ? reads : 1 }; } }), StaleCanvasLoadError);
    assert.equal(reads, 2); assert.equal(known, advances ? 3 : 2);
  }
});

test('load cancellation and malformed revision never authorize a retry or a saved baseline', async () => {
  for (const outcome of ['cancel', 'invalid']) {
    let reads = 0, cancelled = false;
    await assert.rejects(readCurrentCanvasAuthority({ minimumRevision: () => 2, cancelled: () => cancelled,
      load: async () => { reads++; cancelled = outcome === 'cancel'; return { revision: outcome === 'invalid' ? '2' : 2 }; } }));
    assert.equal(reads, 1);
  }
});
