import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const listen = (app: any) => new Promise<any>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
test('Doubao PCM route preserves every frame/order, remembered rate, GET-only cold recovery and rejects incomplete/error bytes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-doubao-audio-route-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = require('../backend/src/config');
  const old = { SETTINGS_FILE: config.SETTINGS_FILE, OUTPUT_DIR: config.OUTPUT_DIR };
  Object.assign(config, { SETTINGS_FILE: path.join(directory, 'settings.json'), OUTPUT_DIR: path.join(directory, 'output') });
  fs.mkdirSync(config.OUTPUT_DIR); fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'fixture-key-only' }));
  t.after(() => Object.assign(config, old));
  const pcm = Buffer.alloc(19200);
  for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(Math.round(Math.sin(offset * .02) * 5000), offset);
  pcm[0] = 0xff; pcm[1] = 0xe1; // a valid PCM sample, also a false MPEG sync signature
  const media = express();
  media.get('/sample.pcm', (_req, res) => res.type('application/octet-stream').send(pcm));
  media.get('/bad.pcm', (_req, res) => res.type('application/octet-stream').send(Buffer.alloc(3)));
  media.get('/error.pcm', (_req, res) => res.type('text/html').send('<html>upstream error</html>'));
  const mediaServer = await listen(media); t.after(() => mediaServer.close());
  const remote = `http://media.fixture.test:${mediaServer.address().port}`;
  const provider = require('../backend/src/providers/seedanceNz');
  const originals = { submitAudioTask: provider.submitAudioTask, queryAudioTask: provider.queryAudioTask };
  t.after(() => Object.assign(provider, originals));
  let posts = 0, queries = 0;
  provider.submitAudioTask = async (body: any) => {
    posts++;
    const { payload } = await provider.buildAudioPayload(body, 'fixture-key-only');
    return { taskId: 'pcm-route-task', model: payload.model, outputFormat: payload.metadata.format, sampleRate: payload.metadata.sample_rate };
  };
  provider.queryAudioTask = async (taskId: string, key: string, options: any) => {
    assert.equal(key, 'fixture-key-only'); assert.equal(options.model, 'doubao-seed-icl-2.0');
    assert.equal(options.outputFormat, 'pcm'); assert.equal(options.sampleRate, '48000'); queries++;
    const urls = taskId.includes('bad') ? [`${remote}/bad.pcm`] : taskId.includes('error') ? [`${remote}/error.pcm`]
      : [`${remote}/sample.pcm`, `${remote}/sample.pcm`, `${remote}/sample.pcm`];
    return originals.queryAudioTask(taskId, key, { ...options, fetchImpl: async () => new Response(JSON.stringify({ data: {
      status: 'SUCCESS', data: { content: { audio_urls: urls } },
    } }), { headers: { 'Content-Type': 'application/json' } }) });
  };
  const router = require('../backend/src/routes/proxy');
  router._test.setProxySafeRemoteTestOptions({ allowPrivateForTests: (host: string) => host === 'media.fixture.test', lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }] });
  t.after(() => router._test.setProxySafeRemoteTestOptions(null));
  const app = express(); app.use(express.json()); app.use('/api/proxy', router);
  const server = await listen(app); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/proxy/audio/seed-audio`;
  const submit = await fetch(`${base}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    model: 'doubao-seed-icl-2.0', prompt: 'Good morning.', speaker: 'FixtureSpeaker', doubaoVoice: { format: 'pcm', sample_rate: '48000' },
  }) }).then(res => res.json());
  assert.equal(submit.data.outputFormat, 'pcm'); assert.equal(submit.data.sampleRate, '48000');
  for (const query of ['pcm-route-task?model=doubao-voice-clone&sampleRate=8000', 'cold-route-task?model=doubao-seed-icl-2.0&outputFormat=pcm&sampleRate=48000']) {
    const response = await fetch(`${base}/status/${query}`); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.data.audioUrls.length, 3);
    assert.equal(new Set(body.data.audioUrls).size, 3);
    for (const url of body.data.audioUrls) {
      assert.match(url, /\.wav$/);
      const bytes = fs.readFileSync(path.join(config.OUTPUT_DIR, path.basename(url)));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt32LE(24), 48000);
      assert.deepEqual(bytes.subarray(44), pcm);
    }
  }
  for (const id of ['bad', 'error']) {
    const response = await fetch(`${base}/status/${id}?model=doubao-seed-icl-2.0&outputFormat=pcm&sampleRate=48000`);
    assert.equal(response.status, 502);
    const body = await response.json(); assert.equal(body.success, false); assert.ok(!body.data?.audioUrls?.length);
  }
  assert.equal(posts, 1); assert.equal(queries, 4);
});
