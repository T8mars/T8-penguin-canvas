import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CanvasData } from '../src/types/canvas.ts';
import type { CanvasOperation } from '../src/types/project.ts';
import { mergeCanvasPatchValueWithConflicts } from '../src/utils/canvasPatchMerge.ts';
import {
  applyCommittedCanvasNodePatches,
  consumeCommittedCanvasNodePatches,
  readCommittedCanvasNodePatches,
  recordCommittedCanvasNodePatch,
  resetCommittedCanvasNodePatchMailboxForTests,
} from '../src/utils/committedCanvasNodePatchMailbox.ts';
import {
  applyOffscreenCanvasNodePatch,
  type OffscreenCanvasNodePatchClient,
} from '../src/utils/offscreenCanvasNodePatch.ts';

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';
const UID_REPLACEMENT = '33333333-3333-4333-8333-333333333333';

function document(
  canvasId: string,
  revision: number,
  nodes: Array<{ id: string; entityUid: string; data?: Record<string, unknown> }>,
): CanvasData {
  return {
    canvasId,
    revision,
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('A and B runs with the same visible node id finish out of order without crossing providers', async () => {
  const documents = new Map([
    ['canvas-a', document('canvas-a', 4, [{ id: 'story-1', entityUid: UID_A }])],
    ['canvas-b', document('canvas-b', 9, [{ id: 'story-1', entityUid: UID_B }])],
  ]);
  const completions = new Map([
    ['canvas-a', deferred<{ document: CanvasData }>()],
    ['canvas-b', deferred<{ document: CanvasData }>()],
  ]);
  const calls: Array<{ canvasId: string; operation: CanvasOperation; baseRevision: number }> = [];
  const client: OffscreenCanvasNodePatchClient = {
    getCanvasData: async (canvasId) => structuredClone(documents.get(canvasId)!),
    applyCanvasOperations: async (canvasId, operations, baseRevision) => {
      calls.push({ canvasId, operation: operations[0], baseRevision });
      return completions.get(canvasId)!.promise;
    },
    isRevisionConflict: () => false,
  };

  const runA = applyOffscreenCanvasNodePatch({
    canvasId: 'canvas-a',
    nodeId: 'story-1',
    entityUid: UID_A,
    dataPatch: { status: 'completed', output: 'A' },
  }, client);
  const runB = applyOffscreenCanvasNodePatch({
    canvasId: 'canvas-b',
    nodeId: 'story-1',
    entityUid: UID_B,
    dataPatch: { status: 'completed', output: 'B' },
  }, client);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.length, 2);
  assert.equal(calls.find((call) => call.canvasId === 'canvas-a')?.operation.payload.nodeId, UID_A);
  assert.equal(calls.find((call) => call.canvasId === 'canvas-b')?.operation.payload.nodeId, UID_B);
  assert.deepEqual(calls.map((call) => [call.canvasId, call.baseRevision]), [
    ['canvas-a', 4],
    ['canvas-b', 9],
  ]);

  completions.get('canvas-b')!.resolve({
    document: document('canvas-b', 10, [{ id: 'story-1', entityUid: UID_B, data: { output: 'B' } }]),
  });
  const resultB = await runB;
  assert.equal(resultB.document?.canvasId, 'canvas-b');

  completions.get('canvas-a')!.resolve({
    document: document('canvas-a', 5, [{ id: 'story-1', entityUid: UID_A, data: { output: 'A' } }]),
  });
  const resultA = await runA;
  assert.equal(resultA.document?.canvasId, 'canvas-a');
});

test('409 performs one GET and retries the identical node.patch against the new revision', async () => {
  const reads = [
    document('canvas-a', 7, [{ id: 'story-1', entityUid: UID_A }]),
    document('canvas-a', 8, [{ id: 'story-1', entityUid: UID_A }]),
  ];
  let readIndex = 0;
  const calls: Array<{ operation: CanvasOperation; baseRevision: number }> = [];
  const conflict = Object.assign(new Error('revision conflict'), { status: 409 });
  const client: OffscreenCanvasNodePatchClient = {
    getCanvasData: async () => structuredClone(reads[Math.min(readIndex++, reads.length - 1)]),
    applyCanvasOperations: async (_canvasId, operations, baseRevision) => {
      calls.push({ operation: operations[0], baseRevision });
      if (calls.length === 1) throw conflict;
      return { document: document('canvas-a', 9, [{ id: 'story-1', entityUid: UID_A }]) };
    },
    isRevisionConflict: (error) => error === conflict,
  };

  const result = await applyOffscreenCanvasNodePatch({
    canvasId: 'canvas-a',
    nodeId: 'story-1',
    entityUid: UID_A,
    dataPatch: { status: 'completed', output: ['one', 'two'] },
  }, client);

  assert.equal(result.applied, true);
  assert.equal(readIndex, 2);
  assert.deepEqual(calls.map((call) => call.baseRevision), [7, 8]);
  assert.strictEqual(calls[0].operation, calls[1].operation);
  assert.deepEqual(calls[0].operation.payload.dataPatch, { status: 'completed', output: ['one', 'two'] });
});

test('409 followed by deletion or same-id recreation never resurrects the old run target', async () => {
  const reads = [
    document('canvas-a', 7, [{ id: 'story-1', entityUid: UID_A }]),
    document('canvas-a', 8, [{ id: 'story-1', entityUid: UID_REPLACEMENT }]),
  ];
  let readIndex = 0;
  let applyCalls = 0;
  const conflict = Object.assign(new Error('revision conflict'), { status: 409 });
  const client: OffscreenCanvasNodePatchClient = {
    getCanvasData: async () => structuredClone(reads[Math.min(readIndex++, reads.length - 1)]),
    applyCanvasOperations: async () => {
      applyCalls += 1;
      throw conflict;
    },
    isRevisionConflict: (error) => error === conflict,
  };

  const result = await applyOffscreenCanvasNodePatch({
    canvasId: 'canvas-a',
    nodeId: 'story-1',
    entityUid: UID_A,
    dataPatch: { status: 'completed' },
  }, client);

  assert.equal(result.applied, false);
  assert.equal(result.document, null);
  assert.equal(readIndex, 2);
  assert.equal(applyCalls, 1);
});

test('provider remount flushes an A edit before B mounts and switching never aborts the durable run', () => {
  const canvasSource = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const updateSource = readFileSync(new URL('../src/components/nodes/useUpdateNodeData.ts', import.meta.url), 'utf8');
  const runSource = readFileSync(new URL('../src/hooks/useRunTrigger.ts', import.meta.url), 'utf8');

  assert.match(canvasSource, /<ReactFlowProvider key=\{activeCanvasId \|\| 'canvas-empty'\}>/);
  assert.match(canvasSource, /<CanvasInner \{\.\.\.props\} persistenceRuntime=\{persistenceRuntime\} \/>/);
  assert.match(canvasSource, /for \(const flushPendingAutosave of \[\.\.\.pendingSaveFlushersByCanvasRef\.current\.values\(\)\]\)/);
  assert.match(canvasSource, /pendingSaveFlushersByCanvasRef\.current\.set\(canvasIdForSave, flushPendingAutosave\)/);
  assert.match(canvasSource, /let started = false;[\s\S]{0,180}if \(started\) return;/);

  const cleanupStart = canvasSource.indexOf('for (const flushPendingAutosave of [...pendingSaveFlushersByCanvasRef.current.values()])');
  const cleanupEnd = canvasSource.indexOf('cancelScheduledHistoryCapture();', cleanupStart);
  const cleanup = canvasSource.slice(cleanupStart, cleanupEnd);
  assert.doesNotMatch(cleanup, /pendingSaveByCanvasRef\.current\.clear|latestPersistableByCanvasRef\.current\.clear/);

  const storeUpdate = updateSource.indexOf('setNodes((nds) =>');
  const detachedGuard = updateSource.indexOf('const originProviderDetached = !originProviderMountedRef.current');
  const offscreenWrite = updateSource.indexOf('if (originCanvasId && (');
  assert.ok(
    detachedGuard >= 0 && storeUpdate >= 0 && offscreenWrite > storeUpdate,
    'origin provider store must update before the detached-provider offscreen write',
  );
  assert.match(updateSource, /applyOffscreenCanvasNodePatch/);
  assert.doesNotMatch(updateSource, /saveCanvasData/);
  assert.doesNotMatch(runSource, /return\s*\(\)\s*=>\s*\{?[\s\S]{0,160}executionAbortController\.abort/);

  let persistedA: Record<string, unknown> | null = null;
  let started = false;
  const pendingFlushers = new Map<string, () => void>();
  const latestA = { prompt: 'edited immediately before switch' };
  const flushA = () => {
    if (started) return;
    started = true;
    pendingFlushers.delete('canvas-a');
    persistedA = structuredClone(latestA);
  };
  pendingFlushers.set('canvas-a', flushA);
  for (const flush of [...pendingFlushers.values()]) flush();
  const mountedB = true;

  assert.equal(mountedB, true);
  assert.deepEqual(persistedA, latestA);
  assert.equal(pendingFlushers.size, 0);
});

test('A to B to A completion from a detached provider still persists and updates the visible A provider', () => {
  const canvasSource = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const updateSource = readFileSync(new URL('../src/components/nodes/useUpdateNodeData.ts', import.meta.url), 'utf8');

  assert.match(updateSource, /return \(\) => \{ originProviderMountedRef\.current = false; \}/);
  assert.match(
    updateSource,
    /if \(originCanvasId && \(\s*originProviderDetached\s*\|\| activeCanvasId !== originCanvasId\s*\|\| hasPendingOffscreenPatch/,
  );
  assert.match(
    updateSource,
    /\(originProviderDetached \|\| activeCanvasId !== originCanvasId\) && isCompletedCanvasPatch\(patch\)/,
  );
  assert.match(updateSource, /penguin:canvas-background-node-patched/);
  assert.match(updateSource, /recordCommittedCanvasNodePatch/);
  assert.match(updateSource, /dataPatch: mailboxEntry\.dataPatch/);
  assert.match(updateSource, /document: result\.document/);
  assert.ok(updateSource.indexOf('recordCommittedCanvasNodePatch') < updateSource.indexOf("window.dispatchEvent(new CustomEvent('penguin:canvas-background-node-patched'"));
  assert.match(canvasSource, /addEventListener\('penguin:canvas-background-node-patched'/);
  assert.match(canvasSource, /isCanonicalEntityUid\(detail\.entityUid\)/);
  assert.match(
    canvasSource,
    /const renderedState = mergeResult\.state;[\s\S]{0,220}autosaveGenerationByCanvasRef\.current\.set\(/,
  );
  assert.match(canvasSource, /if \(response\.pending\?\.conflicted\)[\s\S]{0,600}response\.shouldScheduleCas/);
  assert.match(canvasSource, /commitAuthoritativeCanvasPatchDocument\(canvasId, document/);

  const originCanvasId = 'canvas-a';
  const activeCanvasId = 'canvas-a';
  const originProviderDetached = true;
  const hasPendingOffscreenPatch = false;
  assert.equal(
    originProviderDetached || activeCanvasId !== originCanvasId || hasPendingOffscreenPatch,
    true,
    'returning to A must not make the detached old provider look current again',
  );

  const base = { id: 'story-1', entityUid: UID_A, data: { prompt: 'old', status: 'running' } };
  const local = { id: 'story-1', entityUid: UID_A, data: { prompt: 'edited on new A', status: 'running' } };
  const authoritative = {
    id: 'story-1',
    entityUid: UID_A,
    data: { prompt: 'old', status: 'completed', output: 'durable A result' },
  };
  const merged = mergeCanvasPatchValueWithConflicts<typeof local>(base, local, authoritative, 'node');
  assert.equal(merged.value.data.prompt, 'edited on new A');
  assert.equal(merged.value.data.status, 'completed');
  assert.equal((merged.value.data as Record<string, unknown>).output, 'durable A result');
  assert.deepEqual(merged.conflicts, []);
});

test('terminal offscreen failure is caught and rendered as a visible Canvas alert', () => {
  const canvasSource = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const updateSource = readFileSync(new URL('../src/components/nodes/useUpdateNodeData.ts', import.meta.url), 'utf8');
  assert.match(updateSource, /const settled = next\.catch\(\(error\) => \{/);
  assert.match(updateSource, /penguin:canvas-background-save-error/);
  assert.match(canvasSource, /addEventListener\('penguin:canvas-background-save-error'/);
  assert.match(canvasSource, /data-canvas-background-save-error="true"/);
  assert.match(canvasSource, /role="alert"/);
  assert.equal((canvasSource.match(/data-canvas-background-save-error="true"/g) || []).length, 1);
  const shellStart = canvasSource.indexOf('className={`t8-canvas-shell flex-1 relative');
  const alertStart = canvasSource.indexOf('data-canvas-background-save-error="true"');
  const toolbarStart = canvasSource.indexOf('<CanvasToolbar', shellStart);
  assert.ok(
    shellStart >= 0 && alertStart > shellStart && alertStart < toolbarStart,
    'background save alert must be a single top-level child of the canvas shell',
  );
  assert.match(canvasSource, /data-canvas-background-save-error-kind=\{backgroundSaveFailure\.kind\}/);
  assert.match(canvasSource, /backgroundSaveFailure\.kind === 'persist-failed'[\s\S]{0,180}canvas:backgroundSave.persistFailed/);
  assert.match(canvasSource, /canvas:backgroundSave.syncFailed/);
  assert.match(canvasSource, /canvas:backgroundSave.syncDetail/);
  const localized = readFileSync(new URL('../src/i18n/resources.ts', import.meta.url), 'utf8');
  assert.match(localized, /后台节点结果未能保存/);
  assert.match(localized, /后台节点结果已保存，当前界面同步失败/);
  assert.match(localized, /服务端结果已持久化；请重新打开该画布以同步最新结果，无需重新生成。/);
});

test('commit before the replacement listener mounts remains visible through the bounded mailbox', () => {
  resetCommittedCanvasNodePatchMailboxForTests();
  try {
    const recorded = recordCommittedCanvasNodePatch({
      canvasId: 'canvas-a',
      nodeId: 'story-1',
      entityUid: UID_A,
      revision: 12,
      dataPatch: { status: 'completed', output: 'committed before mount' },
    });
    assert.ok(recorded);

    // The event was missed because the replacement provider had no listener yet.
    const pending = readCommittedCanvasNodePatches('canvas-a');
    assert.equal(pending.length, 1);
    const replacementProviderNodes = [{
      id: 'story-1',
      entityUid: UID_A,
      data: { prompt: 'edited on the replacement A provider', status: 'running' },
    }];
    const visible = applyCommittedCanvasNodePatches(replacementProviderNodes, pending);
    assert.equal(visible.nodes[0].data.prompt, 'edited on the replacement A provider');
    assert.equal(visible.nodes[0].data.status, 'completed');
    assert.equal(visible.nodes[0].data.output, 'committed before mount');
    assert.deepEqual(visible.appliedEntityUids, [UID_A]);

    const canvasSource = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
    const readIndex = canvasSource.indexOf('readCommittedCanvasNodePatches(activeId)');
    const revisionGateIndex = canvasSource.indexOf('document.revision < throughRevision', readIndex);
    const authoritativeMergeIndex = canvasSource.indexOf('commitAuthoritativeCanvasPatchDocument(canvasId, document', readIndex);
    const consumeIndex = canvasSource.indexOf('consumeCommittedCanvasNodePatches(canvasId, document.revision)', readIndex);
    assert.ok(readIndex >= 0, 'replacement provider must drain the mailbox after load');
    assert.ok(revisionGateIndex > readIndex, 'stale GETs must not consume a newer committed patch');
    assert.ok(authoritativeMergeIndex > revisionGateIndex, 'the fallback must merge an authoritative document');
    assert.ok(consumeIndex > authoritativeMergeIndex, 'mailbox consumption must follow a visible authoritative merge');

    consumeCommittedCanvasNodePatches('canvas-a', 12);
    assert.deepEqual(readCommittedCanvasNodePatches('canvas-a'), []);
  } finally {
    resetCommittedCanvasNodePatchMailboxForTests();
  }
});

test('an older committed revision never overwrites newer mailbox data', () => {
  resetCommittedCanvasNodePatchMailboxForTests();
  try {
    recordCommittedCanvasNodePatch({
      canvasId: 'canvas-a',
      nodeId: 'story-1',
      entityUid: UID_A,
      revision: 12,
      dataPatch: { status: 'completed', output: 'newest' },
    });
    recordCommittedCanvasNodePatch({
      canvasId: 'canvas-a',
      nodeId: 'story-1',
      entityUid: UID_A,
      revision: 11,
      dataPatch: { status: 'running', output: 'stale' },
    });

    const [entry] = readCommittedCanvasNodePatches('canvas-a');
    assert.equal(entry.revision, 12);
    assert.deepEqual(entry.dataPatch, { status: 'completed', output: 'newest' });
  } finally {
    resetCommittedCanvasNodePatchMailboxForTests();
  }
});

test('committed patch mailbox is bounded and evicts the least-recent entry', () => {
  resetCommittedCanvasNodePatchMailboxForTests();
  try {
    for (let index = 1; index <= 201; index += 1) {
      const suffix = index.toString(16).padStart(12, '0');
      recordCommittedCanvasNodePatch({
        canvasId: 'canvas-a',
        nodeId: `node-${index}`,
        entityUid: `00000000-0000-4000-8000-${suffix}`,
        revision: index,
        dataPatch: { index },
      });
    }
    const entries = readCommittedCanvasNodePatches('canvas-a');
    assert.equal(entries.length, 200);
    assert.equal(entries.some((entry) => entry.nodeId === 'node-1'), false);
    assert.equal(entries.some((entry) => entry.nodeId === 'node-201'), true);
  } finally {
    resetCommittedCanvasNodePatchMailboxForTests();
  }
});
