import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function listen(app: any) {
  return new Promise<any>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('Seedream NZ proxy uses the independent SD2 key and stores completed output locally', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-seedream-nz-route-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const validPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 220, g: 120, b: 40, alpha: 1 } },
  }).png().toBuffer();
  const secondValidPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 1 } },
  }).png().toBuffer();
  let mediaDownloads = 0;
  const mediaApp = express();
  mediaApp.get('/seedream-result.png', (_req, res) => {
    mediaDownloads += 1;
    res.type('image/png').send(validPng);
  });
  mediaApp.get('/seedream-result-2.png', (_req, res) => {
    mediaDownloads += 1;
    res.type('image/png').send(secondValidPng);
  });
  const mediaServer = await listen(mediaApp);
  const mediaUrl = `http://media.test:${mediaServer.address().port}/seedream-result.png?token=seedream-output-secret&signature=seedream-signature`;
  const secondMediaUrl = `http://media.test:${mediaServer.address().port}/seedream-result-2.png?token=seedream-output-secret-2&signature=seedream-signature-2`;
  t.after(() => mediaServer.close());
  const config = require('../backend/src/config.js');
  const oldConfig = { SETTINGS_FILE: config.SETTINGS_FILE, OUTPUT_DIR: config.OUTPUT_DIR };
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.OUTPUT_DIR = path.join(tmpDir, 'output');
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({
    zhenzhenApiKey: 'legacy-key-must-not-be-used',
    zhenzhenSd2ApiKey: 'sd2-image-key',
  }));
  t.after(() => Object.assign(config, oldConfig));

  const seedanceNz = require('../backend/src/providers/seedanceNz.js');
  const originals = {
    submitImageTask: seedanceNz.submitImageTask,
    queryImageTask: seedanceNz.queryImageTask,
    fetchRemote: seedanceNz.fetchRemote,
  };
  let submittedRequest: any;
  let submittedKey = '';
  seedanceNz.submitImageTask = async (request: any, apiKey: string) => {
    submittedRequest = request;
    submittedKey = apiKey;
    const isLayer = request.model?.endsWith('-layer-decomposition');
    return {
      taskId: isLayer ? 'seedream-layer-task-1' : 'seedream-nz-task-1',
      model: request.model || (request.images?.length ? 'seedream-v5-pro-i2i' : 'seedream-v5-pro-t2i'),
      taskType: isLayer ? 'layer-decomposition' : request.model?.endsWith('-i2i') || request.images?.length ? 'i2i' : 't2i',
      raw: { status: 'queued' },
    };
  };
  seedanceNz.queryImageTask = async (taskId: string) => taskId === 'seedream-layer-task-1'
    ? {
        status: 'succeeded',
        progress: '100%',
        imageUrl: mediaUrl,
        imageUrls: [mediaUrl, mediaUrl, secondMediaUrl],
        raw: { data: { status: 'SUCCESS' } },
      }
    : {
        status: 'succeeded',
        progress: '100%',
        imageUrl: mediaUrl,
        imageUrls: [mediaUrl, secondMediaUrl],
        raw: { data: { status: 'SUCCESS' } },
      };
  t.after(() => Object.assign(seedanceNz, originals));

  const proxyRouter = require('../backend/src/routes/proxy.js');
  const safeLookupHosts: string[] = [];
  proxyRouter._test.setProxySafeRemoteTestOptions({
    allowPrivateForTests: (hostname: string) => hostname === 'media.test',
    lookupImpl: async (hostname: string) => {
      safeLookupHosts.push(hostname);
      return [{ address: '127.0.0.1', family: 4 }];
    },
  });
  t.after(() => proxyRouter._test.setProxySafeRemoteTestOptions(null));
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api/proxy', proxyRouter);
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const submit = await fetch(`${base}/api/proxy/image/seedance-nz/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'change the reference image colors',
      images: ['/files/input/reference.png'],
      resolution: '1k',
      output_format: 'png',
    }),
  }).then((response) => response.json());

  assert.equal(submit.success, true);
  assert.equal(submit.data.taskId, 'seedream-nz-task-1');
  assert.equal(submit.data.taskProvider, 'seedance-nz-image');
  assert.equal(submittedKey, 'sd2-image-key');
  assert.deepEqual(submittedRequest.images, ['/files/input/reference.png']);

  const g2Submit = await fetch(`${base}/api/proxy/image/seedance-nz/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'zhenzhen-image-g2-t2i',
      prompt: 'a minimal green penguin app icon',
      images: [],
      resolution: '1k',
      ratio: '1:1',
    }),
  }).then((response) => response.json());
  assert.equal(g2Submit.success, true);
  assert.equal(g2Submit.data.model, 'zhenzhen-image-g2-t2i');
  assert.equal(submittedKey, 'sd2-image-key');
  assert.equal(submittedRequest.ratio, '1:1');

  const status = await fetch(`${base}/api/proxy/image/seedance-nz/status/seedream-nz-task-1`)
    .then((response) => response.json());
  assert.equal(status.success, true);
  assert.equal(status.data.status, 'completed');
  assert.equal(status.data.urls.length, 2);
  assert.match(status.data.urls[0], /^\/files\/output\/img_/);
  assert.match(status.data.urls[1], /^\/files\/output\/img_/);
  assert.equal(Object.hasOwn(status.data, 'remoteUrls'), false);
  assert.doesNotMatch(JSON.stringify(status), /seedream-output-secret|seedream-signature|media\.test/);
  for (const localUrl of status.data.urls) {
    assert.equal(fs.existsSync(path.join(config.OUTPUT_DIR, path.basename(localUrl))), true);
  }
  assert.equal(mediaDownloads, 2);
  assert.deepEqual(safeLookupHosts, ['media.test', 'media.test']);

  const layerSubmit = await fetch(`${base}/api/proxy/image/seedance-nz/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'seedream-v5-pro-layer-decomposition',
      prompt: '',
      images: ['/files/input/layer-source.png'],
      resolution: 'auto',
      output_format: 'png',
    }),
  }).then((response) => response.json());
  assert.equal(layerSubmit.success, true);
  assert.equal(layerSubmit.data.taskId, 'seedream-layer-task-1');
  assert.equal(submittedRequest.model, 'seedream-v5-pro-layer-decomposition');

  const dolaLayerSubmit = await fetch(`${base}/api/proxy/image/seedance-nz/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'dola-seedream-5.0-pro-layer-decomposition',
      prompt: '',
      images: ['/files/input/layer-source.png'],
      resolution: 'auto',
      output_format: 'png',
    }),
  }).then((response) => response.json());
  assert.equal(dolaLayerSubmit.success, true);
  assert.equal(dolaLayerSubmit.data.taskId, 'seedream-layer-task-1');
  assert.equal(dolaLayerSubmit.data.model, 'dola-seedream-5.0-pro-layer-decomposition');
  assert.equal(submittedRequest.model, 'dola-seedream-5.0-pro-layer-decomposition');

  for (const model of ['seedream-v5-flash-layer-decomposition', 'dola-seedream-5.0-flash-layer-decomposition']) {
    const flashLayer = await fetch(`${base}/api/proxy/image/seedance-nz/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, images: ['/files/input/layer-source.png'], prompt: '', resolution: 'auto', output_format: 'png' }),
    }).then((response) => response.json());
    assert.equal(flashLayer.success, true);
    assert.equal(flashLayer.data.model, model);
    assert.equal(flashLayer.data.taskProvider, 'seedance-nz-image');
    assert.equal(submittedRequest.model, model);
    assert.equal(submittedKey, 'sd2-image-key');
  }

  const layerStatus = await fetch(`${base}/api/proxy/image/seedance-nz/status/seedream-layer-task-1`)
    .then((response) => response.json());
  assert.equal(layerStatus.success, true);
  assert.equal(layerStatus.data.status, 'completed');
  assert.equal(layerStatus.data.outputCount, 3);
  assert.equal(layerStatus.data.urls.length, 3);
  assert.equal(new Set(layerStatus.data.urls).size, 3);
  for (const localUrl of layerStatus.data.urls) {
    assert.equal(fs.existsSync(path.join(config.OUTPUT_DIR, path.basename(localUrl))), true);
  }
  assert.equal(mediaDownloads, 5);
  assert.deepEqual(safeLookupHosts, ['media.test', 'media.test', 'media.test', 'media.test', 'media.test']);
});
