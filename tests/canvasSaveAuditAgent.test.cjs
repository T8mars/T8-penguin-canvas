'use strict';
// Independent review: execute production functions/handlers, never a copied
// implementation. No UI, service, database, Provider, or external I/O.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/components/Canvas.tsx');
const source = fs.readFileSync(filename, 'utf8');
const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function compile(code, values = {}) {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(values), js)(...Object.values(values));
}
function load(relative) {
  const exports = {};
  compile(fs.readFileSync(path.join(root, relative), 'utf8'), { exports });
  return exports;
}
const merge = load('src/utils/canvasPatchMerge.ts');
const authority = load('src/utils/canvasLoadAuthority.ts');
const recovery = load('src/utils/canvasSaveRecovery.ts');
const close = load('src/utils/canvasCloseSave.ts');
function callback(name, values) {
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) {
      assert.ok(ts.isCallExpression(node.initializer));
      expression = node.initializer.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, name);
  return compile(`return (${expression});`, values);
}
function effect(containing, values) {
  let expression;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0]?.getText(tree).includes(containing)) expression = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, containing);
  return compile(`return (${expression});`, values);
}
const sharedNames = ['pendingCanvasSaveFromState', 'canvasPatchStateFromCanonicalParts', 'persistableCanvasPatchStateFromParts',
  'parsePersistableCanvasPatchSnapshot', 'mergeConcurrentCanvasPatchState', 'requireVersionedCanvasPatchDocument'];
const declarations = tree.statements.filter(node => ts.isFunctionDeclaration(node) && sharedNames.includes(node.name?.text)).map(node => node.getText(tree)).join('\n');
const shared = compile(`${declarations}\nreturn { ${sharedNames.join(',')} };`, {
  ...merge, BULK_PHANTOM_ID: '__bulk_phantom__', createDefaultCreativeDeskState: () => ({}),
  createFarmState: () => ({}), sanitizeFarmCanvasState: value => value || {},
});
const state = prompt => shared.canvasPatchStateFromCanonicalParts([{ id: 'n1', entityUid: '11111111-1111-4111-8111-111111111111', data: { prompt } }], [], {}, {}, 2);
const envelope = (value = state('local'), baseline = state('base'), conflicted = true) => shared.pendingCanvasSaveFromState(value, {
  baseSnapshot: baseline.snapshot, baseRevision: 1, conflicted,
  conflicts: conflicted ? [{ kind: 'same-field', path: 'revision' }] : [],
});
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

