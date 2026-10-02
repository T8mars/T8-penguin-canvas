import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SEEDREAM_NZ_FAMILIES, seedreamNzFamily, seedreamNzFamilyChange, seedreamNzRuntimeModel, seedreamNzValidation } from '../src/utils/seedreamNzContract';
import { SEEDREAM_LAYER_DECOMPOSITION_MODELS } from '../src/providers/models';
const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz');
const authority = require('../backend/src/collaboration/runIntentAuthority');
const { submitOnce, MODELS } = require('../scripts/verify-seedream-flash-live.cjs');
const image = 'data:image/png;base64,iVBORw0KGgo=';
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('Flash keeps legacy defaults, shares frontend/backend families and exact catalog paths', () => {
  assert.equal(seedreamNzFamily(undefined), 'domestic');
  assert.equal(seedreamNzFamily('__proto__'), 'domestic');
  assert.equal(seedreamNzRuntimeModel('domestic', 0), 'seedream-v5-pro-t2i');
  assert.equal(seedreamNzRuntimeModel('overseas', 2), 'dola-seedream-5.0-pro-i2i');
  assert.equal(seedreamNzRuntimeModel('overseas-flash', 0), 'dola-seedream-5.0-flash-t2i');
  assert.equal(seedreamNzRuntimeModel('overseas-flash', 2), 'dola-seedream-5.0-flash-i2i');
  assert.equal(seedreamNzRuntimeModel('domestic-flash', 0), 'seedream-v5-flash-t2i');
  assert.ok(MODELS.every((model: string) => provider.IMAGE_MODELS.has(model)));
  assert.deepEqual([...provider.SEEDREAM_LAYER_DECOMPOSITION_MODELS], [...SEEDREAM_LAYER_DECOMPOSITION_MODELS]);
});

for (const family of ['domestic-flash', 'overseas-flash'] as const) {
  test(`${family} accepts 5000-character prompts, 1.5k and exact custom dimensions without unrelated fields`, async () => {
    const built = await provider.buildImagePayload({ modelFamily: family, prompt: '🌟'.repeat(5000),
      resolution: '1.5k', output_format: 'jpeg', width: 8192, height: 8192, n: 99, ratio: '16:9', seed: 9 }, 'test');
    assert.deepEqual(built.payload, { model: SEEDREAM_NZ_FAMILIES[family].models[0], prompt: '🌟'.repeat(5000),
      metadata: { resolution: '1.5k', output_format: 'jpeg' } });
    assert.equal(seedreamNzValidation(family, '1.5k', built.payload.prompt, 0), null);
    for (const prompt of ['abcd', 'x'.repeat(5001)]) {
      await assert.rejects(provider.buildImagePayload({ modelFamily: family, prompt, resolution: '1k' }, 'test'), /5-5000/);
      assert.equal(seedreamNzValidation(family, '1k', prompt, 0)?.code, 'prompt');
    }
    const custom = await provider.buildImagePayload({ modelFamily: family, prompt: 'test image', size: '240x8192' }, 'test');
    assert.deepEqual(custom.payload.metadata, { width: 240, height: 8192, output_format: 'png' });
    await assert.rejects(provider.buildImagePayload({ modelFamily: family, prompt: 'test image', size: '239x8192' }, 'test'), /240-8192/);
  });
}

test('Pro constraints remain strict and family changes never silently normalize a saved 1.5k setting', async () => {
  await assert.rejects(provider.buildImagePayload({ prompt: 'x'.repeat(2001), resolution: '1k' }, 'test'), /5-2000/);
  await assert.rejects(provider.buildImagePayload({ prompt: 'test image', resolution: '1.5k' }, 'test'), /1k.*2k/);
  assert.equal(seedreamNzValidation('domestic', '1.5k', 'test image', 0)?.code, 'resolution');
  const updates: Record<string, unknown>[] = [];
  const event = { currentTarget: { value: 'overseas-flash' } };
  seedreamNzFamilyChange(event, (patch) => updates.push(patch));
  event.currentTarget.value = 'domestic';
  seedreamNzFamilyChange(event, (patch) => updates.push(patch));
  (event as any).currentTarget = null;
  assert.deepEqual(updates, [{ seedreamNzModelFamily: 'overseas-flash' }, { seedreamNzModelFamily: 'domestic' }]);
});

