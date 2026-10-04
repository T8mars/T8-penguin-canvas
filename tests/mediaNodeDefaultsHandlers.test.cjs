const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function compile(source, context) {
  return vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
}
test('real settings select captures values before React event cleanup and replay', () => {
  const file = path.join(root, 'src/components/ApiSettings.tsx');
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'select'
      && node.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'data-media-default-field')) {
      handler = node.attributes.properties.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'onChange').initializer.expression.getText(tree);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(handler);
  for (const field of ['imageSource', 'videoSource']) {
    const pending = [], dirty = { current: false };
    const onChange = compile(`(${handler})`, { field, mediaDefaultsDirty: dirty, setMediaDefaultsDraft: (updater) => pending.push(updater) });
    const event = { currentTarget: { value: 'seedance-nz' } };
    onChange(event); event.currentTarget = null;
    const old = { version: 1, imageSource: 'zhenzhen', videoSource: 'zhenzhen' };
    assert.equal(pending[0](old)[field], 'seedance-nz');
    assert.equal(pending[0](old)[field], 'seedance-nz');
    assert.equal(dirty.current, true);
    assert.equal(old[field], 'zhenzhen');
  }
});
test('actual settings store preserves last verified preferences on read-back or refresh failure', async () => {
  let state;
  const api = { getSettings: async () => ({ preferences: { mediaNodeDefaults: { version: 1, imageSource: 'seedance-nz', videoSource: 'zhenzhen' } } }), updateSettings: async () => {} };
  const modules = {
    zustand: { create: (initializer) => { state = initializer((patch) => { state = { ...state, ...patch }; }); return { getState: () => state }; } },
    '../services/api': api,
    '../utils/mediaNodeDefaults': require('../backend/src/utils/mediaNodeDefaults.js'),
  };
  const exports = {};
  compile(fs.readFileSync(path.join(root, 'src/stores/apiKeys.ts'), 'utf8'), { exports, require: (name) => modules[name] });
  assert.equal(state.loaded, false);
  await state.load();
  assert.equal(state.loaded, true);
  const verified = state.settings;
  api.getSettings = async () => { throw new Error('read-back failed'); };
  await state.save({ preferences: { mediaNodeDefaults: { version: 1, imageSource: 'zhenzhen', videoSource: 'zhenzhen' } } });
  assert.equal(state.settings, verified);
  assert.equal(state.error, 'read-back failed');
  await state.load();
  assert.equal(state.settings, verified);
  assert.equal(state.loaded, true);
  api.getSettings = async () => ({ preferences: { mediaNodeDefaults: { version: 99 } } });
  await state.load();
  assert.equal(state.settings, verified);
  assert.equal(state.error, 'media_node_defaults_invalid');
});
test('actual blank-creation factory blocks unverified defaults but not explicit choices or non-media nodes', () => {
  const exports = {}, state = { loaded: false, settings: { preferences: { mediaNodeDefaults: { version: 1, imageSource: 'seedance-nz', videoSource: 'seedance-nz' } } } };
  compile(fs.readFileSync(path.join(root, 'src/utils/mediaNodeCreation.ts'), 'utf8'), {
    exports,
    require: (name) => name === '../stores/apiKeys' ? { useApiKeysStore: { getState: () => state } } : require('../backend/src/utils/mediaNodeDefaults.js'),
  });
  assert.throws(() => exports.createBlankNodeData('image', {}), /media_node_defaults_not_ready/);
  assert.equal(exports.createBlankNodeData('image', {}, { apiModel: 'chosen' }).apiModel, 'chosen');
  assert.equal(exports.createBlankNodeData('text', { text: 'keep' }).text, 'keep');
  state.loaded = true;
  const first = exports.createBlankNodeData('image', {});
  state.settings.preferences.mediaNodeDefaults.imageSource = 'zhenzhen';
  assert.equal(first.apiModel, 'zhenzhen-image-g2-t2i');
  assert.equal(exports.createBlankNodeData('image', {}).apiModel, 'gpt-image-2');
});

test('actual settings store discards a stale initial load after a newer verified save', async () => {
  let state, finishOld;
  const old = new Promise((resolve) => { finishOld = resolve; });
  let reads = 0;
  const latest = { preferences: { mediaNodeDefaults: { version: 1, imageSource: 'seedance-nz', videoSource: 'seedance-nz' } } };
  const api = { getSettings: async () => ++reads === 1 ? old : latest, updateSettings: async () => {} };
  const exports = {};
  compile(fs.readFileSync(path.join(root, 'src/stores/apiKeys.ts'), 'utf8'), { exports, require: (name) => ({
    zustand: { create: (initialize) => { state = initialize((patch) => { state = { ...state, ...patch }; }); return { getState: () => state }; } },
    '../services/api': api, '../utils/mediaNodeDefaults': require('../backend/src/utils/mediaNodeDefaults.js'),
  })[name] });
  const initial = state.load();
  await state.save(latest);
  const verified = state.settings;
  finishOld({ preferences: { mediaNodeDefaults: { version: 1, imageSource: 'zhenzhen', videoSource: 'zhenzhen' } } });
  await initial;
  assert.equal(state.settings, verified);
  assert.equal(state.loaded, true);
});

test('actual archive API recovers one lost response with the identical operation, but does not replay rejected CAS', async () => {
  const file = path.join(root, 'src/services/api.ts');
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'transitionCanvasArchive');
  assert.ok(declaration);
  const exports = {}, calls = [];
  class ApiRequestError extends Error { constructor(status) { super('rejected'); this.status = status; } }
  let failure = new TypeError('lost response');
  compile(declaration.getText(tree), { exports, BASE: '/api', ApiRequestError, request: async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) throw failure;
    return { success: true, data: { duplicate: true } };
  } });
  const item = { id: 'original', projectId: 'project', revision: 7, catalogRevision: 3 };
  assert.equal((await exports.transitionCanvasArchive(item, 'archive', 'same-operation')).duplicate, true);
  assert.equal(calls.length, 2); assert.equal(calls[0].url, calls[1].url); assert.equal(calls[0].init, calls[1].init);
  assert.equal(JSON.parse(calls[1].init.body).operationId, 'same-operation');
  calls.length = 0; failure = new ApiRequestError(409);
  await assert.rejects(() => exports.transitionCanvasArchive(item, 'archive', 'rejected-operation'), (error) => error.status === 409);
  assert.equal(calls.length, 1);
});