function autosaveFixture() {
  const timers = new Map(); let nextTimer = 0, putCalls = 0, retiredTicks = 0, liveTicks = 0;
  const put = deferred(), started = deferred(), catalog = { activeId: 'A', canvases: [{ id: 'A' }] };
  const runtime = Object.fromEntries(['saveTimersByCanvas', 'pendingSaveFlushersByCanvas', 'pendingSaveByCanvas', 'latestPersistableByCanvas',
    'autosaveGenerationByCanvas', 'lastSavedByCanvas', 'lastSavedNodeCountByCanvas', 'canvasRevisions', 'canvasMutationQueues', 'recoveryAttempts', 'recoveryFlights'].map(key => [key, new Map()]));
  runtime.retiredCanvasIds = new Set(); runtime.notifyPersistence = null;
  runtime.skipInitialAutosaveCanvasIds = new Set(); runtime.skipInitialHistoryCanvasIds = new Set(); runtime.allowEmptySaveCanvasIds = new Set();
  runtime.canvasRevisions.set('A', 1); runtime.lastSavedByCanvas.set('A', state('base').snapshot); runtime.lastSavedNodeCountByCanvas.set('A', 1);
  const context = { ...merge, ...authority, ...shared, persistenceRuntime: runtime,
    archiveReadOnly: false, activeId: 'A', loaded: true, loadedCanvasId: 'A',
    nodes: state('local-1').nodes, edges: [], creativeDesk: {}, farmCanvas: {},
    nodesRef: { current: state('local-1').nodes }, edgesRef: { current: [] }, creativeDeskRef: { current: {} }, farmCanvasRef: { current: {} },
    nextNodeSerialIdRef: { current: 2 }, loadedRef: { current: true }, loadedCanvasIdRef: { current: 'A' },
    isDraggingRef: { current: false }, skipInitialAutosaveCanvasIdsRef: { current: runtime.skipInitialAutosaveCanvasIds },
    allowEmptySaveCanvasIdsRef: { current: runtime.allowEmptySaveCanvasIds },
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setDragSaveTick: () => { retiredTicks++; }, setActiveCanvasRevision() {}, setCanvasPatchConflictMessage() {},
    canvasSaveRecoveryAttemptsRef: { current: runtime.recoveryAttempts }, recoverCanvasSaveRef: { current: null },
    window: { setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) },
    useCanvasStore: { getState: () => catalog, setState: update => Object.assign(catalog, update(catalog)) },
    logBus: { warn() {}, info() {} }, console: { warn() {}, error() {} },
    api: { saveCanvasData: async () => { putCalls++; started.resolve(); return put.promise; }, autoSaveCanvasData: async () => ({}), ApiRequestError: class extends Error {} },
  };
  for (const name of ['saveTimersByCanvas', 'pendingSaveFlushersByCanvas', 'pendingSaveByCanvas', 'latestPersistableByCanvas',
    'autosaveGenerationByCanvas', 'lastSavedByCanvas', 'lastSavedNodeCountByCanvas', 'canvasRevisions', 'canvasMutationQueues']) context[`${name}Ref`] = { current: runtime[name] };
  context.setCanvasRevision = callback('setCanvasRevision', { canvasRevisionsRef: context.canvasRevisionsRef,
    useCanvasStore: context.useCanvasStore, setActiveCanvasRevision() {} });
  context.enqueueCanvasMutation = callback('enqueueCanvasMutation', context);
  effect('persistenceRuntime.notifyPersistence = notify', context)();
  const run = () => effect('const flushPendingAutosave =', context)();
  return { context, runtime, timers, put, started, run, catalog,
    get putCalls() { return putCalls; }, get retiredTicks() { return retiredTicks; }, get liveTicks() { return liveTicks; },
    successor() {
      context.loadedRef.current = false; context.loadedCanvasIdRef.current = null;
      const successorContext = { ...context, nodes: state('local-2').nodes,
        nodesRef: { current: state('local-2').nodes }, loadedRef: { current: true }, loadedCanvasIdRef: { current: 'A' },
        setDragSaveTick: () => { liveTicks++; } };
      effect('persistenceRuntime.notifyPersistence = notify', successorContext)();
      effect('const flushPendingAutosave =', successorContext)();
      return successorContext;
    },
  };
}

test('audit 01: ordinary active delayed PUT retains later draft and schedules normal compensation', async () => {
  const f = autosaveFixture(); f.run(); f.runtime.pendingSaveFlushersByCanvas.get('A')(); await f.started.promise;
  const latest = state('local-2'); f.context.nodesRef.current = latest.nodes;
  f.runtime.latestPersistableByCanvas.set('A', latest);
  f.runtime.pendingSaveByCanvas.set('A', envelope(latest, state('base'), false));
  f.put.resolve({ revision: 2, updatedAt: 2 }); await tick(); await tick();
  assert.equal(f.runtime.pendingSaveByCanvas.get('A').nodes[0].data.prompt, 'local-2');
  assert.equal(f.retiredTicks, 1); assert.equal(f.putCalls, 1);
});

