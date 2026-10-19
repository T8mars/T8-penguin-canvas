'use strict';
// Second independent audit: execute extracted production handlers/functions.
// No services, UI, Provider traffic, existing database, or copied algorithms.
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
function load(relative) { const exports = {}; compile(fs.readFileSync(path.join(root, relative), 'utf8'), { exports }); return exports; }
function callback(name, values) {
  let expression;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) expression = node.initializer.arguments[0].getText(tree); ts.forEachChild(node, visit); };
  visit(tree); assert.ok(expression, name); return compile(`return (${expression});`, values);
}
function effect(containing, values) {
  let expression; const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
    && node.arguments[0]?.getText(tree).includes(containing)) expression = node.arguments[0].getText(tree); ts.forEachChild(node, visit); };
  visit(tree); assert.ok(expression, containing); return compile(`return (${expression});`, values);
}
const sharedNames = ['pendingCanvasSaveFromState', 'canvasPatchStateFromCanonicalParts', 'persistableCanvasPatchStateFromParts',
  'parsePersistableCanvasPatchSnapshot', 'mergeConcurrentCanvasPatchState', 'requireVersionedCanvasPatchDocument'];
const shared = compile(`${tree.statements.filter(node => ts.isFunctionDeclaration(node) && sharedNames.includes(node.name?.text)).map(node => node.getText(tree)).join('\n')}\nreturn { ${sharedNames.join(',')} };`, {
  ...load('src/utils/canvasPatchMerge.ts'), BULK_PHANTOM_ID: '__bulk_phantom__', createDefaultCreativeDeskState: () => ({}),
  createFarmState: () => ({}), sanitizeFarmCanvasState: value => value || {},
});
const loadAuthority = load('src/utils/canvasLoadAuthority.ts');
const state = prompt => shared.canvasPatchStateFromCanonicalParts([{ id: 'n1', entityUid: '11111111-1111-4111-8111-111111111111', data: { prompt } }], [], {}, {}, 2);
const document = (prompt, revision = 2) => ({ schema: 't8-canvas-document', schemaVersion: 2, canvasId: 'A', projectId: 'project', revision,
  nodes: state(prompt).nodes, edges: [], creativeDesk: {}, farmCanvas: {}, nextNodeSerialId: 2, viewport: { x: 10, y: 20, zoom: 2 }, updatedAt: 100 + revision });
