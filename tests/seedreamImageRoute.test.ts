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

test('Seedream uses one synchronous JSON endpoint for text-to-image and image editing', async (t) => {
  const unicodeUserRoot = path.join(os.tmpdir(), 'Windows用户-自定义账户');
  fs.mkdirSync(unicodeUserRoot, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(unicodeUserRoot, 't8-seedream-image-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const validPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 40, g: 180, b: 120, alpha: 1 } },
  }).png().toBuffer();

  const upstreamCalls: any[] = [];
  const upstreamApp = express();
  upstreamApp.use(express.json({ limit: '4mb' }));
  upstreamApp.post('/v1/images/generations', (req, res) => {
    upstreamCalls.push({
      path: req.path,
      query: req.query,
      body: req.body,
      auth: req.header('authorization'),
    });
    res.json({
      data: [{ b64_json: validPng.toString('base64') }],
    });
  });
  const upstreamServer = await listen(upstreamApp);
  t.after(() => upstreamServer.close());

  const config = require('../backend/src/config.js');
  const oldConfig = {
    SETTINGS_FILE: config.SETTINGS_FILE,
    INPUT_DIR: config.INPUT_DIR,
    OUTPUT_DIR: config.OUTPUT_DIR,
    ZHENZHEN_BASE_URL: config.ZHENZHEN_BASE_URL,
  };
  t.after(() => Object.assign(config, oldConfig));
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.INPUT_DIR = path.join(tmpDir, '输入素材');
  config.OUTPUT_DIR = path.join(tmpDir, 'output');
  config.ZHENZHEN_BASE_URL = `http://127.0.0.1:${upstreamServer.address().port}`;
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenApiKey: 'sk-seedream-test' }));
  const localReferenceName = '参考图-衣服.png';
  fs.writeFileSync(path.join(config.INPUT_DIR, localReferenceName), validPng);

  const proxyRouter = require('../backend/src/routes/proxy.js');
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api/proxy', proxyRouter);
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const textToImage = await fetch(`${base}/api/proxy/image/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'seedream-v5-pro',
      apiModel: 'seedream-v5-pro',
      paramKind: 'seedream-v5',
      prompt: 'blue ceramic cup',
      size: '1024x1024',
      response_format: 'url',
      output_format: 'png',
    }),
  }).then((res) => res.json());

  assert.equal(textToImage.success, true);
  assert.equal(textToImage.data.sync, true);
  assert.match(textToImage.data.urls[0], /^\/files\/output\/img_/);
  const textToImageOutput = path.join(config.OUTPUT_DIR, path.basename(textToImage.data.urls[0]));
  assert.equal(fs.existsSync(textToImageOutput), true);
  assert.deepEqual(await sharp(textToImageOutput).metadata().then(({ width, height, format }) => ({ width, height, format })), {
    width: 2,
    height: 2,
    format: 'png',
  });
  assert.equal(upstreamCalls[0].path, '/v1/images/generations');
  assert.deepEqual(upstreamCalls[0].query, {});
  assert.equal(upstreamCalls[0].auth, 'Bearer sk-seedream-test');
  assert.deepEqual(upstreamCalls[0].body, {
    model: 'seedream-v5-pro',
    prompt: 'blue ceramic cup',
    size: '1024x1024',
    response_format: 'url',
    output_format: 'png',
  });

  const reference = `/files/input/${encodeURIComponent(localReferenceName)}`;
  const referenceDataUrl = `data:image/png;base64,${validPng.toString('base64')}`;
  const imageEdit = await fetch(`${base}/api/proxy/image/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'seedream-v5-pro',
      apiModel: 'seedream-v5-pro',
      paramKind: 'seedream-v5',
      prompt: 'make the cup red',
      size: '1280x960',
      response_format: 'url',
      output_format: 'jpeg',
      images: [reference],
    }),
  }).then((res) => res.json());

  assert.equal(imageEdit.success, true);
  assert.equal(imageEdit.data.sync, true);
  const imageEditOutput = path.join(config.OUTPUT_DIR, path.basename(imageEdit.data.urls[0]));
  assert.equal(fs.existsSync(imageEditOutput), true);
  assert.deepEqual(await sharp(imageEditOutput).metadata().then(({ width, height, format }) => ({ width, height, format })), {
    width: 2,
    height: 2,
    // The fixture intentionally returns PNG bytes for every requested output
    // format; this assertion verifies that those bytes were saved through the
    // Unicode parent path without pretending the test Provider re-encoded it.
    format: 'png',
  });
  assert.equal(upstreamCalls[1].path, '/v1/images/generations');
  assert.deepEqual(upstreamCalls[1].query, {});
  assert.deepEqual(upstreamCalls[1].body, {
    model: 'seedream-v5-pro',
    prompt: 'make the cup red',
    size: '1280x960',
    response_format: 'url',
    output_format: 'jpeg',
    image: [referenceDataUrl],
  });

  const invalidSize = await fetch(`${base}/api/proxy/image/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'seedream-v5-pro',
      apiModel: 'seedream-v5-pro',
      paramKind: 'seedream-v5',
      prompt: 'invalid custom size',
      size: 'wide',
    }),
  }).then((res) => res.json());

  assert.equal(invalidSize.success, false);
  assert.match(invalidSize.error, /Seedream 尺寸格式无效/);
  assert.equal(upstreamCalls.length, 2);
});

test('Seedream V5 synchronous generation uses the shared minimum fifteen-minute response deadline', () => {
  const source = fs.readFileSync(
    new URL('../backend/src/routes/proxy.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /SEEDREAM_V5_RESPONSE_DEADLINE_MS\s*=\s*normalizeProviderMediaTimeoutMs\([\s\S]*?T8_SEEDREAM_V5_RESPONSE_DEADLINE_MS/,
  );
  assert.match(
    source,
    /if \(paramKind === 'seedream-v5'\)[\s\S]*?fetchProviderResponse\([\s\S]*?deadlineMs:\s*SEEDREAM_V5_RESPONSE_DEADLINE_MS/,
  );
});
