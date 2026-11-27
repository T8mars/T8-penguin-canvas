import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import spec from '../backend/src/shared/seedTts3Contract.json';
import { SeedTts3Controls, seedTts3Request } from '../src/components/nodes/SeedTts3Controls';
import { SEED_AUDIO_MODELS } from '../src/providers/models';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import i18n from '../src/i18n';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz');
const recovery = require('../backend/src/services/runRecovery');
const listen = (app: any) => new Promise<any>(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const prompt = '请朗读这句话。';

test('Seed-TTS 3.0 forwards only documented fields and keeps the existing Seed Audio model order', async () => {
  assert.deepEqual(SEED_AUDIO_MODELS, ['doubao-seed-audio-1.0', 'doubao-voice-clone', 'doubao-seed-icl-2.0', spec.model]);
  const build = async (overrides: Record<string, unknown> = {}) => (
    await provider.buildAudioPayload({ model: spec.model, prompt, ...overrides }, 'fixture-only')
  ).payload;
  assert.deepEqual(await build(), { model: spec.model, prompt, metadata: { format: 'wav' } });
  for (const speed of [0.5, 1, 2]) {
    assert.deepEqual(await build({
      speed, voice: ' Sarah ', instructions: ' Calmly ', seed: 12, sampleRate: '16000', speaker: 'old',
    }), {
      model: spec.model, prompt, metadata: { format: 'wav', speed, voice: 'Sarah', instructions: 'Calmly' },
    });
  }
  const astral = '𠮷'.repeat(5000);
  assert.equal((await build({ prompt: astral })).prompt, astral);
  assert.equal((await build({ instructions: '𠮷'.repeat(1000) })).metadata.instructions.length, 2000);
  for (const patch of [
    { prompt: ' ' }, { prompt: astral + '字' }, { instructions: '字'.repeat(1001) },
    { speed: 0.49 }, { speed: 2.01 }, { speed: '1.1' }, { speed: null }, { speed: Infinity },
    { outputFormat: 'mp3' }, { images: ['fixture'] }, { audioUrls: ['fixture'] }, { videoUrls: ['fixture'] },
    { voice: 42 },
  ]) await assert.rejects(build(patch), { status: 400 });
});

test('Saved Seed-TTS workflow retains authority, controls, an audio output connection and no secret or task fields', async () => {
  const raw = fs.readFileSync(new URL('../docs/workflows/seed-tts-3-0.json', import.meta.url), 'utf8');
  assert.doesNotMatch(raw, /apiKey|https?:\/\/|taskId|sk-/i);
  const fragment = workflowManifestToFragment(JSON.parse(raw))!;
  const node = fragment.nodes.find(current => current.type === 'audio')!;
  assert.deepEqual(fragment.edges.map(edge => [edge.source, edge.sourceHandle, edge.target]), [['synthesis', 'audio-0', 'output']]);
  assert.deepEqual(require('../backend/src/collaboration/runIntentAuthority').providerDeclarationForNode(node, fragment), {
    provider: 'seedance-nz', model: spec.model,
  });
  const fields = require('../backend/src/shared/canvasNodeSchema.json').types.find((row: any) => row.type === 'audio').generation.allowedDataFields;
  assert.ok(fields.seedAudioModel.enum.includes(spec.model));
  for (const name of ['seedTts3Voice', 'seedTts3Instructions', 'seedTts3Speed']) assert.ok(fields[name]);
  const catalog = require('../backend/src/shared/creativeModelCatalog.json').audio.find((row: any) => row.model === spec.model);
  assert.equal(catalog.provider, 'seedance-nz');
  assert.equal(catalog.parameters.format, 'wav');
  assert.equal(catalog.parameters.maxOutputs, 1);
  assert.equal(catalog.parameters.supportsReference, false);
  const request = seedTts3Request(String(node.data.prompt), node.data);
  assert.deepEqual((await provider.buildAudioPayload(request, 'fixture-only')).payload.metadata, {
    voice: node.data.seedTts3Voice, instructions: node.data.seedTts3Instructions,
    speed: 1.1, format: 'wav',
  });
  for (const [lang, voiceLabel] of [['zh-CN', '音色短名'], ['en-US', 'Voice alias']]) {
    await i18n.changeLanguage(lang);
    const html = renderToStaticMarkup(createElement(SeedTts3Controls, { data: node.data, disabled: false, update() {} }));
    assert.ok(html.includes(voiceLabel));
    assert.match(html, /multi_female_sarah_v3_uranus_bigtts/);
    assert.match(html, /min="0.5" max="2"/);
    assert.doesNotMatch(html, /type="file"/);
  }
});

test('Production audio routes submit exactly once and cold recovery performs GET for the original model and saves identical WAV bytes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-seed-tts3-route-'));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('t8-seed-tts3-route-'));
  const config = require('../backend/src/config');
  const oldConfig = { SETTINGS_FILE: config.SETTINGS_FILE, OUTPUT_DIR: config.OUTPUT_DIR };
  Object.assign(config, { SETTINGS_FILE: path.join(directory, 'settings.json'), OUTPUT_DIR: path.join(directory, 'output') });
  fs.mkdirSync(config.OUTPUT_DIR);
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'offline-fixture-only' }));
  const wav = require('../backend/src/utils/pcmAudio').wrapPcm16MonoWav(Buffer.alloc(4800, 1), 24000);
  const media = express();
  media.get('/fixture.wav', (_req, res) => res.type('audio/wav').send(wav));
  const mediaServer = await listen(media);
  const resultUrl = `http://media.fixture.test:${mediaServer.address().port}/fixture.wav`;
  const originals = { submitAudioTask: provider.submitAudioTask, queryAudioTask: provider.queryAudioTask };
  const methods: string[] = [];
  provider.submitAudioTask = (body: any, key: string) => originals.submitAudioTask(body, key, {
    fetchImpl: async (url: string, init: RequestInit) => {
      assert.equal(new URL(url).pathname, '/v1/audio/generations');
      assert.equal(init.method, 'POST');
      methods.push('POST');
      assert.deepEqual(JSON.parse(String(init.body)), { model: spec.model, prompt, metadata: { format: 'wav' } });
      return Response.json({ task_id: 'fixture-fresh' });
    },
  });
  provider.queryAudioTask = (id: string, key: string, options: any) => {
    assert.equal(key, 'offline-fixture-only');
    assert.equal(options.model, spec.model);
    assert.ok(!options.outputFormat);
    return originals.queryAudioTask(id, key, { ...options, fetchImpl: async (url: string, init: RequestInit) => {
      assert.equal(new URL(url).pathname, `/v1/audio/generations/${id}`);
      assert.equal(init.method ?? 'GET', 'GET');
      methods.push('GET');
      return Response.json({ data: { status: 'SUCCESS', result_url: resultUrl } });
    } });
  };
  const router = require('../backend/src/routes/proxy');
  router._test.setProxySafeRemoteTestOptions({
    allowPrivateForTests: (host: string) => host === 'media.fixture.test',
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
  });
  const app = express();
  app.use(express.json());
  app.use('/api/proxy', router);
  const server = await listen(app);
  t.after(async () => {
    Object.assign(config, oldConfig);
    Object.assign(provider, originals);
    router._test.setProxySafeRemoteTestOptions(null);
    for (const owned of [server, mediaServer]) {
      owned.closeAllConnections();
      await new Promise<void>(resolve => owned.close(() => resolve()));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const submitted = await fetch(base + '/api/proxy/audio/seed-audio/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: spec.model, prompt }),
  });
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).data.taskId, 'fixture-fresh');
  const checkAudio = async (url: string) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.status, 'succeeded');
    assert.equal(data.model, spec.model);
    assert.equal(data.tracks.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(config.OUTPUT_DIR, path.basename(data.audioUrl))), wav);
  };
  await checkAudio(base + '/api/proxy/audio/seed-audio/status/fixture-fresh');
  const descriptor = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model: spec.model, taskId: 'fixture-cold', apiKey: 'not-stored' })!;
  assert.equal(descriptor.kind, 'seed-audio');
  assert.ok(descriptor.maxPolls * descriptor.pollIntervalMs >= 15 * 60_000);
  assert.doesNotMatch(JSON.stringify(descriptor), /not-stored/);
  const recovered = recovery.recoveryRequest(base, recovery.normalizeRunRecoveryDescriptor(descriptor));
  assert.equal(recovered.options.method, 'GET');
  assert.equal(new URL(recovered.url).searchParams.get('model'), spec.model);
  await checkAudio(recovered.url);
  assert.deepEqual(methods, ['POST', 'GET', 'GET']);
});