const envelope = (value, baseline = state('base')) => shared.pendingCanvasSaveFromState(value, { baseSnapshot: baseline.snapshot, baseRevision: 1, conflicted: false });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const patch = { id: 'p1', baseRevision: 1, summary: 'owned test patch', operations: [] };
const preview = { patchId: 'p1', baseRevision: 1, currentRevision: 1, previewDigest: 'a'.repeat(64) };
class ApiRequestError extends Error { constructor(message, status, data) { super(message); this.status = status; this.data = data; } }
function fixture() {
  const catalog = { activeId: 'A', canvases: [{ id: 'A' }, { id: 'B' }] };
  const runtime = { retiredCanvasIds: new Set(), disposed: false, recoveryCommit: null, notifyPersistence: null };
  let current = state('base'), presented = state('base'), viewportWrites = 0, mirrorCalls = 0, saveCalls = 0, commits = 0;
  const context = { ...load('src/utils/canvasPatchMerge.ts'), ...loadAuthority, ...shared, persistenceRuntime: runtime, activeId: 'A', activeProjectId: 'project', loaded: true, loadedCanvasId: 'A',
    loadedRef: { current: true }, loadedCanvasIdRef: { current: 'A' }, nodesRef: { current: current.nodes }, edgesRef: { current: [] },
    nextNodeSerialIdRef: { current: 2 }, graphMutationEpochRef: { current: 1 },
    useCanvasStore: { getState: () => catalog, setState: update => Object.assign(catalog, typeof update === 'function' ? update(catalog) : update) },
    currentPersistableCanvas: () => ({ ...current, payload: { nodes: current.nodes, edges: current.edges, viewport: { x: 10, y: 20, zoom: 2 } } }),
    enqueueCanvasMutation: (_id, work) => work(), setDragSaveTick() {}, setActiveCanvasRevision() {},
    setCanvasPatchConflictMessage() {}, cancelScheduledHistoryCapture() {}, histReset() {}, histCaptureTransition() {},
    setNodes: nodes => { commits++; presented = { ...presented, nodes }; }, setEdges: edges => { presented = { ...presented, edges }; },
    setCreativeDesk() {}, setFarmCanvas() {}, setViewport: () => { viewportWrites++; },
    migrateCreativeDeskToViewportCoordinates: value => value || {}, sanitizeFarmCanvasState: value => value || {}, createDefaultCreativeDeskState: () => ({}), createFarmState: () => ({}),
    logBus: { success() {}, warn() {}, info() {}, error() {} }, console: { warn() {}, error() {} }, window: { clearTimeout() {} }, t: key => key,
    api: { ApiRequestError, autoSaveCanvasData: async () => { mirrorCalls++; }, saveCanvasData: async () => { saveCalls++; return { revision: 2, updatedAt: 102 }; } },
    fetchAuthoritativeCanvasPatchDocument: async () => document('remote'),
    getViewport: () => ({ x: 10, y: 20, zoom: 2 }),
  };
  for (const key of ['pendingSaveByCanvas', 'latestPersistableByCanvas', 'autosaveGenerationByCanvas', 'lastSavedByCanvas', 'lastSavedNodeCountByCanvas', 'saveTimersByCanvas',
    'pendingSaveFlushersByCanvas', 'canvasRevisions', 'patchPreviewBaselines']) context[`${key}Ref`] = { current: new Map() };
  context.allowEmptySaveCanvasIdsRef = { current: new Set() };
  context.lastSavedByCanvasRef.current.set('A', current.snapshot); context.lastSavedNodeCountByCanvasRef.current.set('A', 1); context.canvasRevisionsRef.current.set('A', 1);
  context.patchPreviewBaselinesRef.current.set(`A\u001fp1\u001f${preview.previewDigest}`, { canvasId: 'A', revision: 1, snapshot: current.snapshot, mutationEpoch: 1 });
  context.setCanvasRevision = callback('setCanvasRevision', context);
  context.commitAuthoritativeCanvasPatchDocument = callback('commitAuthoritativeCanvasPatchDocument', context);
  context.ensureCanvasPatchBaseline = callback('ensureCanvasPatchBaseline', context);
  runtime.recoveryCommit = (id, doc, baseline, historyMode, patchId) => context.commitAuthoritativeCanvasPatchDocument(id, doc, { expectedLocalSnapshot: baseline, historyMode, patchId });
  return { context, catalog, runtime, get current() { return current; }, get presented() { return presented; }, get commits() { return commits; },
    get viewportWrites() { return viewportWrites; }, get mirrorCalls() { return mirrorCalls; }, get saveCalls() { return saveCalls; },
    edit(prompt) { current = state(prompt); context.nodesRef.current = current.nodes; context.graphMutationEpochRef.current++; },
    replaceEditor() {
      context.loadedRef.current = false; context.loadedCanvasIdRef.current = null;
      const live = { ...context, loadedRef: { current: true }, loadedCanvasIdRef: { current: 'A' } };
      const commit = callback('commitAuthoritativeCanvasPatchDocument', live);
      runtime.recoveryCommit = (id, doc, baseline, historyMode, patchId) => commit(id, doc, { expectedLocalSnapshot: baseline, historyMode, patchId });
    },
  };
}

test('second audit 01 regression: late Patch apply commits through the current replacement editor', async () => {
  const f = fixture(), gate = deferred(); f.context.api.applyCanvasPatch = () => gate.promise;
  const apply = callback('handleApplyCanvasPatch', f.context), result = apply(patch, preview); await tick();
  f.replaceEditor(); gate.resolve({ duplicate: false, document: document('patch applied') }); await result;
  assert.equal(f.presented.nodes[0].data.prompt, 'patch applied', 'late Patch result updated only retired editor shared state, not the current rendered graph');
});

test('second audit 02 regression: late Patch revert commits through the current replacement editor', async () => {
  const f = fixture(), gate = deferred(); f.context.api.revertCanvasPatch = () => gate.promise;
  const revert = callback('handleRevertCanvasPatch', f.context), result = revert('p1', 1); await tick();
  f.replaceEditor(); gate.resolve({ duplicate: false, document: document('patch reverted') }); await result;
  assert.equal(f.presented.nodes[0].data.prompt, 'patch reverted', 'late revert result did not reach current rendered graph');
});

