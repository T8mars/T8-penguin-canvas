const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const choices = ['1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)',
  '3:4 (Portrait Standard)', '4:3 (Standard)', '9:16 (Portrait Widescreen)',
  '16:9 (Widescreen)', '21:9 (Ultrawide)'];

// Execute the production parser, including its real shared import after repair.
function parser(relative, name) {
  const filename = path.resolve(__dirname, '..', relative);
  const source = readFileSync(filename, 'utf8');
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = parsed.statements.filter((node) => ts.isFunctionDeclaration(node)
    || ts.isVariableStatement(node));
  const names = new Set([name, 'KNOWN_FIELD_OPTIONS', 'RH_TOOLBOX_KNOWN_FIELD_OPTIONS',
    'parseRhFieldData', 'normalizeRhOptionList', 'fieldOptionValue', 'getRhToolboxNodeInfoFieldName', 'cleanText']);
  const selected = declarations.filter((node) => ts.isFunctionDeclaration(node)
    ? names.has(node.name?.text)
    : node.declarationList.declarations.some((declaration) => names.has(declaration.name.getText(parsed))));
  const sharedPath = path.resolve(__dirname, '../src/utils/rhFieldOptions.ts');
  let shared = {};
  try {
    const exports = {};
    runInNewContext(ts.transpileModule(readFileSync(sharedPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports });
    shared = exports;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const javascript = ts.transpileModule(`${selected.map((node) => node.getText(parsed)).join('\n')}\nresult = ${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, ...shared };
  runInNewContext(javascript, context);
  return { parse: context.result, shared, source };
}

for (const [relative, name] of [
  ['src/components/nodes/RunningHubNode.tsx', 'extractFieldOptions'],
  ['src/components/nodes/RHToolsNode.tsx', 'extractFieldOptions'],
  ['src/utils/rhToolbox.ts', 'getRhToolboxNodeInfoFieldOptions'],
]) {
  test(`${relative}: exact RH choices survive JSON and ComfyUI combo envelopes`, () => {
    const { parse } = parser(relative, name);
    for (const fieldData of [choices, JSON.stringify(choices), [choices, {}], JSON.stringify([choices, { default: choices[0] }])]) {
      const actual = parse({ nodeId: '291', fieldName: 'aspect_ratio', fieldType: 'LIST', fieldData, fieldValue: choices[0] });
      assert.deepEqual(Array.from(actual || []), choices);
      assert.equal(actual.includes('21:9'), false);
    }
  });

  test(`${relative}: missing or numeric metadata never invents enum values`, () => {
    const { parse } = parser(relative, name);
    for (const fieldData of [undefined, 'not JSON', '["INT", {"min": 0, "max": 100}]']) {
      assert.equal(Boolean(parse({ fieldName: 'aspect_ratio', fieldType: 'TEXT', fieldData, fieldValue: '21:9 (Ultrawide)' })), false);
    }
    assert.deepEqual(Array.from(parse({ fieldName: 'quality', options: [{ label: 'Shown', value: 'EXACT' }] }) || []), ['EXACT']);
  });
}

test('RH submit validates authoritative enums without rewriting old canvas values', () => {
  const { shared } = parser('src/components/nodes/RunningHubNode.tsx', 'extractFieldOptions');
  const field = { fieldName: 'aspect_ratio', fieldType: 'LIST', fieldData: JSON.stringify([choices, {}]) };
  assert.equal(shared.resolveRhFieldValue(field, choices[7]), choices[7]);
  assert.throws(() => shared.resolveRhFieldValue(field, '21:9'), /select/i);
  assert.equal(shared.resolveRhFieldValue({ fieldName: 'aspect_ratio', fieldType: 'TEXT' }, 'custom'), 'custom');
  for (const relative of ['RunningHubNode.tsx', 'RHToolsNode.tsx']) {
    const source = readFileSync(path.resolve(__dirname, '../src/components/nodes', relative), 'utf8');
    assert.match(source, /fieldValue: resolveRhFieldValue\(it, submitVal/);
  }
});

test('single choices, labels, zero and numeric-looking string identity remain exact', () => {
  const { shared } = parser('src/components/nodes/RunningHubNode.tsx', 'extractFieldOptions');
  const field = { fieldName: 'quality', options: [0, '001', { label: 'User label', value: 'actual' }] };
  assert.deepEqual(Array.from(shared.extractRhFieldOptions(field)), [0, '001', 'actual']);
  assert.equal(shared.resolveRhFieldValue(field, '0'), 0);
  assert.throws(() => shared.resolveRhFieldValue(field, '1'), /select/i);
  assert.throws(() => shared.resolveRhFieldValue(field, 'User label'), /select/i);
  assert.deepEqual(Array.from(shared.extractRhFieldOptions({ fieldData: { options: ['only'] } })), ['only']);
  assert.equal(shared.extractRhFieldOptions({ options: [{ value: null, label: 'not a value' }] }), null);
});

for (const component of ['RunningHubNode.tsx', 'RHToolsNode.tsx']) {
  test(`${component}: actual production submit builder preserves the exact chosen value`, () => {
    const relative = `src/components/nodes/${component}`;
    const { shared, source } = parser(relative, 'extractFieldOptions');
    const parsed = ts.createSourceFile(component, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let builder;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'buildRawNodeInfoList') builder = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    assert.ok(builder);
    const context = {
      ...shared, extractFieldOptions: shared.extractRhFieldOptions,
      inferValueType: (type) => type === 'NUMBER' ? 'number' : 'text',
      paramKey: (id, name) => `${id}__${name}`,
      extractDefaultValue: (field) => field.fieldValue || '',
      collectUpstreamConfigList: () => [],
      resolveMediaMentions: () => { throw new Error('enum choices must not be interpolated'); },
      t: () => 'select an exact option',
    };
    runInNewContext(ts.transpileModule(`result = (${builder.getText(parsed)});`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    const field = { nodeId: '291', fieldName: 'aspect_ratio', fieldType: 'TEXT', fieldData: JSON.stringify([choices, {}]) };
    const data = context.result([field], { '291__aspect_ratio': { value: choices[7] } });
    assert.equal(data[0].fieldValue, '21:9 (Ultrawide)');
    assert.throws(() => context.result([field], { '291__aspect_ratio': { value: '21:9' } }), /select/);
    const numeric = context.result([{ nodeId: '2', fieldName: 'size', fieldType: 'NUMBER', options: ['001', '002'] }], { '2__size': { value: '001' } });
    assert.equal(numeric[0].fieldValue, '001');
    assert.equal(numeric[0].valueType, 'select', 'later upload resolution must not coerce an enum to a number');
  });
}
