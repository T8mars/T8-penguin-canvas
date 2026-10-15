'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { extensionInfo, AssetIndexer } = require('../backend/src/services/assetIndexer');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');

test('Gaussian extensions enter the existing 3D asset category, without claiming a successful scene decode', () => {
  for (const extension of ['spz', 'ply', 'splat', 'ksplat']) assert.equal(extensionInfo(`scene.${extension}`).kind, 'model3d');
});
test('local world source pins use actual indexed bytes and preserve prior immutable content across replacement', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-world-asset-index-'));
  const database = new ProjectDatabase(path.join(directory, 'project.sqlite3'));
  t.after(async () => { await database.close(); const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('t8-world-asset-index-')); fs.rmSync(resolved, { recursive: true, force: true }); });
  const filename = path.join(directory, 'scene.ply'), bytes = Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n');
  fs.writeFileSync(filename, bytes);
  const indexer = new AssetIndexer({ DATA_DIR: directory, INPUT_DIR: directory, OUTPUT_DIR: path.join(directory, 'output') }, database);
  const options = { rootName: 'input', rootPath: directory, publicPrefix: '/files/input/', sourceNodeId: 'world', sourceNodeType: 'world-scene' };
  const first = await indexer.indexFile(filename, options), repeated = await indexer.indexFile(filename, options);
  assert.equal(first.kind, 'model3d'); assert.ok(first.id && first.entityUid); assert.equal(first.contentHash, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(first.id, repeated.id); assert.equal(first.metadata.previewStatus, 'unsupported', 'generic asset indexer is not the Gaussian renderer');
  assert.equal(first.availability, 'available', 'Locally indexed bytes are available; preview health is a separate decoder claim');
  fs.appendFileSync(filename, '\n'); const replacement = await indexer.indexFile(filename, options);
  assert.notEqual(replacement.id, first.id); assert.notEqual(replacement.contentHash, first.contentHash);
  assert.equal(database.getAsset(first.id).contentHash, first.contentHash);
});
