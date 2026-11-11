'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const tripo = require('../backend/src/providers/tripo3d');
const provider = require('../backend/src/providers/seedanceNz');
const URL = 'https://models.example/source.glb';
function minimal(item) {
  const request = { model: item.id, metadata: {} };
  if (item.group === 'generate') { if (item.mode === 'text') request.prompt = 'A toy robot'; else request.images = item.mode === 'multiview' ? ['front', 'left'] : ['front']; }
  else if (item.group === 'splat') request.images = ['front'];
  else if (item.id.endsWith('complete')) request.metadata.tripo_segment_task_id = 'native-tripo-fixture';
  else if (item.id.endsWith('smartsegment')) request.images = ['front'];
  else request.metadata.model_url = URL;
  if (item.group === 'texture') request.metadata.texture_prompt_text = 'red ceramic';
  if (item.id === 'tripo-retopology-v1') request.metadata.face_limit = 1000;
  return request;
}
test('all 25 documented models build without Hunyuan fields and retain their metadata contract', async () => {
  const api = await tripo.getContract(); assert.equal(api.models.length, 25); assert.equal(new Set(api.models).size, 25);
  for (const item of tripo.contract.models) {
    const request = minimal(item), built = api.build(request);
    assert.equal(built.model, item.id); assert.equal(built.payload.model, item.id);
    for (const old of ['face_count', 'generate_type', 'enable_pbr', 'seed']) assert.equal(old in built.payload, false);
    assert.equal(JSON.stringify(built.payload).includes('api_default'), false);
    if (item.mode === 'multiview') assert.deepEqual(built.payload.images, ['front', 'left']);
  }
});
test('model-dependent fields match native feature boundaries and never silently forward incompatible values', async () => {
  const api = await tripo.getContract();
  assert.equal(api.activeFields('tripo-h-v2.5-text-to-3d').includes('compress'), false);
  assert.equal(api.activeFields('tripo-p-p1-text-to-3d').includes('quad'), false);
  assert.equal(api.activeFields('tripo-p-p2-text-to-3d').includes('quad'), true);
  assert.equal(api.activeFields('tripo-texture-v2.5').includes('compress'), false);
  assert.throws(() => api.build({ model: 'tripo-texture-v2.5', metadata: { model_url: URL, texture_prompt_text: 'red', compress: 'geometry' } }), { code: 'unsupportedField' });
  assert.throws(() => api.build({ model: 'tripo-h-v3.1-text-to-3d', prompt: 'robot', images: ['unexpected'] }), { code: 'imageCount' });
});
test('multiview keeps duplicate slots and supports native task reuse without pictures', async () => {
  const api = await tripo.getContract(), model = 'tripo-h-v3.1-multiview-to-3d';
  assert.deepEqual(api.build({ model, images: ['same', 'left', 'same', 'right'] }).payload.images, ['same', 'left', 'same', 'right']);
  const reused = api.build({ model, metadata: { input_mode: 'multiviewTaskId', multiview_task_id: 'native-view-fixture' } });
  assert.equal('images' in reused.payload, false); assert.equal(reused.payload.metadata.multiview_task_id, 'native-view-fixture');
  assert.throws(() => api.build({ model, images: ['a'], metadata: { input_mode: 'multiviewTaskId', multiview_task_id: 'native' } }), { code: 'imageCount' });
  for (const count of [0, 1, 5]) assert.throws(() => api.build({ model, images: Array(count).fill('ref') }), { code: 'imageCount' });
});
test('face limits, seed omission, explicit false and part-generation dependencies are validated before upload', async () => {
  const api = await tripo.getContract(), model = 'tripo-p-p2-text-to-3d';
  const p = api.build({ model, prompt: 'robot', metadata: { texture: false, pbr: false, model_seed: 0, face_limit: 48, quad: false } }).payload;
  assert.equal(p.metadata.texture, false); assert.equal(p.metadata.pbr, false); assert.equal(p.metadata.model_seed, 0); assert.equal('texture_seed' in p.metadata, false);
  assert.equal(api.build({ model, prompt: 'robot', metadata: { texture_seed: -1 } }).payload.metadata, undefined);
  assert.throws(() => api.build({ model, prompt: 'robot', metadata: { quad: true, face_limit: 25001 } }), { code: 'faceLimit' });
  assert.throws(() => api.build({ model: 'tripo-h-v3.1-text-to-3d', prompt: 'robot', metadata: { generate_parts: true } }), { code: 'partsConflict' });
  assert.throws(() => api.build({ model: 'tripo-retopology-v1', metadata: { model_url: URL } }), { code: 'required' });
  assert.throws(() => api.build({ model, prompt: '🤖'.repeat(1025) }), { code: 'promptLength' });
  assert.equal(api.build({ model, prompt: '🤖'.repeat(1024) }).payload.prompt.length, 2048);
});
test('part names are case-sensitive, ordered, unique and cannot contain embedded commas', async () => {
  const api = await tripo.getContract();
  assert.deepEqual(api.partNames('[" Part_A ","part_a"]'), ['Part_A', 'part_a']);
  assert.deepEqual(api.partNames(' Part_B, Part_A '), ['Part_B', 'Part_A']);
  for (const v of [null, '', [], 'null']) assert.deepEqual(api.partNames(v), []);
  for (const v of [['a,a'], ['a', 'a'], [''], [1], 'bad,,name', ['x'.repeat(1025)]]) assert.throws(() => api.partNames(v), { code: 'invalidParts' });
});
test('retexturing binds individual views and segmentation reference suppresses conflicting options', async () => {
  const api = await tripo.getContract();
  const built = api.build({ model: 'tripo-texture-v3.0', images: ['front', 'left', 'back', 'right'], metadata: { model_url: URL, texture_prompt_mode: 'images', compress: 'geometry' } });
  assert.deepEqual(built.bindings.map(b => b.field), ['texture_front_image_url', 'texture_left_image_url', 'texture_back_image_url', 'texture_right_image_url']);
  assert.throws(() => api.build({ model: built.model, images: ['front'], metadata: { model_url: URL, texture_prompt_mode: 'images' } }), { code: 'required' });
  assert.equal(api.activeFields('tripo-mesh-segment-v2', { ref_image_url: 'https://images.example/ref.png' }).includes('segmentation_granularity'), false);
  assert.throws(() => api.build({ model: 'tripo-mesh-smartsegment', metadata: { seg_type: 'model', model_url: URL, transform: '1,2,3' } }), { code: 'invalidValue' });
});
test('compression is geometry string, not a boolean toggle; explicit disabling is omitted', async () => {
  const api = await tripo.getContract(), base = { model: 'tripo-h-v3.1-text-to-3d', prompt: 'robot' };
  assert.equal(api.build({ ...base, metadata: { compress: 'GEOMETRY' } }).payload.metadata.compress, 'geometry');
  assert.throws(() => api.build({ ...base, metadata: { compress: true } }), { code: 'invalidOption' });
  assert.equal(api.build({ ...base, metadata: { compress: false } }).payload.metadata, undefined);
});
test('typed primary role wins over URL suffix and outer mirror, while absent native IDs remain absent', () => {
  const record = { result_url: 'https://mirror.example/other', data: { content: { files: [{ name: 'renderedImageUrl', type: 'png', url: 'https://cdn.example/looks-like.glb' }, { name: 'modelUrl', type: 'glb', url: 'https://cdn.example/opaque' }] } } };
  const out = tripo.parseFiles(record); assert.equal(out.modelUrl, 'https://cdn.example/opaque'); assert.equal(out.tripoTaskId, ''); assert.equal(out.files.length, 2);
  assert.throws(() => tripo.parseFiles({ data: { content: { files: [{ name: 'modelUrl', type: 'png', url: URL }] } } }), /primary/);
});
test('all typed attachments survive materialization; failed primary downloads remain recoverable without generation', async () => {
  const result = { files: [{ name: 'renderedImageUrl', type: 'png', url: 'https://cdn.example/preview' }, { name: 'modelUrl', type: 'splat', url: 'https://cdn.example/main' }], tripoTaskId: 'native-fixture' };
  const calls = []; const out = await tripo.materialize(result, async (url, kind, key, options) => { calls.push({ kind, options }); return { url: '/files/output/' + kind + '.' + options.declaredFormat }; }, 'platform-fixture');
  assert.equal(out.files.length, 2); assert.match(out.modelUrl, /\.splat$/); assert.equal(out.tripoTaskId, 'native-fixture'); assert.equal(calls[1].options.declaredFormat, 'splat');
  assert.equal(await tripo.materialize(result, async () => ({ error: new Error('download') }), 'platform-fixture'), null);
});
test('actual submit adapter uses the shared contract and sends exactly one creation POST', async () => {
  let calls = 0, body;
  const result = await provider.submitHunyuan3dTask({ model: 'tripo-p-p1-text-to-3d', prompt: 'robot', metadata: { face_limit: 1000, texture: false, pbr: false } }, 'fixture-key', { fetchImpl: async (url, init) => { calls++; assert.match(url, /\/v1\/3d\/generations$/); body = JSON.parse(init.body); return new Response(JSON.stringify({ data: { task_id: 'platform-fixture' } }), { status: 200 }); } });
  assert.equal(calls, 1); assert.equal(result.taskId, 'platform-fixture'); assert.equal(body.metadata.face_limit, 1000); assert.equal('face_count' in body, false);
  calls = 0;
  await assert.rejects(provider.submitHunyuan3dTask({ model: 'tripo-image-to-splat', images: [] }, 'fixture-key', { fetchImpl: async () => { calls++; } }), { code: 'imageCount' });
  assert.equal(calls, 0);
});

