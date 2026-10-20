'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function renderer(bridge) {
  const hooks = [], effects = []; let cursor = 0, tree;
  const element = (type, props) => ({ type, props });
  const react = {
    useRef(value) { const index = cursor++; return hooks[index] ||= { current: value }; },
    useState(value) { const index = cursor++; if (!(index in hooks)) hooks[index] = value; return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; },
    useEffect(effect) { effects.push(effect); },
  };
  const exports = {};
  const window = bridge ? { t8pc: { agentTools: bridge, openPath: async () => ({ success: true }) } } : {};
  const compiled = ts.transpileModule(read('src/components/AgentToolsSettings.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, { exports, window, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'fragment' };
    if (name === 'react-i18next') return { useTranslation: () => ({ t: key => key }) };
    if (name === 'lucide-react') return { FolderOpen: 'folder-icon', Loader2: 'loader-icon', RefreshCw: 'refresh-icon' };
    throw Error('Unexpected import: ' + name);
  } });
  function render() { cursor = 0; effects.length = 0; tree = exports.default({ isPixel: false }); return tree; }
  function nodes(node) {
    if (arguments.length === 0) node = tree;
    if (!node || typeof node !== 'object') return [];
    return [node, ...[].concat(node.props?.children || []).flat(Infinity).flatMap(child => nodes(child))];
  }
  render();
  return { hooks, effects, render, nodes, window, button: key => nodes().find(n => n.type === 'button' && [].concat(n.props.children || []).flat(Infinity).includes(key)) };
}

test('production settings only inspect on mount; rapid repair clicks dispatch one request', async () => {
  let reads = 0, writes = 0; const pending = deferred();
  const h = renderer({ status: async () => { reads++; return { success: true, data: { state: 'missing' } }; }, repair: () => { writes++; return pending.promise; } });
  const cleanup = h.effects[0](); await flush();
  assert.equal(reads, 1); assert.equal(writes, 0); h.render();
  const button = h.button('agentTools.repair'); button.props.onClick(); button.props.onClick();
  assert.equal(writes, 1);
  pending.resolve({ success: true, data: { state: 'current', changed: true, cliRoot: 'EXAMPLE_ROOT', cliVersion: '0.1.0-dev', skillVersion: '0.1.0-dev' } });
  await flush(); h.render();
  assert.equal(h.hooks[2], false); assert.equal(h.hooks[4], 'saved');
  assert.equal(h.button('agentTools.repair').props.disabled, false);
  assert.ok(h.nodes().some(n => n.type === 'code' && n.props.children === 'EXAMPLE_ROOT'));
  cleanup();
});

test('StrictMode effect replay ignores old status and never leaves the settings stuck busy', async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const h = renderer({ status: () => (++reads === 1 ? first.promise : second.promise), repair: async () => { throw Error('must not install'); } });
  const effect = h.effects[0], cleanup = effect(); cleanup(); effect();
  second.resolve({ success: true, data: { state: 'outdated' } }); await flush();
  assert.equal(h.hooks[2], false); assert.equal(h.hooks[3].state, 'outdated');
  first.resolve({ success: true, data: { state: 'current' } }); await flush();
  assert.equal(h.hooks[3].state, 'outdated'); assert.equal(h.hooks[0].current, false);
});

test('production settings show safe source-mismatch, unmanaged, no-op and rejection messages', async () => {
  for (const [result, expected] of [
    [{ success: false, code: 'AGENT_TOOLS_SOURCE_MISMATCH' }, 'sourceMismatch'],
    [{ success: false, code: 'AGENT_TOOLS_TARGET_UNMANAGED' }, 'unmanaged'],
    [{ success: false, code: 'EXAMPLE_UNKNOWN', message: 'EXAMPLE_PRIVATE_STACK' }, 'failed'],
    [{ success: true, data: { state: 'current', changed: false } }, 'unchanged'],
  ]) {
    const h = renderer({ status: async () => ({ success: true, data: { state: 'outdated' } }), repair: async () => result });
    h.effects[0](); await flush(); h.render(); h.button('agentTools.repair').props.onClick(); await flush(); h.render();
    assert.equal(h.hooks[4], expected);
    assert.equal(JSON.stringify(h.nodes()).includes('EXAMPLE_PRIVATE_STACK'), false);
  }
  const h = renderer({ status: async () => { throw Error('EXAMPLE_PRIVATE_STACK'); }, repair() { throw Error('must not install'); } });
  h.effects[0](); await flush(); assert.equal(h.hooks[4], 'failed'); assert.equal(h.hooks[2], false);
});

test('browser settings cannot install desktop tools and late responses cannot update an unmounted panel', async () => {
  const browser = renderer(); browser.effects[0](); await flush();
  assert.equal(browser.nodes().filter(n => n.type === 'button').length, 0);
  const pending = deferred(); const h = renderer({ status: () => pending.promise, repair() { throw Error('unexpected'); } });
  h.effects[0]()(); pending.resolve({ success: true, data: { state: 'current' } }); await flush();
  assert.equal(h.hooks[3], null);
});

test('settings, fixed IPC, backend live snapshot and asar packaging are connected', () => {
  assert.match(read('src/components/ApiSettings.tsx'), /<AgentToolsSettings isPixel=\{isPixel\} \/>/);
  assert.match(read('electron/main.cjs'), /getCompatibility: \(\) => backendModule\?\.agentControlCompatibilitySnapshot\?\.\(\)/);
  assert.match(read('backend/src/server.js'), /agentControlCompatibilitySnapshot: require\('\.\/services\/agentControlCompatibility'\)\.compatibilitySnapshot/);
  assert.match(read('electron/preload.cjs'), /repair: \(\) => ipcRenderer\.invoke\('t8pc:agent-tools:repair'\)/);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('electron/agentTools.cjs'));
  assert.ok(require('../scripts/electron-asar-contract.cjs').REQUIRED_ELECTRON_ASAR_ENTRIES.includes('electron/agentTools.cjs'));
  const copy = {};
  vm.runInNewContext(ts.transpileModule(read('src/i18n/agentToolsCatalog.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: copy });
  assert.deepEqual(Object.keys(copy.agentToolsZh).sort(), Object.keys(copy.agentToolsEn).sort());
  assert.match(copy.agentToolsZh.saved, /不会自动配对/); assert.match(copy.agentToolsEn.saved, /does not pair/);
});

test('CLI compatibility recovery directs explicit review, never pin edits or replay of uncertain work', () => {
  const { creatorRecoveryForError } = require('../tools/zcanvas-cli/src/cli.cjs');
  for (const code of ['CREATIVE_CAPABILITY_GRAPH_DIGEST_MISMATCH', 'AGENT_MANIFEST_DIGEST_MISMATCH', 'AGENT_CONTROL_PROTOCOL_MISMATCH']) {
    const recovery = creatorRecoveryForError({ code });
    assert.match(recovery.whatFailed, /相同版本号不代表相同内容/);
    assert.match(recovery.nextActions[0], /明确审阅/);
    assert.match(recovery.nextActions[0], /不重交生成/);
    assert.doesNotMatch(recovery.existingWorkState, /未发起.*写入|没有.*付费/);
  }
});
