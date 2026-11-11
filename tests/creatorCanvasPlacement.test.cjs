const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function callback(file, name, context) {
  const filename = path.resolve(__dirname, '..', file);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let value;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(value, `Production callback ${name} is missing`);
  const expression = ts.isCallExpression(value) ? value.arguments[0] : value;
  vm.runInNewContext(ts.transpileModule(`result = (${expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.result;
}

function panel(focus) {
  const state = { posts: 0, busy: false, error: '', focus: [] };
  const context = {
    conversation: { id: 'session-a' }, isOperating: false, sentNodes: {},
    sentRevisionsRef: { current: {} },
    props: { projectId: 'project-a', canvasId: 'canvas-a', onFocusNode: (...args) => { state.focus.push(args); return focus?.(...args); } },
    setOperation: () => { state.busy = true; }, finishOperation: () => { state.busy = false; },
    setError: value => { state.error = value; },
    setSentNodes: update => { context.sentNodes = update(context.sentNodes); },
    sendCreatorAssetToCanvasV2: async () => { state.posts++; return { nodeId: 'result-a', canvasRevision: 4, duplicate: false }; },
    copy: (zh) => zh, recoveryErrorText: (error, fallback) => error?.message || fallback,
  };
  return { state, context, send: callback('src/components/CreatorAgentPanelV2.tsx', 'sendToCanvas', context) };
}

test('Creator keeps placement busy until the committed node is synchronized and passes its revision', async () => {
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
  const p = panel(() => ready);
  const flight = p.send({ assetId: 'asset-a' }, 'action-a');
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.state.posts, 1);
    assert.equal(p.state.busy, true, 'HTTP success must not complete reveal before Canvas synchronizes');
    assert.equal(p.state.focus[0][1].canvasRevision, 4);
    assert.equal(p.state.focus[0][1].assetId, 'asset-a');
  } finally { finish(); await flight; }
  assert.equal(p.state.busy, false);
});

test('Creator viewing a previously placed asset does not submit another placement', async () => {
  const p = panel();
  await p.send({ assetId: 'asset-a', canvasNodeId: 'prior-node', canvasRevision: 3 }, 'action-a');
  assert.equal(p.state.posts, 0);
  assert.equal(p.state.focus[0][0], 'prior-node');
  assert.equal(p.state.focus[0][1].canvasRevision, 3);
});

test('a failed reveal preserves the placement receipt and an explicit View retries GET synchronization only', async () => {
  let attempts = 0;
  const p = panel(async () => { if (++attempts === 1) throw Error('fixture read interrupted'); });
  await p.send({ assetId: 'asset-a' }, 'action-a');
  assert.equal(p.state.error, 'fixture read interrupted');
  assert.equal(p.state.busy, false);
  assert.equal(p.context.sentNodes['asset-a'], 'result-a');
  await p.send({ assetId: 'asset-a' }, 'action-a');
  assert.equal(p.state.posts, 1);
  assert.equal(p.state.focus.length, 2);
  assert.equal(p.state.error, '');
});

function canvas() {
  const state = { scope: 'canvas-a', project: 'project-a', fetched: 0, committed: 0, focused: null, options: null };
  const node = { id: 'result-a', position: { x: 80, y: 40 }, data: { sourceAssetId: 'asset-a' } };
  const context = {
    activeId: 'canvas-a', activeProjectId: 'project-a',
    activeProjectIdRef: { get current() { return state.project; } },
    loadedRef: { current: true }, loadedCanvasIdRef: { get current() { return state.scope; } },
    useCanvasStore: { getState: () => ({ activeId: state.scope }) },
    lastSavedByCanvasRef: { current: new Map([['canvas-a', 'baseline-a']]) },
    enqueueCanvasMutation: async (_id, work) => work(),
    fetchAuthoritativeCanvasPatchDocument: async () => { state.fetched++; return { canvasId: 'canvas-a', projectId: 'project-a', revision: 4, nodes: [node] }; },
    commitAuthoritativeCanvasPatchDocument: (_id, doc, options) => { state.committed++; state.options = options; return { active: true, state: { nodes: doc.nodes }, conflicts: [] }; },
    nodesRef: { current: [] }, setNodes: () => {},
    rectOf: item => ({ x: item.position.x, y: item.position.y, w: 200, h: 100 }),
    getViewport: () => ({ zoom: 1 }), setCenter: () => {}, pulseNearestNode: id => { state.focused = id; },
  };
  return { state, context, node, reveal: callback('src/components/Canvas.tsx', 'revealCreatorCanvasNode', context) };
}

test('Creator reveals a node after authoritative read/merge even when the local graph has not received it', async () => {
  const c = canvas();
  await c.reveal('result-a', { assetId: 'asset-a', canvasRevision: 4 });
  assert.equal(c.state.fetched, 1);
  assert.equal(c.state.committed, 1);
  assert.equal(c.state.options.expectedLocalSnapshot, 'baseline-a', 'Reuse concurrent-local-edit merge, do not overwrite the graph');
  assert.equal(c.state.focused, 'result-a');
});

test('Creator refuses stale revisions, deleted nodes and replaced asset identities without changing the canvas', async () => {
  for (const kind of ['revision', 'deleted', 'asset']) {
    const c = canvas();
    c.context.fetchAuthoritativeCanvasPatchDocument = async () => ({ revision: kind === 'revision' ? 3 : 4,
      nodes: kind === 'deleted' ? [] : [{ ...c.node, data: { sourceAssetId: kind === 'asset' ? 'other-asset' : 'asset-a' } }],
    });
    await assert.rejects(c.reveal('result-a', { assetId: 'asset-a', canvasRevision: 4 }));
    assert.equal(c.state.committed, 0, kind);
    assert.equal(c.state.focused, null, kind);
  }
});

test('Creator ignores a late read after project/canvas changes and never focuses another canvas', async () => {
  for (const kind of ['canvas', 'project']) {
    const c = canvas();
    c.context.fetchAuthoritativeCanvasPatchDocument = async () => {
      if (kind === 'canvas') c.state.scope = 'canvas-b'; else c.state.project = 'project-b';
      return { revision: 4, nodes: [c.node] };
    };
    await assert.rejects(c.reveal('result-a', { assetId: 'asset-a', canvasRevision: 4 }));
    assert.equal(c.state.committed, 0);
    assert.equal(c.state.focused, null);
  }
});

test('Creator rejects malformed or changed asset-hash bindings before committing the remote document', async () => {
  for (const bindings of [null, {}, ['unexpected'], [{ assetId: 'asset-a', contentHash: 'other-hash' }]]) {
    const c = canvas();
    c.node.data.referenceBindings = bindings;
    await assert.rejects(c.reveal('result-a', { assetId: 'asset-a', contentHash: 'expected-hash', canvasRevision: 4 }),
      error => error.message === 'CREATOR_CANVAS_NODE_MISSING');
    assert.equal(c.state.committed, 0);
  }
});
