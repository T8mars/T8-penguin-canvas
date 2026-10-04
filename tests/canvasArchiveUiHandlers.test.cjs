const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/components/CanvasCatalogManager.tsx');
const source = fs.readFileSync(filename, 'utf8');
const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function compiled(expression, context) {
  return vm.runInNewContext(ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
}
function jsxHandler(tag, identity, name) {
  let found;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === tag && node.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === identity)) {
      const handler = node.attributes.properties.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === name);
      if (handler) found = handler.initializer.expression.getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(found); return found;
}
test('actual archive dialog keyboard handler cancels confirmation first and preserves IME Escape', () => {
  const expression = jsxHandler('div', 'data-canvas-manager', 'onKeyDown');
  for (const composing of [false, true]) {
    const changes = [], closes = [];
    const handler = compiled(`(${expression})`, { composing: { current: composing }, busy: null, confirmation: { id: 'fixture' }, setConfirmation: (value) => changes.push(value), onClose: () => closes.push(true) });
    let prevented = 0;
    handler({ key: 'Escape', nativeEvent: { isComposing: composing }, preventDefault: () => prevented++, stopPropagation() {} });
    assert.equal(closes.length, 0);
    assert.equal(changes.length, composing ? 0 : 1);
    assert.equal(prevented, composing ? 0 : 1);
  }
});
test('actual archive dialog focus trap excludes inert background controls', () => {
  const expression = jsxHandler('div', 'data-canvas-manager', 'onKeyDown');
  const focused = [];
  const control = (name, inert) => ({ name, getClientRects: () => [1], closest: () => inert, focus: () => focused.push(name) });
  const background = control('background', true), first = control('cancel', false), last = control('confirm', false);
  const context = { dialog: { current: { querySelectorAll: () => [background, first, last] } }, document: { activeElement: last } };
  const handler = compiled(`(${expression})`, context);
  handler({ key: 'Tab', shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(focused, ['cancel']);
  context.document.activeElement = first;
  handler({ key: 'Tab', shiftKey: true, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(focused, ['cancel', 'confirm']);
});
test('manager keeps application-owned confirmation, bounded virtual rows, and semantic theme tokens', () => {
  assert.doesNotMatch(source, /window\.confirm|--border-color|--bg-tertiary/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /limit: 50/);
  const initializers = {};
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ['start', 'end'].includes(node.name.getText(tree))) initializers[node.name.getText(tree)] = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const result = compiled(`const start = ${initializers.start}; ({ start, end: ${initializers.end} })`, { scroll: 440000, ROW: 88, OVERSCAN: 4, height: 760, items: { length: 10000 } });
  assert.ok(result.end - result.start <= 17);
  const restore = fs.readFileSync(path.resolve(__dirname, '../src/components/CanvasRestoreDialog.tsx'), 'utf8');
  assert.doesNotMatch(restore, /window\.confirm/); assert.match(restore, /operationId\.current/);
});

test('production canvas mutation handlers reject modal-background changes without swallowing dialog keyboard input', () => {
  const canvasFilename = path.resolve(__dirname, '../src/components/Canvas.tsx');
  const canvasSource = fs.readFileSync(canvasFilename, 'utf8');
  const canvasTree = ts.createSourceFile(canvasFilename, canvasSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = {};
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ['onNodesChange', 'onEdgesChange', 'onConnect', 'onClipboardKeyCapture'].includes(node.name.getText(canvasTree))) {
      handlers[node.name.getText(canvasTree)] = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0].getText(canvasTree) : node.initializer.getText(canvasTree);
    }
    ts.forEachChild(node, visit);
  };
  visit(canvasTree);
  const document = { getElementById: () => ({ inert: true }), querySelector: () => ({}) };
  for (const name of ['onNodesChange', 'onEdgesChange', 'onConnect']) {
    assert.ok(handlers[name]);
    // No mutation dependency is provided: an accidental call would fail.
    const handler = compiled(`(${handlers[name]})`, { document });
    handler(name === 'onConnect' ? { source: 'a', target: 'b' } : [{ type: 'remove', id: 'selected' }]);
  }
  const capture = compiled(`(${handlers.onClipboardKeyCapture})`, { document });
  capture({ key: 'Tab', preventDefault: () => assert.fail('dialog Tab swallowed'), stopImmediatePropagation: () => assert.fail('dialog input blocked') });
  assert.match(canvasSource, /\[data-canvas-restore="true"\]/);
});
