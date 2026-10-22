import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { MOSS_IMAGE_CONTRACT as contract, buildMossImageRequest } from '../src/utils/mossImage';
import { IMAGE_MODELS, isZhenzhenBudgetImageModel } from '../src/providers/models';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext';
import { readHistoryBudgetImageInput } from '../src/utils/historyBudgetImageInput';
import historyContract from '../backend/src/shared/generationHistoryInputContract.json';
const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const sharp = require('sharp');
const authority = require('../backend/src/collaboration/runIntentAuthority.js');
const json = (data: any) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('Moss exact registry, independent tab and existing default unchanged', () => {
  const definition = IMAGE_MODELS.find((entry) => entry.id === contract.model)!;
  assert.equal(IMAGE_MODELS[0].id, 'gpt-image-2');
  assert.equal(definition.tabLabel, 'Moss Image'); assert.equal(definition.paramKind, 'moss-image');
  assert.deepEqual(definition.aspectRatios, contract.ratios); assert.equal(definition.defaultAspectRatio, '9:16');
  assert.deepEqual(definition.sizes, []); assert.equal(definition.defaultSize, '');
  assert.equal(definition.maxReferenceImages, 1); assert.ok(isZhenzhenBudgetImageModel(contract.model));
  assert.ok(provider.IMAGE_MODELS.has(contract.model));
});

test('all eight ratios and default map exactly to metadata.ratio; stale fields never leak', async () => {
  for (const ratio of [undefined, ...contract.ratios]) {
    const request = buildMossImageRequest(' A blue teapot ', [], ratio);
    const { payload, taskType } = await provider.buildImagePayload({ ...request,
      n: 4, seed: 123, size: '4k', resolution: '4k', output_format: 'webp', web_grounding: true }, 'fixture-key');
    assert.deepEqual(payload, { model: 'moss-image', prompt: 'A blue teapot', metadata: { ratio: ratio ?? '9:16' } });
    assert.equal(taskType, 't2i');
  }
  assert.equal((await provider.buildImagePayload({ model: 'moss-image', prompt: 'x' }, 'fixture-key')).payload.metadata.ratio, '9:16');
  assert.equal((await provider.buildImagePayload({ model: 'moss-image', prompt: 'x', metadata: { ratio: '21:9' } }, 'fixture-key')).payload.metadata.ratio, '21:9');
  const long = 'x'.repeat(40_000);
  assert.equal((await provider.buildImagePayload(buildMossImageRequest(long, []), 'fixture-key')).payload.prompt, long);
});

test('single reference is genuinely converted to PNG and uploaded; no extra fields', async () => {
  const png = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#39a' } }).png().toBuffer();
  for (const format of ['webp', 'gif']) {
    const buffer = await sharp(png).toFormat(format).toBuffer(); let calls = 0;
    const result = await provider.buildImagePayload(buildMossImageRequest('edit', [`data:image/${format};base64,${buffer.toString('base64')}`], '3:4'), 'fixture-key', {
      uploadIntervalMs: 0, uploadCacheTtlMs: 0, fetchImpl: async (url: string, init: any) => {
        calls++; assert.match(url, /\/v1\/files\/upload$/);
        const file = init.body.get('file'); assert.equal(file.type, 'image/png'); assert.match(file.name, /\.png$/);
        const actual = Buffer.from(await file.arrayBuffer());
        assert.equal((await sharp(actual).metadata()).format, 'png'); await sharp(actual, { failOn: 'error' }).raw().toBuffer();
        return json({ url: 'https://cdn.example.test/reference.png' });
      },
    });
    assert.equal(calls, 1); assert.equal(result.taskType, 'i2i');
    assert.deepEqual(result.payload, { model: 'moss-image', prompt: 'edit', metadata: { ratio: '3:4' }, images: ['https://cdn.example.test/reference.png'] });
  }
});

test('empty prompt, malformed references, overflow and invalid ratios fail before network', async () => {
  assert.throws(() => buildMossImageRequest(' ', []));
  assert.throws(() => buildMossImageRequest('edit', ['a', 'b']));
  assert.throws(() => buildMossImageRequest('edit', [], 'auto'));
  let calls = 0;
  for (const change of [{ prompt: '' }, { ratio: 'auto' }, { ratio: '9:16 ' }, { ratio: true },
    { images: ['a', 'b'] }, { images: [''] }, { images: [null] }, { images: 'a' }]) {
    await assert.rejects(provider.submitImageTask({ model: 'moss-image', prompt: 'x', images: ['ref'], ...change }, 'fixture-key', {
      fetchImpl: async () => { calls++; throw new Error('must not fetch'); },
    })); assert.equal(calls, 0);
  }
});

