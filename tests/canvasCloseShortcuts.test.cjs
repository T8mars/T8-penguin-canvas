'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const source = fs.readFileSync(require.resolve('../src/components/Canvas.tsx'), 'utf8');
  const begin = source.indexOf('    const clipboardHandledEvents = new WeakSet<KeyboardEvent>();');
  const end = source.indexOf("    window.addEventListener('keydown', onClipboardKeyCapture, true);", begin);
  assert.ok(begin > 0 && end > begin);
  const root = { inert: false }, calls = [], timers = [];
  const count = name => () => calls.push(name);
  const context = {
    document: { getElementById: () => root, querySelector: () => null },
    window: { clearTimeout() {}, setTimeout: callback => { timers.push(callback); return timers.length; } },
    shortcuts: new Proxy({}, { get: (_, key) => key }), matchesAnyShortcut: (key, event) => key === event.action,
    clipboardRef: { current: { nodes: [{}] } }, internalPasteTimerRef: { current: null },
    lastExternalMediaPasteRef: { current: null }, internalClipboardCopiedAtRef: { current: 0 },
    INTERNAL_NODE_PASTE_DELAY_MS: 50, EXTERNAL_MEDIA_PASTE_DEDUPE_MS: 1000,
    selectedCount: 1, nodes: [{ id: 'owned', selected: true, type: 'text' }],
    histUndo: count('undo'), histRedo: count('redo'), handleCopy: count('copy'), handlePaste: count('paste'),
    handleDuplicate: count('duplicate'), handleDeleteSelected: count('delete'), handleCreateGroup: count('group'), setNodes: count('select'),
  };
  const code = ts.transpileModule(`(() => { ${source.slice(begin, end)} return { onKey, onClipboardKeyCapture }; })()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const handlers = vm.runInNewContext(code, context);
  const fire = (action, capture = false, target = { tagName: 'BODY' }) => {
    const state = { prevented: false, stopped: false };
    handlers[capture ? 'onClipboardKeyCapture' : 'onKey']({ action, target,
      preventDefault() { state.prevented = true; }, stopImmediatePropagation() { state.stopped = true; } });
    return state;
  };
  return { root, calls, fire, drain: () => timers.splice(0).forEach(callback => callback()) };
}

for (const [action, capture] of [
  ['undo', false], ['redo', false], ['delete', false], ['duplicate', false], ['group', false], ['select-all', false],
  ['copy', true], ['paste-links', true], ['paste', true],
]) test(`actual canvas ${action} shortcut is held while root is inert and works after release`, () => {
  const f = fixture();
  f.root.inert = true; f.fire(`canvas.${action}`, capture); f.drain();
  assert.equal(f.calls.length, 0, 'close-saving UI must not accept a global command');
  f.root.inert = false; f.fire(`canvas.${action}`, capture); f.drain();
  assert.equal(f.calls.length, 1, 'normal shortcut remains functional');
});

test('a paste scheduled before close does not mutate the held canvas later', () => {
  const f = fixture(); f.fire('canvas.paste', true);
  f.root.inert = true; f.drain();
  assert.equal(f.calls.length, 0);
});

test('held keyboard capture stops library delete listeners, not only our own shortcut', () => {
  const f = fixture(); f.root.inert = true;
  assert.deepEqual(f.fire('canvas.delete', true), { prevented: true, stopped: true });
  assert.deepEqual(f.fire('unassigned-key', true), { prevented: true, stopped: true });
  f.root.inert = false;
  assert.deepEqual(f.fire('canvas.delete', true), { prevented: false, stopped: false });
});

test('active portal dialog keys pass the inert window gate without authorizing background commands', () => {
  const f = fixture(); f.root.inert = true;
  const dialog = { closest: () => null }, target = { tagName: 'BUTTON', closest: () => dialog };
  assert.deepEqual(f.fire('unassigned-key', true, target), { prevented: false, stopped: false });
  assert.deepEqual(f.fire('canvas.delete', true), { prevented: true, stopped: true });
  assert.deepEqual(f.calls, []);
});

test('external media paste is rejected before reading files while canvas is held', () => {
  const source = fs.readFileSync(require.resolve('../src/components/Canvas.tsx'), 'utf8');
  const begin = source.indexOf('    const onPaste = (e: ClipboardEvent) => {');
  const end = source.indexOf("    window.addEventListener('paste', onPaste, true);", begin);
  assert.ok(begin > 0 && end > begin);
  const root = { inert: true }; let collected = 0;
  const code = ts.transpileModule(`(() => { ${source.slice(begin, end)} return onPaste; })()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const handler = vm.runInNewContext(code, {
    document: { getElementById: () => root, querySelector: () => null },
    activeId: 'owned', isTextEditingTarget: () => false,
    collectCanvasMediaFiles: () => { collected++; return []; },
  });
  handler({}); assert.equal(collected, 0);
  root.inert = false; handler({}); assert.equal(collected, 1);
});
