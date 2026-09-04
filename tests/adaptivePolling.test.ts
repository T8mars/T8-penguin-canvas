import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nextAdaptivePollDecision } from '../src/utils/adaptivePolling';
import { getRhToolboxPersistentManifest, markBackendFrontendInteractive } from '../src/services/api';

const root = path.resolve(import.meta.dirname, '..');

test('adaptive passive polling backs off while idle and resets after activity', () => {
  assert.deepEqual(nextAdaptivePollDecision({
    baseMs: 1_800,
    maxMs: 15_000,
    idleStreak: 0,
    hadActivity: false,
    failed: false,
  }), { idleStreak: 1, delayMs: 3_600 });
  assert.deepEqual(nextAdaptivePollDecision({
    baseMs: 1_800,
    maxMs: 15_000,
    idleStreak: 8,
    hadActivity: false,
    failed: false,
  }), { idleStreak: 9, delayMs: 15_000 });
  assert.deepEqual(nextAdaptivePollDecision({
    baseMs: 1_800,
    maxMs: 15_000,
    idleStreak: 9,
    hadActivity: true,
    failed: false,
  }), { idleStreak: 0, delayMs: 1_800 });
});

test('failed passive polls use stronger bounded backoff', () => {
  assert.deepEqual(nextAdaptivePollDecision({
    baseMs: 2_500,
    maxMs: 15_000,
    idleStreak: 0,
    hadActivity: false,
    failed: true,
  }), { idleStreak: 1, delayMs: 10_000 });
  assert.equal(nextAdaptivePollDecision({
    baseMs: 2_500,
    maxMs: 15_000,
    idleStreak: 4,
    hadActivity: false,
    failed: true,
  }).delayMs, 15_000);
});

test('RH toolbox manifest readers share one request and coalesce immediate forced refreshes', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await Promise.resolve();
    return {
      ok: true,
      json: async () => ({ manifest: { version: 1, categories: [], tools: [] }, categoryCount: 0, toolCount: 0 }),
    } as Response;
  }) as typeof fetch;
  try {
    const results = await Promise.all([
      getRhToolboxPersistentManifest(),
      getRhToolboxPersistentManifest(),
      getRhToolboxPersistentManifest(true),
    ]);
    assert.equal(calls, 1);
    assert.ok(results.every((result) => result.success));
    await getRhToolboxPersistentManifest(true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renderer readiness signalling is idempotent across concurrent health checks', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await Promise.resolve();
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    assert.deepEqual(await Promise.all([
      markBackendFrontendInteractive(),
      markBackendFrontendInteractive(),
      markBackendFrontendInteractive(),
    ]), [true, true, true]);
    assert.equal(calls, 1);
    assert.equal(await markBackendFrontendInteractive(), true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('optional bridge and collaboration polling is visibility-aware and RH manifests are event-driven', () => {
  const canvas = fs.readFileSync(path.join(root, 'src/components/Canvas.tsx'), 'utf8');
  const rhToolbox = fs.readFileSync(path.join(root, 'src/components/nodes/RHToolboxNode.tsx'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'src/services/api.ts'), 'utf8');
  assert.match(canvas, /\/api\/vibex-bridge\/pending[\s\S]*nextAdaptivePollDecision/);
  assert.match(canvas, /\/api\/photoshop-bridge\/pending[\s\S]*nextAdaptivePollDecision/);
  assert.match(canvas, /listCollaborationRunIntents\('accepted'[\s\S]*nextAdaptivePollDecision/);
  assert.ok((canvas.match(/document\.visibilityState !== 'visible'/g) || []).length >= 6);
  assert.match(rhToolbox, /penguin:rh-toolbox-manifest-updated/);
  assert.match(rhToolbox, /visibilitychange/);
  assert.doesNotMatch(rhToolbox, /setInterval\(\(\) => refreshManifest/);
  assert.match(rhToolbox, /getRhToolboxPersistentManifest\(Boolean\(event\)\)/);
  assert.match(api, /let rhPersistentManifestRequest: Promise<Result<RhToolboxManifestPersistenceResult>> \| null = null/);
  assert.match(api, /if \(rhPersistentManifestRequest\) return rhPersistentManifestRequest/);
  assert.match(api, /RH_PERSISTENT_MANIFEST_FORCE_MIN_INTERVAL_MS = 1_000/);
});
