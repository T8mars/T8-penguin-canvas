const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function productionSink(nonGeneratingOperation) {
  const filename = path.resolve(__dirname, '../src/hooks/useRunTrigger.ts');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  let write;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'write'
      && node.initializer.getText(source).includes('persistProjectRunOutputAssets')) write = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(write);
  const calls = { events: [], outputs: [] };
  const context = {
    runId: 'run-a', nodeRunId: 'node-run-a', attemptId: 'attempt-a', acceptLifecycleEvents: true,
    executionCallbackStarted: true, nonGeneratingOperation, providerSubmissionExpected: false,
    capturedExecutionToken: 'token-a', console: { warn() {} },
    appendProjectRunEvent: async (_id, event) => {
      if (event.type === 'node.output') throw Error('run_event_authority_required');
      calls.events.push(event);
    },
    persistProjectRunOutputAssets: async (...args) => { calls.outputs.push(args); },
  };
  vm.runInNewContext(ts.transpileModule(`result = (${write.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { write: context.result, calls };
}

test('an explicitly non-generating operation records completion progress without forging a host-only output event', async () => {
  const p = productionSink(true);
  await p.write('node.output', { status: 'succeeded', outputCount: 0, assets: [] });
  assert.equal(p.calls.outputs.length, 0);
  assert.equal(p.calls.events.length, 1);
  assert.equal(p.calls.events[0].type, 'node.progress');
  assert.equal(p.calls.events[0].payload.outputCount, 0);
  assert.equal(p.calls.events[0].payload.nonGeneratingOperation, true);
});

test('an ordinary generation cannot use the maintenance path to declare empty output successful', async () => {
  const p = productionSink(false);
  await assert.rejects(p.write('node.output', { status: 'succeeded', outputCount: 0, assets: [] }), /run_event_authority_required/);
  assert.equal(p.calls.outputs.length, 0);
  assert.equal(p.calls.events.length, 0);
});

test('real generated assets still go through the authoritative output transaction', async () => {
  const p = productionSink(false);
  await p.write('node.output', { status: 'succeeded', outputCount: 1, assets: [{ kind: 'text', filename: 'result.txt', text: 'result' }] });
  assert.equal(p.calls.outputs.length, 1);
  assert.equal(p.calls.outputs[0][2].attemptId, 'attempt-a');
  assert.equal(p.calls.events.length, 0);
});

test('maintenance cannot fabricate a generated asset or a positive output count', async () => {
  for (const payload of [{ outputCount: 1, assets: [] }, { outputCount: 0, assets: [{ kind: 'image' }] }, {}]) {
    const p = productionSink(true);
    await assert.rejects(p.write('node.output', payload), /NON_GENERATING_OUTPUT_INVALID/);
    assert.equal(p.calls.outputs.length, 0);
    assert.equal(p.calls.events.length, 0);
  }
});