test('audit 02 regression: delayed successful PUT must wake a replacement active editor for its newer draft', async () => {
  const f = autosaveFixture(); f.run(); f.runtime.pendingSaveFlushersByCanvas.get('A')(); await f.started.promise;
  f.successor();
  assert.equal(f.runtime.pendingSaveFlushersByCanvas.has('A'), true, 'new editor scheduled its newer draft');
  f.put.resolve({ revision: 2, updatedAt: 2 }); await tick(); await tick();
  assert.equal(f.runtime.pendingSaveByCanvas.get('A').nodes[0].data.prompt, 'local-2');
  assert.ok(f.runtime.pendingSaveFlushersByCanvas.has('A') || f.liveTicks > 0,
    'retired response removed successor flusher without notifying the current editor; pending draft has no future save');
});

test('audit 03: recovery budget is per canvas, manual retry does not grant an unbounded loop', async () => {
  const attempts = new Map(), p = envelope(); let calls = 0;
  const options = { canvasId: 'A', attempts, cancelled: () => false, readPending: () => p,
    load: async () => { calls++; return {}; }, commit: () => ({ conflicts: [] }) };
  assert.equal(await recovery.recoverCanvasRevisionConflict(options), 'reconciled');
  assert.equal(await recovery.recoverCanvasRevisionConflict(options), 'reconciled');
  assert.equal(await recovery.recoverCanvasRevisionConflict(options), 'limited');
  assert.equal(await recovery.recoverCanvasRevisionConflict({ ...options, canvasId: 'B' }), 'reconciled');
  assert.equal(await recovery.recoverCanvasRevisionConflict({ ...options, manual: true }), 'reconciled');
  assert.equal(calls, 4); assert.equal(attempts.get('A'), 1); assert.equal(attempts.get('B'), 1);
});

test('audit 04: malformed baseline and revision fail before authority read', async () => {
  for (const invalid of [{ baseSnapshot: '{' }, { baseSnapshot: '{}' }, { baseRevision: 0 }, { baseRevision: 1.5 }]) {
    let reads = 0, commits = 0;
    await assert.rejects(recovery.recoverCanvasRevisionConflict({ canvasId: 'A', attempts: new Map(), cancelled: () => false,
      readPending: () => ({ ...envelope(), ...invalid }), load: async () => { reads++; }, commit: () => { commits++; return { conflicts: [] }; } }));
    assert.equal(reads, 0); assert.equal(commits, 0);
  }
});

test('audit 05: authority read failure never clears pending or commits', async () => {
  const p = envelope(); let commits = 0;
  await assert.rejects(recovery.recoverCanvasRevisionConflict({ canvasId: 'A', attempts: new Map(), cancelled: () => false,
    readPending: () => p, load: async () => { throw new Error('controlled offline'); }, commit: () => { commits++; return { conflicts: [] }; } }), /controlled offline/);
  assert.equal(commits, 0); assert.equal(p.conflicted, true);
});

test('audit 06: teardown cancellation and a superseding baseline suppress late recovery commit', async () => {
  for (const outcome of ['cancel', 'new-revision', 'new-baseline', 'resolved']) {
    let p = envelope(), cancelled = false, commits = 0;
    const result = await recovery.recoverCanvasRevisionConflict({ canvasId: 'A', attempts: new Map(), cancelled: () => cancelled,
      readPending: () => p, load: async () => {
        if (outcome === 'cancel') cancelled = true;
        if (outcome === 'new-revision') p = { ...p, baseRevision: 2 };
        if (outcome === 'new-baseline') p = { ...p, baseSnapshot: state('next').snapshot };
        if (outcome === 'resolved') p = null;
      }, commit: () => { commits++; return { conflicts: [] }; } });
    assert.equal(result, 'superseded'); assert.equal(commits, 0);
  }
});

test('audit 07: only revision conflicts auto-recover, not same-field/delete conflicts', async () => {
  for (const conflicts of [[], [{ kind: 'same-field', path: 'nodes[n1].data.prompt' }],
    [{ kind: 'same-field', path: 'revision' }, { kind: 'edit-delete', path: 'nodes[n1]' }]]) {
    let loads = 0;
    assert.equal(await recovery.recoverCanvasRevisionConflict({ canvasId: 'A', attempts: new Map(), cancelled: () => false,
      readPending: () => ({ ...envelope(), conflicts }), load: async () => { loads++; }, commit: () => ({ conflicts: [] }) }), 'blocked');
    assert.equal(loads, 0);
  }
});

