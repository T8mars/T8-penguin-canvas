'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = fs.readFileSync(require.resolve('../src/utils/canvasExitTransport.ts'), 'utf8');
function fixture() {
  let phase = null, calls = 0, hold = false;
  const exports = {};
  vm.runInNewContext(compile(source), { exports,
    document: { querySelector: () => hold ? { getAttribute: () => phase } : null },
    fetch: (...args) => { calls++; return Promise.resolve({ ok: true, args }); },
  });
  return { ...exports, set(value) { hold = value !== false; phase = value === true ? null : value; }, get calls() { return calls; } };
}
test('saving leaves the real CAS transport open; only acknowledged closing fences it', async () => {
  const f = fixture();
  await f.canvasBackendFetch('/api/status'); f.set('saving');
  await f.canvasBackendFetch('/api/canvas/test', { method: 'PUT' });
  assert.equal(f.calls, 2);
  for (const phase of ['closing', 'waiting', 'installing', 'update-error', true]) {
    f.set(phase); assert.equal(f.isCanvasExitTransportClosed(), true);
    await assert.rejects(f.canvasBackendFetch('/api/canvas/test'), /CANVAS_EXIT_IN_PROGRESS/);
  }
  assert.equal(f.calls, 2);
});
test('refusal/cancellation removes the hold and restores ordinary backend access', async () => {
  const f = fixture(); f.set('closing');
  await assert.rejects(f.canvasBackendFetch('/api/status'));
  f.set(false); assert.equal(f.isCanvasExitTransportClosed(), false);
  await f.canvasBackendFetch('/api/status'); assert.equal(f.calls, 1);
});
test('the exit fence never cancels an already accepted request', async () => {
  let resolve, phase = 'saving', aborted = false;
  const exports = {}, controller = new AbortController();
  controller.signal.addEventListener('abort', () => { aborted = true; });
  vm.runInNewContext(compile(source), { exports, document: { querySelector: () => ({ getAttribute: () => phase }) },
    fetch: () => new Promise(done => { resolve = done; }) });
  const pending = exports.canvasBackendFetch('/api/canvas/test', { method: 'PUT', signal: controller.signal });
  phase = 'closing'; resolve('durable');
  assert.equal(await pending, 'durable'); assert.equal(aborted, false);
});
test('backend status polling cannot publish a disconnect or start recovery after close ACK', async () => {
  const app = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8');
  const start = app.indexOf('  const checkBackendNow = useCallback(async () => {');
  const end = app.indexOf('  }, []);', start) + '  }, []);'.length;
  assert.ok(start >= 0 && end > start);
  const code = compile(app.slice(start, end) + '\nexports.check=checkBackendNow;');
  for (const initiallyClosing of [false, true]) {
    let closing = initiallyClosing, checks = 0, statuses = 0, interactive = 0;
    const exports = {};
    vm.runInNewContext(code, { exports, useCallback: fn => fn, isCanvasExitTransportClosed: () => closing,
      api: { checkBackendStatus: async () => { checks++; closing = true; return false; }, markBackendFrontendInteractive: () => { interactive++; } },
      setBackendStatus: () => { statuses++; } });
    assert.equal(await exports.check(), false); assert.equal(checks, initiallyClosing ? 0 : 1);
    assert.equal(statuses, 0); assert.equal(interactive, 0);
  }
});
test('all API client fetch entry points use the common close fence', () => {
  const api = fs.readFileSync(require.resolve('../src/services/api.ts'), 'utf8');
  assert.doesNotMatch(api, /\bfetch\s*\(/);
  assert.match(api, /canvasBackendFetch/);
});