test('query uses the typed result manifest and never substitutes the platform ID for native provenance', async () => {
  let calls = 0;
  const out = await provider.queryHunyuan3dTask('platform-fixture', 'fixture-key', { model: 'tripo-convert', fetchImpl: async url => {
    calls++; assert.match(url, /\/platform-fixture$/);
    return Response.json({ data: { status: 'SUCCESS', data: { content: { files: [{ name: 'modelUrl', type: 'zip', url: URL }] } } } });
  } });
  assert.equal(calls, 1); assert.equal(out.tripoTaskId, ''); assert.equal(out.files[0].type, 'zip');
});

test('a bad later reference is rejected before any upload or generation POST', async () => {
  const png = await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toBuffer();
  let calls = 0;
  await assert.rejects(provider.submitHunyuan3dTask({ model: 'tripo-h-v3.1-multiview-to-3d', images: ['data:image/png;base64,' + png.toString('base64'), 'data:image/png;base64,' + Buffer.from('broken').toString('base64')] }, 'fixture-key', { fetchImpl: async () => { calls++; throw Error('Should not upload'); } }));
  assert.equal(calls, 0);
});

test('model validation preserves archives and rejects CRC corruption, invalid GLB and Splat stride', async () => {
  const archive = new (require('yazl').ZipFile)(); archive.addBuffer(Buffer.from('v 0 0 0\nv 1 1 1\n'), 'model.obj'); archive.end(); const chunks = []; for await (const chunk of archive.outputStream) chunks.push(chunk); const buffer = Buffer.concat(chunks);
  assert.equal((await tripo.validateArtifact(buffer, 'glb')).format, 'zip');
  const corrupt = Buffer.from(buffer); const central = corrupt.indexOf(Buffer.from('504b0102', 'hex')); corrupt.writeUInt32LE(0, central + 16);
  await assert.rejects(tripo.validateArtifact(corrupt, 'zip'));
  await assert.rejects(tripo.validateArtifact(Buffer.from('not a glb'), 'glb'));
  await assert.rejects(tripo.validateArtifact(Buffer.alloc(31), 'splat'));
  assert.equal((await tripo.validateArtifact(Buffer.alloc(32), 'splat')).format, 'splat');
});