test('Moss accepted-task GET recovery and 15-minute floor; ambiguous POST not replayed', async () => {
  const { recoveryRequest } = require('../backend/src/services/runRecovery');
  const recovery = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model: 'moss-image', taskId: 'fixture-task' })!;
  assert.equal(recovery.kind, 'seedream-nz'); assert.equal(recovery.model, 'moss-image');
  assert.ok(recovery.maxPolls! * recovery.pollIntervalMs! >= 900_000);
  assert.equal(recoveryRequest('http://127.0.0.1', recovery).options.method, 'GET');
  let posts = 0;
  await assert.rejects(provider.submitImageTask({ model: 'moss-image', prompt: 'penguin' }, 'fixture-key', {
    fetchImpl: async (url: string, init: any) => {
      assert.match(url, /\/v1\/image\/generations$/); assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { model: 'moss-image', prompt: 'penguin', metadata: { ratio: '9:16' } });
      posts++; throw new Error('socket closed after acceptance');
    },
  })); assert.equal(posts, 1);
  for (const shape of [{ result_url: 'https://cdn.example.test/image.png' }, { data: { content: { image_url: 'https://cdn.example.test/image.png' } } },
    { data: { content: { image_urls: ['https://cdn.example.test/image.png'] } } }]) {
    const result = await provider.queryImageTask('fixture-task', 'fixture-key', { fetchImpl: async (url: string) => {
      assert.match(url, /\/v1\/image\/generations\/fixture-task$/); return json({ data: { status: 'SUCCESS', ...shape } });
    } }); assert.equal(result.status, 'succeeded'); assert.deepEqual(result.imageUrls, ['https://cdn.example.test/image.png']);
  }
});

test('three saved workflows import with exact authority, correct budget-key preflight and no secrets', () => {
  const { CASES, workflow } = require('../scripts/generate-moss-workflows.cjs'); assert.equal(CASES.length, 3);
  for (const item of CASES) {
    const text = fs.readFileSync(new URL(`../docs/workflows/${item.id}.json`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /sk-|apiKey|taskId|https?:|imageUrls|signed/i); assert.deepEqual(JSON.parse(text), workflow(item));
    const fragment = workflowManifestToFragment(JSON.parse(text))!;
    const node = fragment.nodes.find((node) => node.id === 'generation')!;
    assert.deepEqual(authority.providerDeclarationForNode(node, fragment), { provider: 'seedance-nz', model: 'moss-image' });
    assert.equal(fragment.nodes.filter((node) => node.type === 'upload').length, item.references);
    const check = (key: string) => buildRunPreflightDiagnostics({ nodes: [node], edges: [], executionNodeIds: [node.id],
      projectId: 'isolated', settings: { zhenzhenApiKey: 'wrong-channel-key', zhenzhenSd2ApiKey: key, advancedProviders: [] } as any,
      assets: [], providersComplete: true, policy: null });
    assert.ok(check('').capability.some((notice) => notice.ruleId === 'provider.seedance-nz-credential-missing'));
    assert.ok(!check('fixture-key').capability.some((notice) => notice.ruleId.includes('credential-missing')));
  }
});

test('history restores the exact ratio/channel and refuses incomplete or incompatible data', () => {
  const settings = { model: 'moss-image', apiModel: 'moss-image', aspectRatio: '21:9', sizeLevel: '',
    imageBuiltinSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '' };
  const input = { schema: historyContract.imageSettingsContextSchema, origin: 'frontend-common-context', prompt: 'penguin', referenceImages: ['reference'], basicSettings: settings };
  const read = (change = {}, extra = {}) => readHistoryBudgetImageInput({ historyResolvedInput: { ...input, ...extra, basicSettings: { ...settings, ...change } } });
  assert.deepEqual(read().settings, settings); assert.equal(read().media.length, 1);
  for (const change of [{ apiModel: 'mai-image-2-6' }, { aspectRatio: 'auto' }, { sizeLevel: '1K' }, { imageBuiltinSource: 'zhenzhen' }]) assert.throws(() => read(change));
  assert.throws(() => read({}, { referenceImages: ['a', 'b'] }));
  const missing: any = { ...settings }; delete missing.aspectRatio;
  assert.throws(() => readHistoryBudgetImageInput({ historyResolvedInput: { ...input, basicSettings: missing } }));
});
