import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { MAI_IMAGE_CONTRACT as contract, buildMaiImageRequest, maiImageSettings } from '../src/utils/maiImage';
import { IMAGE_MODELS, isZhenzhenBudgetImageModel } from '../src/providers/models';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext';
import { historyImageBasicSettings } from '../src/utils/historyImageBasicSettings';
import { readHistoryBudgetImageInput } from '../src/utils/historyBudgetImageInput';
import historyContract from '../backend/src/shared/generationHistoryInputContract.json';
const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const sharp = require('sharp');
const authority = require('../backend/src/collaboration/runIntentAuthority.js');
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('Mai registry and channel remain isolated; original defaults unchanged', () => {
  assert.equal(IMAGE_MODELS[0].id, 'gpt-image-2');
  const definition = IMAGE_MODELS.find((entry) => entry.tabLabel === 'Mai')!;
  assert.equal(definition.id, contract.models[0]);
  assert.equal(definition.paramKind, 'mai-image');
  assert.equal(definition.maxReferenceImages, 5);
  assert.deepEqual(definition.apiModelOptions.map((item) => item.value), contract.models);
  for (const model of contract.models) assert.ok(isZhenzhenBudgetImageModel(model));
});

for (const model of contract.models) {
  test(`${model}: exact text whitelist and frontend/backend parity for presets/custom/auto`, async () => {
    const variants = [...contract.sizes.filter((size) => !size.startsWith('custom')).map((maiSize) => ({ maiSize })),
      { maiSize: 'custom_ratio', maiCustomRatio: '5:3', maiResolution: '2K' },
      { maiSize: 'custom_pixels', maiWidth: 1537, maiHeight: 1025, maiResolution: 'ignored' },
      { maiSize: 'custom_pixels', maiWidth: 0, maiHeight: 0, maiAutoAspectRatio: true, maiResolution: '2k' }];
    for (const settings of variants) {
      const request = buildMaiImageRequest(model, ' A blue teapot ', [], settings);
      const result = await provider.buildImagePayload({ ...request, seed: 42, quality: 'high', mask: 'unused', output_format: 'webp' }, 'fixture-key');
      assert.deepEqual(result.payload, request);
      assert.equal(result.taskType, 't2i');
      assert.doesNotMatch(JSON.stringify(result.payload), /seed|quality|mask|output_format|metadata/);
    }
    const long = 'x'.repeat(40_000);
    assert.equal((await provider.buildImagePayload(buildMaiImageRequest(model, long, [], {}), 'fixture-key')).payload.prompt, long);
  });
  test(`${model}: actual upload normalizes GIF/WebP to PNG, preserves duplicate/order and omits inactive sizing`, async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#39a' } }).png().toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    const gif = await sharp(png).gif().toBuffer();
    const refs = [webp, gif, webp, png, gif].map((buffer, index) => `data:image/${['webp', 'gif', 'webp', 'png', 'gif'][index]};base64,${buffer.toString('base64')}`);
    let uploads = 0;
    const request = buildMaiImageRequest(model, 'edit', refs, { maiSize: 'custom_pixels', maiWidth: 0, maiHeight: 0,
      maiResolution: 'unused', maiAutoAspectRatio: 'unused', maiWebGrounding: true });
    assert.deepEqual(Object.keys(request).sort(), ['images', 'model', 'n', 'prompt', 'web_grounding']);
    const result = await provider.buildImagePayload({ ...request, width: 0, height: 0, resolution: 'unused', auto_aspect_ratio: 'unused' }, 'fixture-key', {
      uploadIntervalMs: 0, uploadCacheTtlMs: 0, fetchImpl: async (url: string, init: any) => {
        assert.match(url, /\/v1\/files\/upload$/);
        const file = init.body.get('file');
        assert.equal(file.type, 'image/png'); assert.match(file.name, /\.png$/);
        const buffer = Buffer.from(await file.arrayBuffer());
        assert.equal((await sharp(buffer).metadata()).format, 'png');
        await sharp(buffer, { failOn: 'error' }).raw().toBuffer();
        return json({ url: `https://cdn.example.test/${++uploads}.png` });
      },
    });
    assert.equal(uploads, 5); assert.equal(result.taskType, 'i2i');
    assert.deepEqual(result.payload.images, Array.from({ length: 5 }, (_, i) => `https://cdn.example.test/${i + 1}.png`));
    assert.deepEqual(Object.keys(result.payload).sort(), ['images', 'model', 'n', 'prompt', 'web_grounding']);
  });
}

test('invalid frontend and backend inputs fail before any upload/submission', async () => {
  const model = contract.models[0];
  for (const settings of [{ maiSize: 'custom_ratio', maiCustomRatio: '5:1' }, { maiSize: 'custom_ratio', maiCustomRatio: '1.5:1' },
    { maiSize: 'custom_ratio', maiCustomRatio: '١:١' }, { maiSize: 'custom_ratio', maiCustomRatio: '0:1' },
    { maiSize: 'custom_pixels', maiWidth: 1537, maiHeight: 1536 }, { maiSize: 'custom_pixels', maiWidth: true },
    { maiSize: 'custom_pixels', maiWidth: 767 }, { maiResolution: '4k' }, { maiWebGrounding: 'true' }]) {
    assert.throws(() => buildMaiImageRequest(model, 'blue teapot', [], settings));
  }
  assert.throws(() => buildMaiImageRequest(model, ' ', [], {}));
  assert.throws(() => buildMaiImageRequest(model, 'blue', Array(6).fill('image'), {}));
  let calls = 0;
  const options = { fetchImpl: async () => { calls++; throw new Error('must not fetch'); } };
  for (const change of [{ prompt: '' }, { size: '1:5' }, { size: '1.5:1' }, { width: 768 },
    { size: '1536x1024', width: 768 }, { width: 767, height: 1024 }, { width: 1537, height: 1536 },
    { width: true, height: 768 }, { width: 768.5, height: 768 }, { n: 2 }, { n: true }, { resolution: '4k' },
    { web_grounding: 'false', images: ['image'] }, { images: Array(6).fill('image') }]) {
    await assert.rejects(provider.submitImageTask({ model, prompt: 'blue', ...change }, 'fixture-key', options));
    assert.equal(calls, 0);
  }
});