test('Dola Flash auto-switches from ordered references and enforces 30 MB without relaxing Pro', async () => {
  provider.resetCachesForTests();
  let uploads = 0;
  const fetchImpl = async () => response({ url: `https://cdn.example.com/ref-${++uploads}.png` });
  const built = await provider.buildImagePayload({ modelFamily: 'overseas-flash', prompt: 'edit this image',
    images: [image, `${image}AA`, image], resolution: '1.5k' }, 'test', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(built.model, 'dola-seedream-5.0-flash-i2i');
  assert.deepEqual(built.payload.images, ['https://cdn.example.com/ref-1.png', 'https://cdn.example.com/ref-2.png', 'https://cdn.example.com/ref-1.png']);
  const medium = `data:image/png;base64,${Buffer.alloc(11 * 1024 * 1024).toString('base64')}`;
  await assert.rejects(provider.buildImagePayload({ modelFamily: 'overseas', prompt: 'edit this image', images: [medium], resolution: '1k' }, 'test', { fetchImpl, uploadIntervalMs: 0 }), /过大|10/);
  assert.equal((await provider.buildImagePayload({ modelFamily: 'overseas-flash', prompt: 'edit this image', images: [medium], resolution: '1k' }, 'test', { fetchImpl, uploadIntervalMs: 0 })).payload.images.length, 1);
  const large = `data:image/png;base64,${Buffer.alloc(30 * 1024 * 1024 + 1).toString('base64')}`;
  await assert.rejects(provider.buildImagePayload({ modelFamily: 'overseas-flash', prompt: 'edit this image', images: [large], resolution: '1k' }, 'test', { fetchImpl, uploadIntervalMs: 0 }), /过大|30/);
  await assert.rejects(provider.buildImagePayload({ modelFamily: 'overseas-flash', prompt: 'edit this image', images: Array(11).fill(image), resolution: '1k' }, 'test'), /10/);
  await assert.rejects(provider.buildImagePayload({ model: 'dola-seedream-5.0-flash-t2i', modelFamily: 'domestic', prompt: 'test image', resolution: '1k' }, 'test'), /不匹配/);
  assert.equal((await provider.buildImagePayload({ modelFamily: 'domestic-flash', prompt: 'test image', images: [image], resolution: '1k' }, 'test', { fetchImpl, uploadIntervalMs: 0 })).model, 'seedream-v5-flash-i2i');
});

for (const model of ['seedream-v5-flash-layer-decomposition', 'dola-seedream-5.0-flash-layer-decomposition']) {
  test(`${model} retains the exact one-image optional-prompt layer contract`, async () => {
    const built = await provider.buildImagePayload({ model, images: [image], prompt: '', resolution: 'auto',
      output_format: 'png', n: 10, width: 1024, height: 1024, ratio: '1:1' }, 'test', {
      uploadIntervalMs: 0, fetchImpl: async () => response({ url: 'https://cdn.example.com/layer-source.png' }),
    });
    assert.deepEqual(built.payload, { model, images: ['https://cdn.example.com/layer-source.png'], metadata: { resolution: 'auto', output_format: 'png' } });
    await assert.rejects(provider.buildImagePayload({ model, images: [image, image] }, 'test'), /只能提供 1/);
    await assert.rejects(provider.buildImagePayload({ model, images: [image], prompt: 'x'.repeat(2001) }, 'test'), /2000/);
    const declared = authority.providerDeclarationForNode({ id: 'layer', type: 'image', data: { model: 'seedream-layer-decomposition', apiModel: model } }, { nodes: [], edges: [] });
    assert.deepEqual(declared, { provider: 'seedance-nz', model });
  });
}

test('authority selects Flash identity from family and actual references, not stale apiModel', () => {
  for (const [family, count] of [['overseas-flash', 0], ['overseas-flash', 1], ['domestic-flash', 0]] as const) {
    const node = { id: 'image', type: 'image', data: { model: 'seedream-v5-pro', apiModel: 'seedream-v5-pro',
      seedreamApiSource: 'seedance-nz', seedreamNzModelFamily: family, referenceImages: count ? [image] : [] } };
    const declaration = authority.providerDeclarationForNode(node, { nodes: [node], edges: [] });
    assert.deepEqual(declaration, { provider: 'seedance-nz', model: seedreamNzRuntimeModel(family, count) });
  }
});

test('verification resumes the original task and refuses ambiguous paid POST replay', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-flash-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  let submits = 0;
  const input = { model: MODELS[0], prompt: 'test image' };
  const file = path.join(temporary, 'state.json');
  const submit = async () => { submits++; return { model: MODELS[0], taskId: 'original-task' }; };
  assert.equal(await submitOnce(file, MODELS[0], input, submit), 'original-task');
  assert.equal(await submitOnce(file, MODELS[0], input, submit), 'original-task');
  assert.equal(submits, 1);
  await assert.rejects(submitOnce(file, MODELS[0], { ...input, prompt: 'different image' }, submit), /input changed/);
  const unknown = path.join(temporary, 'unknown.json');
  await assert.rejects(submitOnce(unknown, MODELS[0], input, async () => { submits++; throw new Error('connection reset'); }), /connection reset/);
  await assert.rejects(submitOnce(unknown, MODELS[0], input, submit), /refusing to replay/);
  assert.equal(submits, 2);
});

test('all six reusable workflows resolve the intended runtime model and contain no credentials or runtime output', () => {
  for (const model of MODELS) {
    const file = new URL(`../docs/workflows/${model}.json`, import.meta.url);
    const content = fs.readFileSync(file, 'utf8');
    const workflow = JSON.parse(content);
    const generation = workflow.nodes.find((item: any) => item.type === 'image');
    const references = workflow.nodes.filter((item: any) => item.type === 'upload').length;
    const resolved = authority.providerDeclarationForNode({ ...generation,
      data: { ...generation.data, referenceImages: references ? [image] : [] } }, { nodes: workflow.nodes, edges: workflow.edges });
    assert.deepEqual(resolved, { provider: 'seedance-nz', model });
    assert.equal(generation.data.reuseResult, false);
    assert.doesNotMatch(content, /sk-|apiKey|taskId|https?:|imageUrls|signed/i);
    assert.equal(workflow.nodeCount, workflow.nodes.length);
    assert.equal(workflow.edgeCount, workflow.edges.length);
  }
});