test('second audit 03: late baseline result after explicit deletion cannot restore a draft or write a mirror', async () => {
  const f = fixture(), gate = deferred(); f.edit('unsaved baseline'); f.context.api.saveCanvasData = () => gate.promise;
  const result = f.context.ensureCanvasPatchBaseline('A');
  f.runtime.retiredCanvasIds.add('A'); f.catalog.activeId = 'B';
  for (const name of ['pendingSaveByCanvas', 'lastSavedByCanvas', 'lastSavedNodeCountByCanvas', 'canvasRevisions']) f.context[`${name}Ref`].current.delete('A');
  gate.resolve({ revision: 2, updatedAt: 102 }); await assert.rejects(result);
  assert.equal(f.context.pendingSaveByCanvasRef.current.has('A'), false); assert.equal(f.catalog.activeId, 'B');
  // Some book-keeping maps can be recreated by the old acknowledgement. This
  // alone is not data resurrection: execute the actual server auto-save handler.
  const routeFile = path.join(root, 'backend/src/routes/canvas.js');
  const routeTree = ts.createSourceFile(routeFile, fs.readFileSync(routeFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let expression; const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(routeTree) === 'router.post'
    && node.arguments[0]?.text === '/:id/auto-save') expression = node.arguments[1].getText(routeTree); ts.forEachChild(node, visit); };
  visit(routeTree); assert.ok(expression); let writes = 0, response;
  const ensure = routeTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ensurePatchCanvas').getText(routeTree);
  const run = compile(`${ensure}\nreturn (${expression});`, {
    fs: { existsSync: () => false }, getCanvasFile: () => 'virtual-owned-deleted.json', projectDatabase: () => ({ getCanvas: () => null }),
    getCanvasAutoSaveDir: () => 'virtual-owned-output', atomicWriteJson: () => { writes++; }, sendCanvasPatchError: () => assert.fail('unexpected handler error'),
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { response = value; } };
  run({ params: { id: 'A' }, body: { nodes: state('late baseline').nodes, edges: [], revision: 2 } }, res);
  assert.equal(res.statusCode, 404); assert.equal(response.code, 'canvas_auto_save_not_found'); assert.equal(writes, 0);
});

test('second audit 04 regression: older direct Patch documents cannot lower an already observed revision', () => {
  const f = fixture(); f.context.canvasRevisionsRef.current.set('A', 3); f.context.lastSavedByCanvasRef.current.set('A', state('newer result').snapshot);
  assert.throws(() => f.context.commitAuthoritativeCanvasPatchDocument('A', document('older patch result', 2), { expectedLocalSnapshot: state('base').snapshot }),
    error => error instanceof loadAuthority.StaleCanvasLoadError, 'rejection must be the production monotonicity guard, not a missing test dependency');
  assert.equal(f.context.canvasRevisionsRef.current.get('A'), 3, 'direct result bypassed fetch monotonicity guard');
  assert.notEqual(f.presented.nodes[0].data.prompt, 'older patch result');
});

test('second audit 05: malformed baseline save acknowledgement does not mark its draft saved', async () => {
  const f = fixture(); f.edit('dirty'); f.context.api.saveCanvasData = async () => ({ revision: NaN });
  await assert.rejects(f.context.ensureCanvasPatchBaseline('A'), /revision/);
  assert.equal(f.context.lastSavedByCanvasRef.current.get('A'), state('base').snapshot);
  assert.equal(f.context.pendingSaveByCanvasRef.current.get('A').nodes[0].data.prompt, 'dirty');
  assert.equal(f.mirrorCalls, 0);
});

test('second audit 06: prepared Patch revision mismatch does not submit even a preview', async () => {
  const f = fixture(); let calls = 0;
  f.context.api.previewCanvasPatch = async () => { calls++; return preview; };
  const run = callback('handlePreviewCanvasPatch', f.context);
  await assert.rejects(run({ ...patch, schema: 't8-canvas-patch-v1', baseRevision: 999 }), e => e.code === 'CREATIVE_CANVAS_STALE');
  assert.equal(calls, 0);
});

test('second audit 07: preview response identity mismatch is rejected without caching confirmation authority', async () => {
  const f = fixture(); f.context.patchPreviewBaselinesRef.current.clear();
  f.context.api.previewCanvasPatch = async () => ({ ...preview, patchId: 'another-patch' });
  await assert.rejects(callback('handlePreviewCanvasPatch', f.context)({ ...patch, schema: 't8-canvas-patch-v1' }), /不一致/);
  assert.equal(f.context.patchPreviewBaselinesRef.current.size, 0);
});

test('second audit 08: local edits while preview request is pending invalidate its confirmation token', async () => {
  const f = fixture(), gate = deferred(); f.context.patchPreviewBaselinesRef.current.clear();
  f.context.api.previewCanvasPatch = () => gate.promise;
  const result = callback('handlePreviewCanvasPatch', f.context)({ ...patch, schema: 't8-canvas-patch-v1' }); await tick();
  f.edit('new local draft'); gate.resolve(preview);
  await assert.rejects(result, e => e.code === 'PATCH_PREVIEW_STALE');
  assert.equal(f.context.patchPreviewBaselinesRef.current.size, 0); assert.equal(f.current.nodes[0].data.prompt, 'new local draft');
});

test('second audit 09: preview digest is bound to its exact cached confirmation authority', async () => {
  const f = fixture(); let calls = 0; f.context.api.applyCanvasPatch = async () => { calls++; };
  await assert.rejects(callback('handleApplyCanvasPatch', f.context)(patch, { ...preview, previewDigest: 'b'.repeat(64) }), e => e.code === 'PATCH_PREVIEW_STALE');
  assert.equal(calls, 0);
});

test('second audit 10: editing and restoring the same snapshot still invalidates a previous preview epoch', async () => {
  const f = fixture(); let calls = 0; f.context.api.applyCanvasPatch = async () => { calls++; };
  f.edit('temporary'); f.edit('base');
  await assert.rejects(callback('handleApplyCanvasPatch', f.context)(patch, preview), e => e.code === 'PATCH_PREVIEW_STALE');
  assert.equal(calls, 0);
});

test('second audit 11: local edit during Patch apply merges alongside disjoint remote fields', async () => {
  const f = fixture(), gate = deferred(); f.context.api.applyCanvasPatch = () => gate.promise;
  const result = callback('handleApplyCanvasPatch', f.context)(patch, preview); await tick(); f.edit('new local draft');
  const remote = document('base'); remote.nodes[0].data.remoteResult = 'PATCH_OUTPUT'; gate.resolve({ duplicate: false, document: remote }); await result;
  assert.equal(f.presented.nodes[0].data.prompt, 'new local draft'); assert.equal(f.presented.nodes[0].data.remoteResult, 'PATCH_OUTPUT');
  assert.equal(f.context.pendingSaveByCanvasRef.current.get('A').conflicted, false);
  assert.equal(f.context.lastSavedByCanvasRef.current.get('A'), shared.canvasPatchStateFromCanonicalParts(remote.nodes, [], {}, {}, 2).snapshot);
});

test('second audit 12: non-revision 409 during Patch revert is not retried as a revision race', async () => {
  const f = fixture(); let calls = 0, refreshes = 0;
  f.context.api.revertCanvasPatch = async () => { calls++; throw new ApiRequestError('foreign Patch', 409, { code: 'patch_not_owner' }); };
  f.context.refreshCleanCanvasPatchBaseline = async () => { refreshes++; };
  await assert.rejects(callback('handleRevertCanvasPatch', f.context)('p1', 1), /foreign Patch/);
  assert.equal(calls, 1); assert.equal(refreshes, 0);
});

test('second audit 13: a clean revert revision race gets only one refresh and one CAS retry', async () => {
  const f = fixture(); const revisions = []; let refreshes = 0;
  f.context.api.revertCanvasPatch = async (_id, _patch, revision) => { revisions.push(revision); throw new ApiRequestError('contended', 409, { code: 'revision_conflict' }); };
  f.context.refreshCleanCanvasPatchBaseline = async () => { refreshes++; return { state: state('base'), document: document('base', 2), mutationEpoch: 1 }; };
  await assert.rejects(callback('handleRevertCanvasPatch', f.context)('p1', 1), /contended/);
  assert.deepEqual(revisions, [1, 2]); assert.equal(refreshes, 1);
});

test('second audit 14: clean baseline refresh refuses edits made while authority GET is pending', async () => {
  const f = fixture(), gate = deferred(); f.context.fetchAuthoritativeCanvasPatchDocument = () => gate.promise;
  const result = callback('refreshCleanCanvasPatchBaseline', f.context)('A', state('base').snapshot, 1);
  f.edit('after GET start'); gate.resolve(document('remote')); await assert.rejects(result, e => e.code === 'PATCH_PREVIEW_STALE');
  assert.equal(f.commits, 0); assert.equal(f.current.nodes[0].data.prompt, 'after GET start');
});

test('second audit 15: applying authority graph never rolls back the current editor camera', () => {
  const f = fixture(); f.context.commitAuthoritativeCanvasPatchDocument('A', document('remote'), { expectedLocalSnapshot: state('base').snapshot });
  assert.equal(f.viewportWrites, 0); assert.equal(f.presented.nodes[0].data.prompt, 'remote');
});

test('second audit 16: persistence excludes transient runtime nodes and every edge attached to them', () => {
  const nodes = [...state('base').nodes, { id: '__bulk_phantom__', data: {} }, { id: 'runtime', data: { __subflowRuntime: true } }];
  const edges = [{ id: 'valid', source: 'n1', target: 'n1' }, { id: 'bulk', source: '__bulk_phantom__', target: 'n1' },
    { id: 'runtime', source: 'n1', target: 'runtime' }, { id: 'marked', source: 'n1', target: 'n1', data: { __subflowRuntime: true } }];
  const result = shared.persistableCanvasPatchStateFromParts(nodes, edges, {}, {}, 2);
  assert.deepEqual(result.nodes.map(n => n.id), ['n1']); assert.deepEqual(result.edges.map(e => e.id), ['valid']);
});

test('second audit 17: merge retains the larger serial counter even when authority has fewer allocated nodes', () => {
  const base = state('base'), local = { ...state('local'), nextNodeSerialId: 23 }, remote = { ...state('base'), nextNodeSerialId: 19 };
  const result = shared.mergeConcurrentCanvasPatchState(base.snapshot, local, remote);
  assert.equal(result.state.nextNodeSerialId, 23); assert.equal(result.state.nodes[0].data.prompt, 'local');
});

const storeFilename = path.join(root, 'src/stores/canvas.ts');
function storeMethod(name, values) {
  const method = values.productionStore.getState()[name]; assert.equal(typeof method, 'function', name); return method;
}
function catalogFixture() {
  const exports = {}, api = {}; let catalog;
  compile(fs.readFileSync(storeFilename, 'utf8'), { exports, require: name => {
    if (name === 'zustand') return { create: factory => {
      const set = update => Object.assign(catalog, typeof update === 'function' ? update(catalog) : update);
      catalog = factory(set, () => catalog);
      return Object.assign(() => catalog, { getState: () => catalog, setState: set });
    } };
    if (name === '../services/api') return api;
    if (name === '../utils/canvasDeletionLifecycle') return { notifyCanvasDeleted() {} };
    assert.fail(`unexpected store runtime dependency ${name}`);
  } });
  Object.assign(catalog, { activeId: 'A', canvases: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], total: 2, completionNoticeCanvasIds: [] });
  const values = { api, productionStore: exports.useCanvasStore };
  return { catalog, values };
}

