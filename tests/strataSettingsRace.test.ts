import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const parser = require('@babel/parser');
const source = fs.readFileSync(new URL('../src/components/ApiSettings.tsx', import.meta.url), 'utf8');
const names = [
  'invalidateAdvancedProviderTest', 'removeAdvancedProvider', 'updateAdvancedProvider',
  'updateAdvancedProviderNested', 'handleTestAdvancedProvider',
];
const handlers = new Map<string, string>();
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
function visit(value: any) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'VariableDeclarator' && names.includes(value.id?.name)) {
    handlers.set(value.id.name, source.slice(value.init.start, value.init.end));
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(visit);
    else if (child && typeof child === 'object') visit(child);
  }
}
visit(ast);
assert.equal(handlers.size, names.length, 'execute the real production handlers, not a copied race implementation');
const executable = ts.transpileModule([
  ...names.map((name) => `const ${name} = ${handlers.get(name)};`),
  `return {${names.join(',')}};`,
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

type Outcome = 'success' | 'failure' | 'rejection';
function fixture() {
  const state = {
    providers: [{ id: 'strata-race', profile: 'strata', authMode: 'none', apiKey: '', baseUrl: 'http://127.0.0.1:1111', chatModels: ['original'] }] as any[],
    status: {} as Record<string, any>,
    dirty: false,
  };
  const requests: Array<{ provider: any; resolve: (value: any) => void; reject: (reason: Error) => void }> = [];
  const advancedTestRequestsRef = { current: new Map<string, symbol>() };
  const api = new Function(
    'advancedTestRequestsRef', 'testAdvancedProvider', 'setAdvancedTestStatus',
    'setAdvancedProvidersInput', 'setAdvancedDirty', 't', executable,
  )(
    advancedTestRequestsRef,
    ({ provider }: any) => new Promise((resolve, reject) => requests.push({ provider, resolve, reject })),
    (update: any) => { state.status = typeof update === 'function' ? update(state.status) : update; },
    (update: any) => { state.providers = typeof update === 'function' ? update(state.providers) : update; },
    (value: boolean) => { state.dirty = value; },
    (key: string, params?: any) => `${key}:${params?.model || ''}`,
  );
  const complete = (index: number, outcome: Outcome, model = 'model-A') => {
    const request = requests[index];
    if (outcome === 'rejection') request.reject(new Error(`failed-${model}`));
    else if (outcome === 'failure') request.resolve({ ok: false, error: `failed-${model}` });
    else request.resolve({ ok: true, discovery: {
      baseUrl: `${request.provider.baseUrl}/v1`, models: [{ id: model }], model,
      contextTokens: 32768, vision: false, loaded: true,
    } });
  };
  return { state, requests, api, complete, advancedTestRequestsRef };
}

const outcomes: Outcome[] = ['success', 'failure', 'rejection'];
for (const [field, value] of [
  ['baseUrl', 'http://127.0.0.1:2222'], ['apiKey', 'synthetic-new-key'],
  ['authMode', 'bearer'], ['clearApiKey', true],
] as const) {
  for (const outcome of outcomes) {
    test(`Strata settings: editing ${field} prevents late ${outcome} from restoring a stale connection result`, async () => {
      const f = fixture();
      const pending = f.api.handleTestAdvancedProvider(f.state.providers[0]);
      f.api.updateAdvancedProvider('strata-race', { [field]: value });
      const expected = structuredClone(f.state.providers);
      assert.equal(f.state.status['strata-race'], undefined);
      f.state.dirty = false;
      f.complete(0, outcome);
      await pending;
      assert.equal(f.state.status['strata-race'], undefined);
      assert.deepEqual(f.state.providers, expected, 'a late discovery must not change models or URL');
      assert.equal(f.state.dirty, false, 'a discarded reply must not create unsaved changes');
    });
  }
}

for (const outcome of outcomes) {
  test(`Strata settings: removed provider ignores late ${outcome}`, async () => {
    const f = fixture();
    const pending = f.api.handleTestAdvancedProvider(f.state.providers[0]);
    f.api.removeAdvancedProvider('strata-race');
    f.state.dirty = false;
    f.complete(0, outcome);
    await pending;
    assert.deepEqual(f.state.providers, []);
    assert.deepEqual(f.state.status, {});
    assert.equal(f.state.dirty, false);
  });

  test(`Strata settings: newer request wins when the old request returns ${outcome} last`, async () => {
    const f = fixture();
    const old = f.api.handleTestAdvancedProvider(f.state.providers[0]);
    f.api.updateAdvancedProvider('strata-race', { baseUrl: 'http://127.0.0.1:2222' });
    const current = f.api.handleTestAdvancedProvider(f.state.providers[0]);
    f.complete(1, 'success', 'model-B');
    await current;
    const expectedProviders = structuredClone(f.state.providers);
    const expectedStatus = structuredClone(f.state.status);
    f.state.dirty = false;
    f.complete(0, outcome);
    await old;
    assert.deepEqual(f.state.providers, expectedProviders);
    assert.deepEqual(f.state.status, expectedStatus);
    assert.match(f.state.status['strata-race'].message, /model-B/);
    assert.equal(f.state.dirty, false);
  });
}

test('Strata settings: nested configuration edits invalidate in-flight tests too', async () => {
  const f = fixture();
  const pending = f.api.handleTestAdvancedProvider(f.state.providers[0]);
  f.api.updateAdvancedProviderNested('strata-race', 'comfyuiConfig', { instances: ['synthetic'] });
  f.complete(0, 'success');
  await pending;
  assert.equal(f.state.status['strata-race'], undefined);
  assert.deepEqual(f.state.providers[0].chatModels, ['original']);
});

test('Strata settings: repeated tests with identical configuration still reject an older reply', async () => {
  const f = fixture();
  const old = f.api.handleTestAdvancedProvider(f.state.providers[0]);
  const current = f.api.handleTestAdvancedProvider(f.state.providers[0]);
  f.complete(1, 'success', 'newest');
  await current;
  f.complete(0, 'success', 'obsolete');
  await old;
  assert.deepEqual(f.state.providers[0].chatModels, ['newest']);
  assert.match(f.state.status['strata-race'].message, /newest/);
});
