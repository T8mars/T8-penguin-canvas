'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compatibilityPaths, compatibilitySnapshot } = require('../backend/src/services/agentControlCompatibility');

test('compatibility uses the encrypted packaged provider catalog while preserving ordinary-resource precedence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'EXAMPLE_compat_resources_'));
  t.after(() => { const rel = path.relative(os.tmpdir(), root); assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel)); fs.rmSync(root, { recursive: true, force: true }); });
  const encrypted = path.join(root, 'backend-enc', 'shared', 'creativeModelCatalog.json'), ordinary = path.join(root, 'backend', 'shared', 'creativeModelCatalog.json');
  const original = compatibilityPaths().providerCatalogPath, bytes = fs.readFileSync(original);
  fs.mkdirSync(path.dirname(encrypted), { recursive: true }); fs.writeFileSync(encrypted, bytes);
  assert.equal(compatibilityPaths({ resourcesPath: root }).providerCatalogPath, encrypted);
  assert.deepEqual(compatibilitySnapshot({ resourcesPath: root }), compatibilitySnapshot());
  fs.mkdirSync(path.dirname(ordinary), { recursive: true }); fs.writeFileSync(ordinary, bytes);
  assert.equal(compatibilityPaths({ resourcesPath: root }).providerCatalogPath, ordinary);
});