test('second audit 18: advisory metadata read failure preserves existing catalog and active canvas', async () => {
  const f = catalogFixture(); f.values.api.getCanvasMetadata = async () => { throw new Error('controlled offline'); };
  assert.equal(await storeMethod('refreshCanvasMetadata', f.values)('A'), null);
  assert.equal(f.catalog.activeId, 'A'); assert.deepEqual(f.catalog.canvases.map(c => c.id), ['A', 'B']);
});

test('second audit 19 regression: metadata response captured before successful deletion cannot resurrect its directory entry', async () => {
  const f = catalogFixture(), gate = deferred(); f.values.api.getCanvasMetadata = () => gate.promise; f.values.api.deleteCanvas = async () => undefined;
  const result = storeMethod('refreshCanvasMetadata', f.values)('A');
  await storeMethod('deleteCanvas', f.values)('A'); gate.resolve({ id: 'A', name: 'deleted A' }); await result;
  assert.equal(f.catalog.activeId, 'B'); assert.equal(f.catalog.canvases.some(c => c.id === 'A'), false, 'advisory metadata read resurrected a successfully deleted directory row');
});

test('second audit 20 regression: late opened-profile response cannot resurrect an explicitly deleted canvas', async () => {
  const f = catalogFixture(), gate = deferred(); f.values.api.updateCanvasDirectoryProfile = () => gate.promise; f.values.api.deleteCanvas = async () => undefined;
  storeMethod('setActive', f.values)('A'); await storeMethod('deleteCanvas', f.values)('A');
  gate.resolve({ id: 'A', name: 'deleted opened A' }); await tick();
  assert.equal(f.catalog.activeId, 'B'); assert.equal(f.catalog.canvases.some(c => c.id === 'A'), false, 'late local profile update resurrected a deleted row');
});

