'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const discovery = require('../tools/zcanvas-cli/src/discovery.cjs');
const { compatibilitySnapshot } = require('../backend/src/services/agentControlCompatibility');
const compatibility = compatibilitySnapshot();
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'EXAMPLE_discovery_window_'));
  t.after(() => { const rel = path.relative(os.tmpdir(), root); assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel)); fs.rmSync(root, { recursive: true, force: true }); });
  const now = Date.now(), options = { env: { ZCANVAS_INSTANCE_DIR: root }, now };
  function put(id, heartbeatAt = now, extra = {}) { const file = path.join(root, id + '.json'); fs.writeFileSync(file, JSON.stringify({ ...compatibility, schema: discovery.INSTANCE_SCHEMA, instanceId: id, origin: 'http://127.0.0.1:19030', appVersion: '3.3.6', heartbeatAt: new Date(heartbeatAt).toISOString(), staleAfterMs: 20000, ...extra })); return file; }
  return { root, now, options, put };
}
test('expired files before the old 256-file window cannot hide a fresh running instance', t => {
  const f = fixture(t);
  for (let i = 0; i < discovery.INSTANCE_LIST_LIMIT + 40; i++) f.put('A' + String(i).padStart(42, '0'), f.now - 3600000);
  const id = 'z'.repeat(43); f.put(id);
  assert.deepEqual(discovery.readInstanceDescriptors(f.options).map(item => item.instanceId), [id]);
});
test('the fresh descriptor/probe window stays bounded without deleting old registry files', async t => {
  const f = fixture(t);
  for (let i = 0; i < discovery.INSTANCE_LIST_LIMIT + 5; i++) { const file = f.put('B' + String(i).padStart(42, '0')); fs.utimesSync(file, new Date(f.now + i), new Date(f.now + i)); }
  const filesBefore = fs.readdirSync(f.root).length; let probes = 0;
  const live = discovery.readInstanceDescriptors(f.options); assert.equal(live.length, discovery.INSTANCE_LIST_LIMIT); assert.ok(live.some(item => item.instanceId === 'B' + String(discovery.INSTANCE_LIST_LIMIT + 4).padStart(42, '0')));
  assert.deepEqual(await discovery.discoverInstances({ ...f.options, fetch: async () => { probes++; return new Response('', { status: 503 }); } }), []); assert.equal(probes, discovery.INSTANCE_LIST_LIMIT); assert.equal(fs.readdirSync(f.root).length, filesBefore);
});
test('a file growing between stat and open cannot bypass the file-size/read budget', t => {
  const f = fixture(t), file = f.put('C'.repeat(43)), open = fs.openSync, read = fs.readSync; let bytes = 0;
  fs.openSync = function(target, ...args) { if (target === file) fs.writeFileSync(file, 'x'.repeat(discovery.INSTANCE_FILE_LIMIT + 1)); return open.call(this, target, ...args); };
  fs.readSync = function(...args) { const count = read.apply(this, args); bytes += count; return count; };
  try { assert.deepEqual(discovery.readInstanceDescriptors(f.options), []); assert.equal(bytes, 0); } finally { fs.openSync = open; fs.readSync = read; }
});
test('stale but large descriptor populations cannot cause unbounded JSON reads', t => {
  const f = fixture(t); for (let i = 0; i < 280; i++) f.put('D' + String(i).padStart(42, '0'), f.now - 3600000, { ignored: 'x'.repeat(discovery.INSTANCE_FILE_LIMIT - 2000) });
  const read = fs.readSync; let bytes = 0;
  fs.readSync = function(...args) { const count = read.apply(this, args); bytes += count; return count; };
  try { assert.deepEqual(discovery.readInstanceDescriptors(f.options), []); assert.ok(bytes > 0 && bytes <= discovery.INSTANCE_READ_LIMIT); } finally { fs.readSync = read; }
});
test('overlarge registries fail explicitly before reading file contents', t => {
  const f = fixture(t), readdir = fs.readdirSync;
  fs.readdirSync = function(target, ...args) { return target === f.root ? Array(discovery.INSTANCE_ENTRY_LIMIT + 1).fill({ isFile: () => true, name: 'E'.repeat(43) + '.json' }) : readdir.call(this, target, ...args); };
  try { assert.throws(() => discovery.readInstanceDescriptors(f.options), error => error.code === 'INSTANCE_REGISTRY_LIMIT'); } finally { fs.readdirSync = readdir; }
});
