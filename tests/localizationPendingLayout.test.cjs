const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../src/components/nodes/LocalizationMasterNode.tsx');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const candidates = [];
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'div'
    && node.getText(source).includes("t('nodes.localization.running')")) candidates.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
const row = candidates.sort((a, b) => a.getText(source).length - b.getText(source).length)[0];
assert.ok(row, 'Production localization running status is missing');
const expression = ts.isBinaryExpression(row.parent) ? row.parent : row;
function render(running) {
  return vm.runInNewContext(ts.transpileModule(`result = (${expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, { running, React, Loader2: () => React.createElement('svg'), t: key => key });
}

test('localization reserves the same status-row geometry before and during pending Run creation', () => {
  const idle = render(false), pending = render(true);
  assert.ok(React.isValidElement(idle), 'An idle node must keep the status slot mounted before requestAction sets pending');
  assert.ok(React.isValidElement(pending));
  assert.equal(idle.type, pending.type);
  assert.equal(idle.props.className, pending.props.className);
  assert.match(idle.props.className, /\bh-6\b/);
  assert.match(idle.props.className, /\bshrink-0\b/);
  assert.equal(idle.props.role, 'status');
  assert.doesNotMatch(renderToStaticMarkup(idle), /nodes.localization.running/);
  assert.match(renderToStaticMarkup(pending), /nodes.localization.running/);
});