test('second audit 19 boundary: failed deletion does not suppress a valid in-flight metadata response', async () => {
  const f = catalogFixture(), gate = deferred(); f.values.api.getCanvasMetadata = () => gate.promise;
  f.values.api.deleteCanvas = async () => { throw new Error('controlled delete denied'); };
  const result = storeMethod('refreshCanvasMetadata', f.values)('A'); await storeMethod('deleteCanvas', f.values)('A');
  gate.resolve({ id: 'A', name: 'valid updated A' }); await result;
  assert.equal(f.catalog.canvases.find(c => c.id === 'A').name, 'valid updated A'); assert.equal(f.catalog.activeId, 'A');
});

test('second audit 20 boundary: a missing paginated row is not proof of deletion and may be materialized by metadata', async () => {
  const f = catalogFixture(); f.catalog.canvases = [{ id: 'B', name: 'B' }];
  f.values.api.getCanvasMetadata = async () => ({ id: 'A', name: 'valid off-page A' });
  await storeMethod('refreshCanvasMetadata', f.values)('A');
  assert.equal(f.catalog.canvases.find(c => c.id === 'A').name, 'valid off-page A');
});

test('second audit 19 additional boundary: a fresh authoritative request after deletion may accept a legitimately restored same ID', async () => {
  const f = catalogFixture(); f.values.api.deleteCanvas = async () => undefined;
  await storeMethod('deleteCanvas', f.values)('A');
  f.values.api.getCanvasMetadata = async () => ({ id: 'A', name: 'explicitly restored A' });
  await storeMethod('refreshCanvasMetadata', f.values)('A');
  assert.equal(f.catalog.canvases.find(c => c.id === 'A').name, 'explicitly restored A');
});

