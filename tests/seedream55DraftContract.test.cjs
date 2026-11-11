'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const contract = require('../backend/src/shared/seedream55DraftContract.json'), provider = require('../backend/src/providers/seedanceNz');
const api = async () => (await import('../backend/src/shared/seedream55DraftContract.mjs')).createSeedream55DraftContract(contract);
test('all six Seedream 5.5 identities have exact native metadata and source counts', async () => {
  const c = await api();
  for (const model of [...contract.imageModels, ...contract.layerModels]) {
    const images = model.endsWith('t2i') ? [] : ['source'], layer = model.endsWith('decomposition');
    const payload = c.buildImage({ model, images, prompt: layer ? '' : 'A blue toy robot' });
    assert.equal(payload.model, model); assert.equal(payload.metadata.resolution, layer ? 'auto' : '1k');
    assert.equal('seed' in payload, false); assert.equal('n' in payload, false);
    assert.equal(payload.metadata.output_format, 'png'); if (layer) assert.equal(payload.metadata.max_images, 30);
    assert.throws(() => c.buildImage({ model, images: layer ? [] : model.endsWith('t2i') ? ['wrong'] : [], prompt: 'A blue toy robot' }), { code: 'images' });
  }
});
test('5.5 custom pixel/ratio bounds, alpha and exclusive controls fail before uploads', async () => {
  const c = await api(), base = { model: contract.imageModels[0], prompt: 'A robot' };
  for (const size of ['240x240', '12000x1000', '11520x240', '3000x3000', '2048x0']) assert.throws(() => c.buildImage({ ...base, size }), { code: 'dimensions' });
  assert.equal(c.buildImage({ ...base, size: '11520x720' }).metadata.width, 11520);
  assert.throws(() => c.buildImage({ ...base, background: 'transparent', output_format: 'jpeg' }), { code: 'transparentPng' });
  assert.throws(() => c.buildImage({ ...base, max_images: 2 }), { code: 'unsupported' });
  assert.throws(() => c.buildImage({ model: contract.layerModels[0], images: ['source'], max_images: 101 }), { code: 'maxImages' });
  assert.throws(() => c.buildImage({ ...base, safety_identifier: 'x'.repeat(65) }), { code: 'identifier' });
});
test('draft enhancement submits only original ID, output format and last-frame option for either region', async () => {
  for (const model of contract.draftModels) {
    const built = await provider.buildSeedance25Payload({ model, draft_task_id: '  original-fixture  ', output_format: 'mov', return_last_frame: true }, 'fixture');
    assert.deepEqual(built.payload, { model, metadata: { draft_task_id: 'original-fixture', output_format: 'mov', return_last_frame: true } });
    for (const draft_task_id of ['', 'https://cdn.example/video.mp4', 'invalid id']) await assert.rejects(provider.buildSeedance25Payload({ model, draft_task_id }, 'fixture'), { code: 'draftId' });
    await assert.rejects(provider.buildSeedance25Payload({ model, draft_task_id: 'original', refImages: ['wrong'] }, 'fixture'), { code: 'draftReferences' });
  }
});
test('source draft is opt-in, forces 480p and preserves the old normal source defaults', async () => {
  const request = { model: 'seedance-2.5-standard-t2v', prompt: 'A toy robot', duration: 4, resolution: '720p' };
  const old = await provider.buildSeedance25Payload(request, 'fixture'), draft = await provider.buildSeedance25Payload({ ...request, draft: true }, 'fixture');
  assert.equal(old.payload.metadata.resolution, '720p'); assert.equal(old.payload.metadata.draft, undefined);
  assert.equal(draft.payload.metadata.draft, true); assert.equal(draft.payload.metadata.resolution, '480p');
  assert.equal(draft.payload.metadata.generate_audio, true);
});
test('production submission adapters run all six image identities, validate first and keep PNG alpha references', async () => {
  const png = await require('sharp')({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 255, alpha: .5 } } }).png().toBuffer();
  const source = 'data:image/png;base64,' + png.toString('base64');
  for (const model of [...contract.imageModels,...contract.layerModels]) {
    const images = model.endsWith('t2i') ? [] : [source], posts = [];
    const result = await provider.submitImageTask({ model, prompt: model.endsWith('decomposition') ? '' : 'A blue robot', images, resolution: '1k' }, 'fixture-key', { uploadIntervalMs: 0, fetchImpl: async (url, init) => {
      if (String(url).endsWith('/v1/files/upload')) { const bytes = Buffer.from(await init.body.get('file').arrayBuffer()); assert.equal((await require('sharp')(bytes).metadata()).hasAlpha, true); return Response.json({ url: 'https://cdn.example/ref.png' }); }
      posts.push(JSON.parse(init.body)); return Response.json({ task_id: 'fixture-' + model });
    } });
    assert.equal(result.model, model); assert.equal(posts.length, 1); assert.equal(posts[0].model, model); assert.equal(posts[0].metadata.seed, undefined);
  }
  let network = 0;
  await assert.rejects(provider.submitImageTask({ model: contract.imageModels[1], prompt: 'A blue robot', images: [source, 'data:image/png;base64,' + Buffer.from('corrupt').toString('base64')], resolution: '1k' }, 'fixture-key', { fetchImpl: async () => { network++; throw Error('No upload expected'); } }));
  assert.equal(network, 0);
});
test('typed 5.5 layer metadata follows every ordered output including repeated slots', async () => {
  const images = ['https://cdn.example/base.png','https://cdn.example/layer.png','https://cdn.example/layer.png'];
  const query = layers => provider.queryImageTask('fixture', 'fixture-key', { model: contract.layerModels[0], fetchImpl: async () => Response.json({ data: { model: contract.layerModels[0], status: 'SUCCESS', data: { content: { image_urls: images, ...(layers === undefined ? {} : { layers }) } } } }) });
  const result = await query(images.map((url, index) => ({ url, zindex: index, name: 'layer-' + index, arbitraryUnknownField: 'discard' })));
  assert.deepEqual(result.imageUrls, images); assert.deepEqual(result.layers.map(layer => layer.url), images); assert.equal(result.layers[0].arbitraryUnknownField, undefined);
  assert.equal((await query()).layers, undefined);
  await assert.rejects(query([{ url: images[1] }]), /metadata/);
});
test('video status preserves explicit draft identity and last frame, without fabricating a draft ID', async () => {
  const query = metadata => provider.queryTask('platform-fixture', 'fixture-key', { fetchImpl: async () => Response.json({ status: 'completed', metadata: { url: 'https://cdn.example/video.mp4', ...metadata } }) });
  assert.equal((await query({})).draftTaskId, '');
  const result = await query({ draft_task_id: 'draft-fixture', last_frame_url: 'https://cdn.example/frame.png' }); assert.equal(result.draftTaskId, 'draft-fixture'); assert.match(result.lastFrameUrl, /frame.png$/);
});
test('draft completion uses one creation POST and never adds text, media, sizing or audio fields', async () => {
  let calls = 0;
  const request = { model: contract.draftModels[1], draft_task_id: 'original-fixture', duration: 30, resolution: '4k', generate_audio: true };
  const result = await provider.submitTask(request, 'fixture-key', { fetchImpl: async (url, init) => { calls++; assert.match(url, /\/v1\/videos$/); const body = JSON.parse(init.body); assert.deepEqual(Object.keys(body).sort(), ['metadata','model']); assert.deepEqual(body.metadata, { draft_task_id: 'original-fixture', output_format: 'mp4', return_last_frame: false }); return Response.json({ id: 'new-fixture' }); } });
  assert.equal(calls, 1); assert.equal(result.model, request.model);
});