test('backend exact-pixel syntax and priority, all valid bounds including raw rounding', async () => {
  for (const size of ['1537x1025', '1537*1025', '1537×1025']) {
    const result = await provider.buildImagePayload({ model: contract.models[0], prompt: 'x', size, resolution: 'ignored' }, 'fixture-key');
    assert.deepEqual(result.payload, { model: contract.models[0], prompt: 'x', n: 1, web_grounding: false, width: 1536, height: 1024 });
  }
  const result = await provider.buildImagePayload({ model: contract.models[0], prompt: 'x', size: 'bad-hidden', width: 768, height: 3072 }, 'fixture-key');
  assert.equal(result.payload.height, 3072);
});

test('Mai uses original-task GET recovery and shared media timeout; ambiguous POST is not replayed', async () => {
  const { recoveryRequest } = require('../backend/src/services/runRecovery');
  for (const model of contract.models) {
    const recovery = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model, taskId: 'fixture-task' })!;
    assert.equal(recovery.kind, 'seedream-nz'); assert.equal(recovery.model, model);
    assert.ok(recovery.maxPolls! * recovery.pollIntervalMs! >= 900_000);
    assert.equal(recoveryRequest('http://127.0.0.1', recovery).options.method, 'GET');
    let posts = 0;
    await assert.rejects(provider.submitImageTask({ model, prompt: 'penguin' }, 'fixture-key', { fetchImpl: async (_url: string, init: any) => {
      assert.equal(init.method, 'POST'); posts++; throw new Error('socket closed after acceptance');
    } }));
    assert.equal(posts, 1);
    const queried = await provider.queryImageTask('fixture-task', 'fixture-key', { fetchImpl: async (url: string) => {
      assert.match(url, /\/v1\/image\/generations\/fixture-task$/);
      return json({ data: { status: 'SUCCESS', result_url: 'https://cdn.example.test/image.png' } });
    } });
    assert.equal(queried.status, 'succeeded'); assert.equal(queried.imageUrls.length, 1);
  }
});

test('all six workflows import with exact Run authority, correct credential preflight and no runtime secrets', () => {
  const { CASES } = require('../scripts/generate-mai-workflows.cjs');
  assert.equal(CASES.length, 6);
  for (const item of CASES) {
    const text = fs.readFileSync(new URL(`../docs/workflows/${item.id}.json`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /sk-|apiKey|taskId|https?:|imageUrls|signed/i);
    const fragment = workflowManifestToFragment(JSON.parse(text))!;
    const node = fragment.nodes.find((node) => node.id === 'generation')!;
    assert.deepEqual(authority.providerDeclarationForNode(node, fragment), { provider: 'seedance-nz', model: item.model });
    assert.equal(fragment.nodes.filter((node) => node.type === 'upload').length, item.references);
    const check = (budgetKey: string) => buildRunPreflightDiagnostics({ nodes: [node], edges: [], executionNodeIds: [node.id],
      projectId: 'isolated', settings: { zhenzhenApiKey: 'wrong-channel-key', zhenzhenSd2ApiKey: budgetKey, advancedProviders: [] } as any,
      assets: [], providersComplete: true, policy: null });
    assert.ok(check('').capability.some((notice) => notice.ruleId === 'provider.seedance-nz-credential-missing'));
    assert.ok(!check('fixture-key').capability.some((notice) => notice.ruleId.includes('credential-missing')));
  }
});

test('history faithfully restores Mai sizing/false values and does not invent absent settings', () => {
  const settings = { model: contract.models[0], apiModel: contract.models[1], aspectRatio: '', sizeLevel: '',
    imageBuiltinSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '', ...maiImageSettings({}) };
  const input = { schema: historyContract.imageSettingsContextSchema, origin: 'frontend-common-context', prompt: 'penguin', referenceImages: [], basicSettings: settings };
  assert.deepEqual(historyImageBasicSettings({ historyResolvedInput: input }), settings);
  assert.deepEqual(readHistoryBudgetImageInput({ historyResolvedInput: input }).settings, settings);
  assert.throws(() => readHistoryBudgetImageInput({ historyResolvedInput: { ...input,
    basicSettings: { ...settings, maiSize: 'custom_pixels', maiWidth: 0 } } }));
  for (const invalid of ['maiWidth', 'maiWebGrounding']) {
    assert.throws(() => historyImageBasicSettings({ historyResolvedInput: { ...input, basicSettings: { ...settings, [invalid]: 'invalid' } } }));
  }
  const legacy: any = { ...settings }; delete legacy.maiAutoAspectRatio;
  assert.equal(Object.hasOwn(historyImageBasicSettings({ historyResolvedInput: { ...input, basicSettings: legacy } })!, 'maiAutoAspectRatio'), false);
  assert.throws(() => readHistoryBudgetImageInput({ historyResolvedInput: { ...input, basicSettings: legacy } }));
});