test('second audit 19 pagination boundary: a row collected from an earlier page is not republished after deletion during the next page request', async () => {
  const f = catalogFixture(), secondPage = deferred(); let pages = 0;
  f.values.api.listCanvasPage = () => ++pages === 1 ? Promise.resolve({ items: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], activeItem: null,
    hasMore: true, nextCursor: 'page-2', partial: false, recovery: { status: 'idle' }, total: 3 }) : secondPage.promise;
  f.values.api.deleteCanvas = async () => undefined;
  const result = storeMethod('loadCanvases', f.values)(); await tick(); assert.equal(pages, 2);
  await storeMethod('deleteCanvas', f.values)('A');
  secondPage.resolve({ items: [{ id: 'C', name: 'C' }], activeItem: null, hasMore: false, nextCursor: null, partial: false, recovery: { status: 'idle' }, total: 2 });
  await result; assert.equal(f.catalog.canvases.some(c => c.id === 'A'), false, 'multi-page accumulator republished an earlier captured deleted row');
  assert.notEqual(f.catalog.activeId, 'A');
});

test('second audit supplemental regression: initial load response cannot supersede a later observed successful save', async () => {
  const f = fixture(), gate = deferred(); let loadFailure = null;
  Object.assign(f.context, {
    ...loadAuthority, ...load('src/utils/canvasPatchMerge.ts'),
    performanceFixtureSize: null, performanceFixtureCanvasId: null, markCanvasPerformance() {},
    setCanvasLoadFailure: value => { loadFailure = value; }, setActiveProjectId() {}, setInitializedFlowCanvasId() {}, setInitialCanvasViewport() {},
    setLoaded: value => { f.context.loadedRef.current = value; }, setLoadedCanvasId: value => { f.context.loadedCanvasIdRef.current = value; },
    replaceHydratedCanvasGraph: (nodes, edges) => { f.context.setNodes(nodes); f.context.setEdges(edges); },
    setFarmCanvasEditing() {}, setFarmCanvasFeedback() {}, setCreativeDeskEditing() {}, setCreativeDeskActiveItemId() {}, setPlacementShelfItems() {}, setPlacementShelfOpen() {},
    migrateLegacyVolcengineAssetNodes: nodes => ({ nodes, changed: false }),
    normalizeCanvasNodeSerials: (nodes, nextNodeSerialId) => ({ nodes, nextNodeSerialId, changed: false }), ensureCanvasEntityUids: value => value,
    getBrowserCanvasViewportStorage: () => null, resolveCanvasInitialViewport: (_storage, _id, viewport) => viewport,
    placementShelfItemsFromCanvasNodes: () => [], placementShelfClearedCanvasIdsRef: { current: new Set() },
  });
  for (const name of ['skipInitialAutosaveCanvasIds', 'skipInitialHistoryCanvasIds']) f.context[`${name}Ref`] = { current: new Set() };
  f.context.api.getCanvasData = () => gate.promise; f.context.api.canvasDatabaseRecoveryPlanFromError = () => null;
  f.context.setNodes([]);
  const cleanup = effect('.getCanvasData(requestedCanvasId)', f.context)();
  // This is the exact shared result of an older PUT succeeding while the new
  // editor's already-read GET response is held in transit, not a fake bad server.
  f.context.canvasRevisionsRef.current.set('A', 2); f.context.lastSavedByCanvasRef.current.set('A', state('saved later').snapshot);
  f.context.pendingSaveByCanvasRef.current.delete('A'); gate.resolve(document('base', 1)); await tick(); await tick();
  assert.equal(f.context.canvasRevisionsRef.current.get('A'), 2, `late initial GET lowered a successful save revision; load failure=${loadFailure?.message}`);
  assert.notEqual(f.presented.nodes[0]?.data.prompt, 'base', 'old GET became the rendered and supposedly durable canvas');
  assert.equal(loadFailure?.message, 'canvasSave:staleLoad'); assert.equal(f.context.loadedRef.current, false);
  cleanup();
});

