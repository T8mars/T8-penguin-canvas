const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');

test('canonical catalog stays bounded at 50/500/5000/10000 canvases with 90 percent archived; graph size is independent', { timeout: 180000 }, async () => {
  const measurements = [];
  for (const size of [50, 500, 5000, 10000]) {
    const database = new ProjectDatabase(':memory:', { autoBackup: false });
    try {
      // New synthetic projection fixtures only, never historical databases.
      // Bulk rows isolate catalog query cost from history-writing cost. This
      // benchmark does not claim migration/recovery or bulk-archive latency.
      const template = database.ensureCanvas('scale-00000', { name: 'Scale canvas 0', nodes: [], edges: [] });
      database.withProjectDatabaseWrite('test-only.catalog-scale', () => {
        const insert = database.db.prepare('INSERT INTO canvas_documents(canvas_id,project_id,schema_version,revision,snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
        for (let index = 1; index < size; index++) {
          const id = `scale-${String(index).padStart(5, '0')}`, now = template.updatedAt + index;
          const document = { ...template, canvasId: id, entityUid: randomUUID(), name: `Scale canvas ${index}`, updatedAt: now };
          insert.run(id, template.projectId, template.schemaVersion, 1, JSON.stringify(document), now, now);
        }
        const ids = database.db.prepare('SELECT canvas_id FROM canvas_directory ORDER BY canvas_id LIMIT ?').all(Math.floor(size * 0.9));
        // Fixture state, not a claim about bulk-archive interaction latency.
        for (const row of ids) database.db.prepare("UPDATE canvas_directory SET status='archived',archived_at=1,catalog_revision=catalog_revision+1 WHERE canvas_id=?").run(row.canvas_id);
      });
      const measure = (options) => {
        const start = performance.now(), result = database.listCanvasDirectoryPage(undefined, options);
        return { ms: performance.now() - start, result };
      };
      const cold = measure({});
      assert.equal(cold.result.counts.active, size - Math.floor(size * 0.9));
      assert.equal(cold.result.counts.archived, Math.floor(size * 0.9));
      assert.equal(cold.result.items.length, Math.min(50, cold.result.counts.active));
      assert.ok(Buffer.byteLength(JSON.stringify(cold.result)) < 32000);
      const warm = Array.from({ length: 10 }, () => measure({}).ms).sort((a, b) => a - b);
      const last = measure({ query: `scale-${String(size - 1).padStart(5, '0')}` });
      assert.equal(last.result.items.length, 1);
      const missing = measure({ query: 'not-a-fixture-name' });
      assert.equal(missing.result.items.length, 0);
      const archive = measure({ status: 'archived', sort: 'opened' });
      assert.equal(archive.result.items.length, Math.min(50, Math.floor(size * 0.9)));
      for (const page of [cold.result, last.result, archive.result]) assert.ok(page.items.every((item) => !Object.hasOwn(item, 'nodes') && !Object.hasOwn(item, 'snapshot_json')));
      const times = [cold.ms, warm[9], last.ms, missing.ms, archive.ms];
      assert.ok(times.every((ms) => ms < 1500), `bounded in-memory catalog read exceeded 1.5s: ${times}`);
      measurements.push({ canvases: size, archived: cold.result.counts.archived, coldMs: cold.ms, warmP95Ms: warm[9], lastSearchMs: last.ms, noMatchMs: missing.ms, archiveOpenedMs: archive.ms });
    } finally { await database.close(); }
  }
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    for (const size of [50, 500, 2000]) {
      const nodes = Array.from({ length: size }, (_, index) => ({ id: `graph-${index}`, type: 'text', position: { x: index * 20, y: 0 }, data: { prompt: `Fixture ${index}` } }));
      const canvas = database.ensureCanvas(`graph-${size}`, { name: `Graph ${size}`, nodes, edges: [] });
      const start = performance.now(), loaded = database.getCanvas(canvas.canvasId);
      const loadMs = performance.now() - start;
      assert.equal(loaded.nodes.length, size);
      assert.equal(database.listCanvasDirectoryPage(undefined, { query: `graph-${size}` }).items[0].nodeCount, size);
      assert.ok(loadMs < 1500);
      measurements.push({ graphNodes: size, backendLoadMs: loadMs });
    }
  } finally { await database.close(); }
  console.log('Synthetic backend-only scale measurements:', JSON.stringify(measurements));
});