test('audit 08: distinct remote and local fields merge, same-field collision preserves local and blocks', () => {
  const base = { a: 'base', b: 'base' };
  assert.deepEqual(merge.mergeCanvasPatchValueWithConflicts(base, { ...base, a: 'local' }, { ...base, b: 'remote' }),
    { value: { a: 'local', b: 'remote' }, conflicts: [] });
  const result = merge.mergeCanvasPatchValueWithConflicts(base, { ...base, a: 'local' }, { ...base, a: 'remote' });
  assert.equal(result.value.a, 'local'); assert.deepEqual(result.conflicts, [{ kind: 'same-field', path: '$.a' }]);
});

test('audit 09: node and edge identity replacement cannot absorb old local fields', () => {
  for (const kind of ['nodes', 'edges']) {
    const base = { id: 'same', entityUid: 'original', data: { value: 'base' } };
    const local = { ...base, data: { value: 'local' } }, remote = { ...base, entityUid: 'replacement', data: { result: 'remote' } };
    const result = merge.mergeCanvasPatchEntitiesWithConflicts([base], [local], [remote], kind);
    assert.deepEqual(result.value, [local]); assert.deepEqual(result.conflicts, [{ kind: 'same-field', path: `${kind}["same"].entityUid` }]);
  }
});

test('audit 10: both edit-delete directions are explicit; graph repair never emits a dangling edge', () => {
  const base = state('base').nodes[0], local = state('local').nodes[0];
  assert.equal(merge.mergeCanvasPatchValueWithConflicts(base, local, undefined).conflicts[0].kind, 'edit-delete');
  assert.equal(merge.mergeCanvasPatchValueWithConflicts(base, undefined, local).conflicts[0].kind, 'delete-edit');
  const result = merge.mergeCanvasPatchGraph({ baseNodes: [base, { id: 'n2' }], localNodes: [base, { id: 'n2' }],
    authoritativeNodes: [{ id: 'n2' }], baseEdges: [], localEdges: [{ id: 'e1', source: 'n1', target: 'n2' }], authoritativeEdges: [] });
  assert.ok(result.conflicts.some(c => c.kind === 'edge-delete-node'));
  assert.ok(result.edges.every(e => result.nodes.some(n => n.id === e.source) && result.nodes.some(n => n.id === e.target)));
});

test('audit 11: pending activation preserves collision provenance and never labels local draft durable', () => {
  const p = envelope();
  const result = merge.activateCanvasPatchPending({ authoritativeSnapshot: state('remote').snapshot, authoritativeRevision: 2, pending: p });
  assert.equal(result.lastSavedSnapshot, state('remote').snapshot); assert.equal(result.pending, p);
  assert.equal(result.blocked, true); assert.equal(result.shouldScheduleCas, false);
});

test('audit 12: authority validation rejects wrong identity, malformed revision, and invalid viewport', () => {
  const document = { schema: 't8-canvas-document', schemaVersion: 2, canvasId: 'A', projectId: 'project', revision: 2,
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 100 };
  assert.equal(shared.requireVersionedCanvasPatchDocument(document, 'A'), document);
  for (const invalid of [{ canvasId: 'B' }, { projectId: '' }, { revision: 0 }, { revision: 1.5 }, { revision: NaN },
    { nodes: null }, { edges: {} }, { viewport: { x: Infinity, y: 0, zoom: 1 } }, { updatedAt: NaN }]) {
    assert.throws(() => shared.requireVersionedCanvasPatchDocument({ ...document, ...invalid }, 'A'));
  }
});