test('native result receipts bind bytes, model and original task, and reject tampering', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-tripo-receipt-'));
  try {
    const store = require('../backend/src/services/materializedOutputStore'), metadata = require('../backend/src/services/tripoMediaMetadata');
    const saved = store.commitMaterializedOutputBuffer({ outputDir: dir, buffer: Buffer.alloc(32), prefix: 'model3d', extension: 'splat', materializationKey: 'fixture' });
    const file = { name: 'modelUrl', type: 'splat', url: '/files/output/' + saved.filename }, result = { model: 'tripo-image-to-splat', tripoTaskId: 'native-fixture', partNames: [] };
    metadata.writeTripoMediaMetadata(dir, file, result, 'platform-fixture');
    assert.equal(metadata.readTripoMediaMetadata(dir, saved.filePath).tripoTaskId, 'native-fixture');
    assert.equal(metadata.readTripoMediaMetadata(dir, saved.filePath, saved.sha256, { kind: 'model3d', taskId: 'other', model: result.model }), null);
    fs.writeFileSync(saved.filePath, Buffer.alloc(32, 1)); assert.equal(metadata.readTripoMediaMetadata(dir, saved.filePath), null);
  } finally { const absolute = path.resolve(dir); assert.equal(path.dirname(absolute), path.resolve(os.tmpdir())); assert.ok(path.basename(absolute).startsWith('t8-tripo-receipt-')); fs.rmSync(absolute, { recursive: true, force: true }); }
});

test('recovery keeps every typed attachment, format and native ID; missing local primary remains pending', () => {
  const { normalizeRecoveryPayload, recoveryRequest } = require('../backend/src/services/runRecovery');
  const descriptor = { kind: 'model3d', model: 'tripo-image-to-splat', taskId: 'platform-fixture' };
  const result = normalizeRecoveryPayload({ status: 'completed', files: [{ name: 'modelUrl', type: 'splat', url: '/files/output/model.splat' }, { name: 'renderedImageUrl', type: 'png', url: '/files/output/preview.png' }], tripoTaskId: 'native-fixture', partNames: ['part'] }, descriptor);
  assert.equal(result.state, 'succeeded'); assert.equal(result.outputs.length, 2); assert.match(result.outputs[0].filename, /\.splat$/); assert.equal(result.outputs[0].metadata.tripoTaskId, 'native-fixture'); assert.equal(result.outputs[1].kind, 'image');
  assert.equal(normalizeRecoveryPayload({ status: 'completed', files: [] }, descriptor).state, 'pending');
  const query = recoveryRequest('http://127.0.0.1', descriptor); assert.equal(query.options.method, 'GET'); assert.match(query.url, /model=tripo-image-to-splat/);
});