test('second audit 04 late PUT boundary: a successful older autosave cannot undo a newer committed authority acknowledgement', async () => {
  const f = fixture(), gate = deferred(), started = deferred(), timers = new Map(); let timer = 0, putCalls = 0;
  f.edit('saved r2');
  Object.assign(f.context, {
    ...load('src/utils/canvasEntityIdentity.ts'), BULK_PHANTOM_ID: '__bulk_phantom__', archiveReadOnly: false,
    nodes: f.current.nodes, edges: [], creativeDesk: {}, farmCanvas: {}, creativeDeskRef: { current: {} }, farmCanvasRef: { current: {} },
    isDraggingRef: { current: false }, skipInitialAutosaveCanvasIdsRef: { current: new Set() },
    canvasMutationQueuesRef: { current: new Map() }, canvasSaveRecoveryAttemptsRef: { current: new Map() }, recoverCanvasSaveRef: { current: null },
    window: { setTimeout: fn => { const id = ++timer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) },
  });
  f.context.rawSetNodes = f.context.setNodes; f.context.rawSetEdges = f.context.setEdges;
  f.context.setNodes = callback('setNodes', f.context); f.context.setEdges = callback('setEdges', f.context);
  f.context.currentPersistableCanvas = callback('currentPersistableCanvas', f.context);
  f.context.enqueueCanvasMutation = callback('enqueueCanvasMutation', f.context);
  f.context.commitAuthoritativeCanvasPatchDocument = callback('commitAuthoritativeCanvasPatchDocument', f.context);
  f.context.api.saveCanvasData = async (_id, _payload, options) => {
    putCalls++; if (putCalls === 1) { started.resolve(); return gate.promise; }
    // A real later Patch baseline against the stale revision is rejected by the
    // authoritative backend CAS. This controlled dependency does not merge data.
    if (options.baseRevision !== 3) throw new ApiRequestError('stale acknowledgement induced CAS conflict', 409, { code: 'revision_conflict' });
    return { revision: 4, updatedAt: 104 };
  };
  effect('const flushPendingAutosave =', f.context)(); f.context.pendingSaveFlushersByCanvasRef.current.get('A')(); await started.promise;
  const remote = document('saved r2', 3); remote.nodes[0].data.backgroundResult = 'durable r3';
  const commit = f.context.commitAuthoritativeCanvasPatchDocument('A', remote, { expectedLocalSnapshot: state('base').snapshot });
  assert.equal(commit.conflicts.length, 0);
  f.context.nodes = f.context.nodesRef.current; f.context.edges = f.context.edgesRef.current;
  effect('const flushPendingAutosave =', f.context)();
  assert.equal(f.context.pendingSaveByCanvasRef.current.has('A'), false, 'current rendered r3 is already durable before the old acknowledgement arrives');
  const r3Snapshot = f.context.lastSavedByCanvasRef.current.get('A');
  gate.resolve({ revision: 2, updatedAt: 102 }); await tick(); await tick();
  const baseline = callback('ensureCanvasPatchBaseline', f.context);
  let baselineError; try { await baseline('A'); } catch (error) { baselineError = error; }
  assert.equal(putCalls, 1, `an already durable r3 was falsely resubmitted using revision 2 and caused ${baselineError?.code || 'no error'}`);
  assert.equal(baselineError, undefined); assert.equal(f.context.canvasRevisionsRef.current.get('A'), 3);
  assert.equal(f.context.lastSavedByCanvasRef.current.get('A'), r3Snapshot);
  assert.equal(f.presented.nodes[0].data.backgroundResult, 'durable r3');
});