test('audit 13: authority GET compares against the current known revision after awaiting response', async () => {
  const gate = deferred(), known = new Map([['A', 1]]);
  const read = callback('fetchAuthoritativeCanvasPatchDocument', { api: { getCanvasData: () => gate.promise },
    requireVersionedCanvasPatchDocument: shared.requireVersionedCanvasPatchDocument, canvasRevisionsRef: { current: known }, persistenceRuntime: { retiredCanvasIds: new Set() } });
  const result = read('A'); known.set('A', 3);
  gate.resolve({ schema: 't8-canvas-document', schemaVersion: 2, canvasId: 'A', projectId: 'project', revision: 2,
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 100 });
  await assert.rejects(result, /倒退/);
});

test('audit 14: mutation queue is serial per canvas, independent across canvases, and recovers after rejection', async () => {
  const queues = new Map(), enqueue = callback('enqueueCanvasMutation', { canvasMutationQueuesRef: { current: queues } });
  const gate = deferred(), order = [];
  const first = enqueue('A', async () => { order.push('A1'); await gate.promise; throw new Error('controlled rejection'); });
  const firstObserved = assert.rejects(first, /controlled rejection/);
  const second = enqueue('A', async () => { order.push('A2'); });
  await enqueue('B', async () => { order.push('B1'); });
  assert.deepEqual(order, ['A1', 'B1']); gate.resolve(); await firstObserved; await second; await tick();
  assert.deepEqual(order, ['A1', 'B1', 'A2']); assert.equal(queues.size, 0);
});

test('audit 15: close requires two observed clean turns and never equates drained queue with saved', async () => {
  let time = 0, reads = 0, flushes = 0;
  const dirty = await close.waitForCanvasCloseSave({ now: () => time, turn: async () => { time += 50; }, timeoutMs: 300,
    read: () => { reads++; return { dirty: true, queued: false }; }, cancelled: () => false, flush: () => { flushes++; } });
  assert.deepEqual(dirty, { ok: false, reason: 'save' }); assert.equal(flushes, 1);
  reads = 0; time = 0;
  const clean = await close.waitForCanvasCloseSave({ now: () => time, turn: async () => { time += 50; },
    read: () => { reads++; return { dirty: false, queued: false }; }, cancelled: () => false, flush() { assert.fail(); } });
  assert.equal(clean.ok, true); assert.equal(reads, 2);
});

test('audit 16: close respects running/conflict/cancel without retrying or losing pending', async () => {
  for (const blocked of ['running', 'conflict']) {
    let time = 0;
    const result = await close.waitForCanvasCloseSave({ now: () => time, turn: async () => { time += 50; },
      read: () => ({ dirty: true, queued: false, blocked }), cancelled: () => false, flush() { assert.fail(); } });
    assert.deepEqual(result, { ok: false, reason: blocked });
  }
  assert.deepEqual(await close.waitForCanvasCloseSave({ read() { assert.fail(); }, turn: async () => {},
    flush() { assert.fail(); }, cancelled: () => true }), { ok: false, reason: 'save' });
});

