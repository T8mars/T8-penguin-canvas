const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function productionRequest(dispatchResult = true, synchronousOutcome) {
  const filename = path.resolve(__dirname, '../src/components/nodes/LocalizationMasterNode.tsx');
  const source = readFileSync(filename, 'utf8');
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'requestAction') initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(initializer);
  const requests = [];
  const state = { pending: null, error: '', agent: null };
  let sequence = 0;
  const context = {
    id: 'localization-node', running: false, isEnglish: false,
    actionRef: { current: 'parse' }, pendingActionRef: { current: null }, pendingRequestIdRef: { current: '' },
    setPendingAction: (value) => { state.pending = value; },
    setLocalError: (value) => { state.error = value; },
    markAgentRequest: (status, error) => { state.agent = { status, error }; },
    t: (key) => key,
    createCanvasNodeRunRequestId: () => `localization-test-${++sequence}`,
    requestCanvasNodeRun: (id, options) => {
      requests.push({ id, options });
      if (synchronousOutcome) options?.onSettled?.(synchronousOutcome);
      return dispatchResult;
    },
  };
  const javascript = ts.transpileModule(`result = (${initializer.getText(parsed)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(javascript, context);
  return { request: context.result, requests, state, context };
}

test('a blocked durable Run unlocks localization and displays the actual failure', () => {
  const { request, requests, state, context } = productionRequest();
  assert.equal(request('install'), true);
  assert.equal(request('dub'), false, 'do not dispatch twice while starting');
  requests[0].options?.onSettled?.({ accepted: false, error: 'canvas input changed' });
  assert.equal(state.pending, null);
  assert.equal(context.pendingActionRef.current, null);
  assert.equal(state.error, 'canvas input changed');
  assert.equal(request('install'), true, 'user can retry explicitly after rejection');
  assert.equal(requests.length, 2);
});

test('a late rejection cannot unlock a newer localization request', () => {
  const { request, requests, state } = productionRequest();
  request('install');
  requests[0].options?.onSettled?.({ accepted: false, error: 'first failure' });
  assert.equal(request('dub'), true);
  requests[0].options?.onSettled?.({ accepted: false, error: 'late duplicate' });
  assert.equal(state.pending, 'dub');
  assert.notEqual(state.error, 'late duplicate');
});

test('cancellation, synchronous rejection and unavailable dispatcher release the startup lock', () => {
  const cancelled = productionRequest();
  cancelled.request('install');
  cancelled.requests[0].options?.onSettled?.({ accepted: false });
  assert.equal(cancelled.state.pending, null);
  assert.equal(cancelled.state.error, 'nodes.localization.errors.runRequest');
  const synchronous = productionRequest(true, { accepted: false, error: 'duplicate' });
  synchronous.request('install');
  assert.equal(synchronous.state.pending, null);
  const unavailable = productionRequest(false);
  assert.equal(unavailable.request('install'), false);
  assert.equal(unavailable.state.pending, null);
});

test('successful dispatch keeps the execution lock until the production lifecycle finishes', () => {
  const { request, requests, state } = productionRequest();
  request('install');
  requests[0].options.onSettled({ accepted: true });
  assert.equal(state.pending, 'install');
  assert.equal(request('install'), false);
  const source = readFileSync(path.resolve(__dirname, '../src/components/nodes/LocalizationMasterNode.tsx'), 'utf8');
  assert.match(source, /finally \{\s*pendingRequestIdRef\.current = '';\s*pendingActionRef\.current = null;\s*setPendingAction\(null\)/);
});