test('second audit 04 baseline acknowledgement boundary: a delayed baseline response cannot replace a newer committed authority baseline', async () => {
  const f = fixture(), gate = deferred(); let putCalls = 0;
  f.edit('saved baseline r2');
  Object.assign(f.context, { ...load('src/utils/canvasEntityIdentity.ts'), BULK_PHANTOM_ID: '__bulk_phantom__',
    creativeDeskRef: { current: {} }, farmCanvasRef: { current: {} }, rawSetNodes: f.context.setNodes, rawSetEdges: f.context.setEdges,
  });
  f.context.setNodes = callback('setNodes', f.context); f.context.setEdges = callback('setEdges', f.context);
  f.context.currentPersistableCanvas = callback('currentPersistableCanvas', f.context);
  f.context.commitAuthoritativeCanvasPatchDocument = callback('commitAuthoritativeCanvasPatchDocument', f.context);
  f.context.api.saveCanvasData = async (_id, _payload, options) => {
    putCalls++; if (putCalls === 1) return gate.promise;
    if (options.baseRevision !== 3) throw new ApiRequestError('stale baseline acknowledgement induced CAS conflict', 409, { code: 'revision_conflict' });
    return { revision: 4, updatedAt: 104 };
  };
  const ensure = callback('ensureCanvasPatchBaseline', f.context), first = ensure('A');
  const remote = document('saved baseline r2', 3); remote.nodes[0].data.backgroundResult = 'durable baseline r3';
  f.context.commitAuthoritativeCanvasPatchDocument('A', remote, { expectedLocalSnapshot: state('base').snapshot });
  const r3Snapshot = f.context.lastSavedByCanvasRef.current.get('A');
  gate.resolve({ revision: 2, updatedAt: 102 });
  await assert.rejects(first, error => error.code === 'PATCH_PREVIEW_STALE' || error instanceof loadAuthority.StaleCanvasLoadError);
  let secondError; try { await ensure('A'); } catch (error) { secondError = error; }
  assert.equal(putCalls, 1, `a second preview resubmitted an already durable authority through stale CAS: ${secondError?.code}`);
  assert.equal(secondError, undefined); assert.equal(f.context.canvasRevisionsRef.current.get('A'), 3);
  assert.equal(f.context.lastSavedByCanvasRef.current.get('A'), r3Snapshot);
});