test('audit 17 regression: explicitly keeping a new local entity must not attach another entity output sharing its display ID', async () => {
  const baseline = shared.canvasPatchStateFromCanonicalParts([], [], {}, {}, 1);
  const local = shared.canvasPatchStateFromCanonicalParts([{ id: 'n1', entityUid: '22222222-2222-4222-8222-222222222222', type: 'image',
    data: { prompt: 'my private local draft' } }], [], {}, {}, 2);
  const remote = { schema: 't8-canvas-document', schemaVersion: 2, canvasId: 'A', projectId: 'project', revision: 2,
    nodes: [{ id: 'n1', entityUid: '33333333-3333-4333-8333-333333333333', type: 'image', data: { output: 'another entity output' } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 100 };
  let savedPayload;
  const resolve = callback('handleResolveCanvasPatchConflict', {
    ...shared, activeId: 'A', enqueueCanvasMutation: (_id, work) => work(),
    pendingSaveByCanvasRef: { current: new Map([['A', envelope(local, baseline)]]) },
    useCanvasStore: { getState: () => ({ activeId: 'A' }) }, loadedRef: { current: true }, loadedCanvasIdRef: { current: 'A' },
    currentPersistableCanvas: () => local, fetchAuthoritativeCanvasPatchDocument: async () => remote,
    migrateCreativeDeskToViewportCoordinates: value => value, sanitizeFarmCanvasState: value => value,
    lastSavedNodeCountByCanvasRef: { current: new Map([['A', 0]]) }, allowEmptySaveCanvasIdsRef: { current: new Set() },
    getViewport: () => remote.viewport, setCanvasRevision() {}, commitAuthoritativeCanvasPatchDocument() {}, setCanvasPatchConflictMessage() {},
    persistenceRuntime: { disposed: false, recoveryCommit() {} },
    api: { saveCanvasData: async (_id, payload) => { savedPayload = payload; return { revision: 3 }; } },
    logBus: { success() {} },
  });
  await resolve('keep-local');
  assert.deepEqual(savedPayload.nodes, local.nodes,
    'local-wins confirmation must preserve entity ownership instead of storing a remote output under the local entityUid');
});

test('audit 18 regression: successfully deleting a conflicted canvas must retire its runtime draft before close routing', async () => {
  const storeFilename = path.join(root, 'src/stores/canvas.ts');
  const storeTree = ts.createSourceFile(storeFilename, fs.readFileSync(storeFilename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let declaration;
  const find = node => { if (ts.isMethodDeclaration(node) && node.name.getText(storeTree) === 'deleteCanvas') declaration = node.getText(storeTree); ts.forEachChild(node, find); };
  find(storeTree); assert.ok(declaration);
  const catalog = { activeId: 'A', canvases: [{ id: 'A' }, { id: 'B' }], total: 2, completionNoticeCanvasIds: [] };
  const lifecycle = load('src/utils/canvasDeletionLifecycle.ts');
  const runtime = { pendingSaveByCanvas: new Map([['A', envelope()]]), recoveryFlights: new Map(), recoveryAttempts: new Map(),
    canvasMutationQueues: new Map(), saveTimersByCanvas: new Map(), pendingSaveFlushersByCanvas: new Map(),
    latestPersistableByCanvas: new Map(), autosaveGenerationByCanvas: new Map(), lastSavedByCanvas: new Map(),
    lastSavedNodeCountByCanvas: new Map(), canvasRevisions: new Map(), retiredCanvasIds: new Set(),
    skipInitialAutosaveCanvasIds: new Set(), skipInitialHistoryCanvasIds: new Set(), allowEmptySaveCanvasIds: new Set() };
  const disposeDeletion = effect('subscribeCanvasDeletion((canvasId)', { persistenceRuntime: runtime, ...lifecycle, window: { clearTimeout() {} } })();
  const deleted = compile(`return ({ ${declaration} }).deleteCanvas;`, {
    ...lifecycle, catalogDeletedAt: new Map(), catalogDeletionGeneration: 0, api: { deleteCanvas: async () => undefined },
    set: update => Object.assign(catalog, typeof update === 'function' ? update(catalog) : update), persistActiveId() {},
  });
  await deleted('A'); assert.equal(catalog.activeId, 'B');
  catalog.setActive = id => { catalog.activeId = id; };
  const context = { persistenceRuntime: runtime, flushCanvasViewportStorage() {},
    useCanvasStore: { getState: () => catalog }, useRunBusStore: { getState: () => ({ executionTokens: {} }) },
    activeCanvasRunsRef: { current: new Set() }, loadedRef: { current: true }, loadedCanvasIdRef: { current: 'B' },
    nodesRef: { current: [] }, edgesRef: { current: [] }, creativeDeskRef: { current: {} }, farmCanvasRef: { current: {} }, nextNodeSerialIdRef: { current: 1 },
    lastSavedByCanvasRef: { current: new Map() }, ...shared, setDragSaveTick() {},
  };
  for (const key of Object.keys(runtime)) if (runtime[key] instanceof Map) context[`${key}Ref`] = { current: runtime[key] };
  context.canvasSaveRecoveryFlightsRef = { current: runtime.recoveryFlights };
  effect('const observer: CanvasCloseObserver', context)();
  const observed = runtime.closeObserver.read();
  assert.equal(catalog.activeId, 'B', `close reactivated a deleted canvas and returned ${JSON.stringify(observed)}`);
  disposeDeletion();
});

test('audit 19: archive guard refuses an actual run/conflict and always releases its input hold', async () => {
  for (const mode of ['running', 'conflict']) {
    let guard;
    const rootElement = { inert: false }, pending = new Map(mode === 'conflict' ? [['A', envelope()]] : []);
    effect('registerCanvasArchiveGuard', {
      registerCanvasArchiveGuard: value => { guard = value; return () => {}; },
      document: { getElementById: () => rootElement, activeElement: { blur() {} } }, flushCanvasViewportStorage() {},
      waitForCanvasCloseSave: close.waitForCanvasCloseSave,
      useCanvasStore: { getState: () => ({ activeId: 'A' }) },
      useRunBusStore: { getState: () => ({ executionTokens: {} }) },
      activeCanvasRunsRef: { current: new Set(mode === 'running' ? [{ canvasId: 'A' }] : []) },
      pendingSaveByCanvasRef: { current: pending },
    })();
    await assert.rejects(guard('A'), new RegExp(`canvas_archive_${mode}`));
    assert.equal(rootElement.inert, false); assert.equal(pending.size, mode === 'conflict' ? 1 : 0);
  }
});

test('audit 20: patch baseline keeps a newer same-editor edit pending and refuses stale preview', async () => {
  const gate = deferred(); let current = { ...state('first'), payload: { nodes: state('first').nodes, edges: [] } }, mirrorCalls = 0;
  const pending = new Map(), epoch = { current: 1 }, revisions = new Map([['A', 1]]);
  const ensure = callback('ensureCanvasPatchBaseline', {
    ...shared, currentPersistableCanvas: () => current, useCanvasStore: { getState: () => ({ activeId: 'A' }), setState() {} },
    loaded: true, loadedCanvasId: 'A', pendingSaveByCanvasRef: { current: pending },
    saveTimersByCanvasRef: { current: new Map() }, pendingSaveFlushersByCanvasRef: { current: new Map() },
    graphMutationEpochRef: epoch, lastSavedNodeCountByCanvasRef: { current: new Map([['A', 1]]) },
    lastSavedByCanvasRef: { current: new Map([['A', state('base').snapshot]]) }, allowEmptySaveCanvasIdsRef: { current: new Set() },
    canvasRevisionsRef: { current: revisions }, setCanvasRevision: (_id, rev) => revisions.set('A', rev), setDragSaveTick() {},
    window: { clearTimeout() {} }, api: { saveCanvasData: () => gate.promise, autoSaveCanvasData: async () => { mirrorCalls++; }, ApiRequestError: class extends Error {} },
    console: { warn() {} },
  });
  const result = ensure('A');
  current = { ...state('later'), payload: { nodes: state('later').nodes, edges: [] } }; epoch.current++;
  pending.set('A', envelope(current, state('base'), false));
  gate.resolve({ revision: 2, updatedAt: 2 });
  await assert.rejects(result, error => error.code === 'PATCH_PREVIEW_STALE');
  assert.equal(pending.get('A').nodes[0].data.prompt, 'later'); assert.equal(pending.get('A').baseRevision, 2); assert.equal(mirrorCalls, 1);
});

test('audit 02 additional race: superseded 409 must wake a replacement editor just like a successful old PUT', async () => {
  const f = autosaveFixture(); f.run(); f.runtime.pendingSaveFlushersByCanvas.get('A')(); await f.started.promise;
  f.successor();
  const rebased = { ...envelope(state('local-2'), state('remote-rebase'), false), baseRevision: 2 };
  f.runtime.canvasRevisions.set('A', 2); f.runtime.pendingSaveByCanvas.set('A', rebased);
  const error = new f.context.api.ApiRequestError('controlled retired PUT'); error.status = 409; error.data = { code: 'revision_conflict' };
  f.put.reject(error); await tick(); await tick();
  assert.equal(f.runtime.pendingSaveByCanvas.get('A').conflicted, false, 'legitimate newer authority must not be poisoned');
  assert.equal(f.runtime.pendingSaveByCanvas.get('A').nodes[0].data.prompt, 'local-2');
  assert.ok(f.runtime.pendingSaveFlushersByCanvas.has('A') || f.liveTicks > 0,
    'superseded 409 removed successor flusher without notifying the live editor');
});

test('audit 18 additional race: late PUT success and 409 cannot recreate explicitly retired runtime work', async () => {
  for (const result of ['success', '409']) {
    const f = autosaveFixture(), lifecycle = load('src/utils/canvasDeletionLifecycle.ts');
    const dispose = effect('subscribeCanvasDeletion((canvasId)', {
      persistenceRuntime: f.runtime, ...lifecycle, window: f.context.window,
    })();
    f.run(); f.runtime.pendingSaveFlushersByCanvas.get('A')(); await f.started.promise;
    lifecycle.notifyCanvasDeleted('A');
    if (result === 'success') f.put.resolve({ revision: 2, updatedAt: 2 });
    else { const error = new f.context.api.ApiRequestError('deleted'); error.status = 409; error.data = { code: 'revision_conflict' }; f.put.reject(error); }
    await tick(); await tick();
    assert.equal(f.runtime.retiredCanvasIds.has('A'), true);
    assert.equal(f.runtime.pendingSaveByCanvas.has('A'), false); assert.equal(f.runtime.canvasRevisions.has('A'), false);
    assert.equal(f.runtime.latestPersistableByCanvas.has('A'), false); assert.equal(f.runtime.saveTimersByCanvas.has('A'), false);
    assert.equal(f.runtime.pendingSaveFlushersByCanvas.has('A'), false); assert.equal(f.retiredTicks, 0);
    assert.equal(f.putCalls, 1); dispose();
  }
});

test('audit 18 negative case: failed delete never authorizes draft retirement', async () => {
  const storeFilename = path.join(root, 'src/stores/canvas.ts');
  const storeTree = ts.createSourceFile(storeFilename, fs.readFileSync(storeFilename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let declaration;
  const find = node => { if (ts.isMethodDeclaration(node) && node.name.getText(storeTree) === 'deleteCanvas') declaration = node.getText(storeTree); ts.forEachChild(node, find); };
  find(storeTree);
  const lifecycle = load('src/utils/canvasDeletionLifecycle.ts'), p = envelope(); let notifications = 0;
  const dispose = lifecycle.subscribeCanvasDeletion(() => { notifications++; });
  const catalog = { activeId: 'A', canvases: [{ id: 'A' }], error: null };
  const deleted = compile(`return ({ ${declaration} }).deleteCanvas;`, {
    ...lifecycle, catalogDeletedAt: new Map(), catalogDeletionGeneration: 0, api: { deleteCanvas: async () => { throw new Error('controlled delete failure'); } },
    set: update => Object.assign(catalog, typeof update === 'function' ? update(catalog) : update), persistActiveId() {},
  });
  await deleted('A');
  assert.equal(notifications, 0); assert.equal(catalog.activeId, 'A'); assert.deepEqual(catalog.canvases, [{ id: 'A' }]);
  assert.equal(p.conflicted, true); assert.equal(catalog.error, 'controlled delete failure'); dispose();
});
