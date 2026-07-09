import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function listen(app: any) {
  return new Promise<any>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function readProjectFile(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

test('web image reverse route uses ModelScope vision prompt and image generation without leaking keys', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-web-image-reverse-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const upstreamApp = express();
  upstreamApp.use(express.json({ limit: '8mb' }));
  const upstreamCalls: any[] = [];
  const remoteImageBytes = Buffer.from('REMOTE_SUNFLOWER_IMAGE');
  upstreamApp.get('/remote/sunflower.png', (_req, res) => {
    res.type('image/png').send(remoteImageBytes);
  });
  upstreamApp.post('/v1/chat/completions', (req, res) => {
    upstreamCalls.push({ path: req.path, body: req.body, auth: req.header('authorization') });
    res.json({ choices: [{ message: { content: 'cozy watercolor farm stall, soft morning light' } }] });
  });
  upstreamApp.post('/v1/images/generations', (req, res) => {
    upstreamCalls.push({ path: req.path, body: req.body, auth: req.header('authorization'), asyncMode: req.header('x-modelscope-async-mode') });
    res.json({ task_id: 'ms-task-1', task_status: 'PENDING' });
  });
  upstreamApp.get('/v1/tasks/ms-task-1', (req, res) => {
    upstreamCalls.push({ path: req.path, taskType: req.header('x-modelscope-task-type'), auth: req.header('authorization') });
    res.json({
      task_status: 'SUCCEED',
      output_images: ['data:image/png;base64,UE5HREFUQQ=='],
    });
  });
  const upstreamServer = await listen(upstreamApp);
  t.after(() => upstreamServer.close());

  const config = require('../backend/src/config.js');
  const oldConfig = {
    SETTINGS_FILE: config.SETTINGS_FILE,
    OUTPUT_DIR: config.OUTPUT_DIR,
    DEFAULT_LOCAL_SAVE_DIR: config.DEFAULT_LOCAL_SAVE_DIR,
    DEFAULT_CANVAS_AUTO_SAVE_DIR: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
    DEFAULT_RESOURCE_LIBRARY_DIR: config.DEFAULT_RESOURCE_LIBRARY_DIR,
    DEFAULT_THEME_TEMPLATE_DIR: config.DEFAULT_THEME_TEMPLATE_DIR,
  };
  t.after(() => Object.assign(config, oldConfig));
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.OUTPUT_DIR = path.join(tmpDir, 'output');
  config.DEFAULT_LOCAL_SAVE_DIR = path.join(tmpDir, 'save');
  config.DEFAULT_CANVAS_AUTO_SAVE_DIR = path.join(tmpDir, 'canvas');
  config.DEFAULT_RESOURCE_LIBRARY_DIR = path.join(tmpDir, 'resources');
  config.DEFAULT_THEME_TEMPLATE_DIR = path.join(tmpDir, 'themes');
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });

  const settingsRouter = require('../backend/src/routes/settings.js');
  const externalProvidersRouter = require('../backend/src/routes/externalProviders.js');
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/settings', settingsRouter);
  app.use('/api/proxy/external', externalProvidersRouter);
  const server = await listen(app);
  t.after(() => server.close());

  const base = `http://127.0.0.1:${server.address().port}`;
  const upstreamOrigin = `http://127.0.0.1:${upstreamServer.address().port}`;
  const upstreamBase = `${upstreamOrigin}/v1`;
  await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedProviders: [
        {
          id: 'modelscope',
          protocol: 'modelscope',
          enabled: true,
          baseUrl: upstreamBase,
          apiKey: 'ms-route-secret',
          imageModels: ['Tongyi-MAI/Z-Image-Turbo'],
          chatModels: ['Qwen/Qwen3-VL-235B-A22B-Instruct'],
          defaults: {
            imageModel: 'Tongyi-MAI/Z-Image-Turbo',
            chatModel: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
          },
        },
      ],
    }),
  }).then((res) => res.json());

  const result = await fetch(`${base}/api/proxy/external/web-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'data:image/png;base64,UE5HREFUQQ==',
      generateImage: true,
      size: '1024x1024',
      pollIntervalMs: 1,
      promptInstruction: '输出可直接用于文生图的中文提示词。',
    }),
  }).then((res) => res.json());

  assert.equal(result.success, true);
  assert.equal(result.data.prompt, 'cozy watercolor farm stall, soft morning light');
  assert.equal(result.data.imageUrls.length, 1);
  assert.match(result.data.imageUrls[0], /^\/files\/output\/external_/);
  assert.equal(fs.existsSync(path.join(config.OUTPUT_DIR, path.basename(result.data.imageUrls[0]))), true);
  assert.equal(JSON.stringify(result).includes('ms-route-secret'), false);

  assert.equal(upstreamCalls[0].path, '/v1/chat/completions');
  assert.equal(upstreamCalls[0].auth, 'Bearer ms-route-secret');
  assert.equal(upstreamCalls[0].body.model, 'Qwen/Qwen3-VL-235B-A22B-Instruct');
  assert.equal(upstreamCalls[0].body.messages[0].content[1].type, 'image_url');
  assert.match(upstreamCalls[0].body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(upstreamCalls[1].path, '/v1/images/generations');
  assert.equal(upstreamCalls[1].asyncMode, 'true');
  assert.equal(upstreamCalls[1].body.prompt, 'cozy watercolor farm stall, soft morning light');
  assert.equal(upstreamCalls[2].taskType, 'image_generation');

  const remoteCallStart = upstreamCalls.length;
  const remoteImageUrl = `${upstreamOrigin}/remote/sunflower.png`;
  const remoteResult = await fetch(`${base}/api/proxy/external/web-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: remoteImageUrl,
      generateImage: false,
      promptInstruction: '输出可直接用于文生图的中文提示词。',
    }),
  }).then((res) => res.json());

  assert.equal(remoteResult.success, true);
  assert.equal(remoteResult.data.sourceImageUrl, remoteImageUrl);
  assert.equal(upstreamCalls[remoteCallStart].path, '/v1/chat/completions');
  const remoteVisionUrl = upstreamCalls[remoteCallStart].body.messages[0].content[1].image_url.url;
  assert.match(remoteVisionUrl, /^data:image\/png;base64,/);
  assert.notEqual(remoteVisionUrl, remoteImageUrl);
  assert.equal(Buffer.from(remoteVisionUrl.split(',')[1], 'base64').toString(), remoteImageBytes.toString());
});

test('web image reverse route pins the qwen-web VL model and stops unreadable vision output', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-web-image-vl-pin-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const upstreamApp = express();
  upstreamApp.use(express.json({ limit: '8mb' }));
  const upstreamCalls: any[] = [];
  upstreamApp.post('/v1/chat/completions', (req, res) => {
    upstreamCalls.push({ path: req.path, body: req.body, auth: req.header('authorization') });
    res.json({ choices: [{ message: { content: '无法读取图片，未检测到可分析的图像数据。' } }] });
  });
  upstreamApp.post('/v1/images/generations', (req, res) => {
    upstreamCalls.push({ path: req.path, body: req.body, auth: req.header('authorization') });
    res.json({ task_id: 'should-not-run' });
  });
  const upstreamServer = await listen(upstreamApp);
  t.after(() => upstreamServer.close());

  const config = require('../backend/src/config.js');
  const oldConfig = {
    SETTINGS_FILE: config.SETTINGS_FILE,
    OUTPUT_DIR: config.OUTPUT_DIR,
    DEFAULT_LOCAL_SAVE_DIR: config.DEFAULT_LOCAL_SAVE_DIR,
    DEFAULT_CANVAS_AUTO_SAVE_DIR: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
    DEFAULT_RESOURCE_LIBRARY_DIR: config.DEFAULT_RESOURCE_LIBRARY_DIR,
    DEFAULT_THEME_TEMPLATE_DIR: config.DEFAULT_THEME_TEMPLATE_DIR,
  };
  t.after(() => Object.assign(config, oldConfig));
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.OUTPUT_DIR = path.join(tmpDir, 'output');
  config.DEFAULT_LOCAL_SAVE_DIR = path.join(tmpDir, 'save');
  config.DEFAULT_CANVAS_AUTO_SAVE_DIR = path.join(tmpDir, 'canvas');
  config.DEFAULT_RESOURCE_LIBRARY_DIR = path.join(tmpDir, 'resources');
  config.DEFAULT_THEME_TEMPLATE_DIR = path.join(tmpDir, 'themes');
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });

  const settingsRouter = require('../backend/src/routes/settings.js');
  const externalProvidersRouter = require('../backend/src/routes/externalProviders.js');
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/settings', settingsRouter);
  app.use('/api/proxy/external', externalProvidersRouter);
  const server = await listen(app);
  t.after(() => server.close());

  const base = `http://127.0.0.1:${server.address().port}`;
  const upstreamBase = `http://127.0.0.1:${upstreamServer.address().port}/v1`;
  await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedProviders: [
        {
          id: 'modelscope',
          protocol: 'modelscope',
          enabled: true,
          baseUrl: upstreamBase,
          apiKey: 'ms-route-secret',
          imageModels: ['Tongyi-MAI/Z-Image-Turbo'],
          chatModels: ['Qwen/Qwen3-235B-A22B', 'Qwen/Qwen3-VL-235B-A22B-Instruct'],
          defaults: {
            imageModel: 'Tongyi-MAI/Z-Image-Turbo',
            chatModel: 'Qwen/Qwen3-235B-A22B',
          },
        },
      ],
    }),
  }).then((res) => res.json());

  const response = await fetch(`${base}/api/proxy/external/web-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'data:image/png;base64,UE5HREFUQQ==',
      generateImage: true,
      model: 'Qwen/Qwen3-235B-A22B',
      chatModel: 'Qwen/Qwen3-235B-A22B',
    }),
  });
  const result = await response.json();

  assert.equal(result.success, false);
  assert.equal(result.code, 'unreadable_image_prompt');
  assert.equal(result.data.prompt, '');
  assert.equal(result.data.visionFailureText, '无法读取图片，未检测到可分析的图像数据。');
  assert.equal(upstreamCalls[0].body.model, 'Qwen/Qwen3-VL-235B-A22B-Instruct');
  assert.equal(upstreamCalls.some((call) => call.path === '/v1/images/generations'), false);
});

test('web image Chrome extension exposes image context menu and canvas send modes', () => {
  const manifest = JSON.parse(readProjectFile('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.2.0');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  assert.equal(manifest.background.service_worker, 'scripts/background.js');

  const background = readProjectFile('extension/scripts/background.js');
  assert.match(background, /contexts:\s*\[\s*['"]image['"]\s*\]/);
  assert.match(background, /t8WebImage\.showModal/);
  assert.match(background, /t8WebImage\.sendToCanvas/);
  assert.match(background, /t8WebImage\.reverseAndGenerate/);
  assert.match(background, /\/api\/proxy\/external\/web-image/);
  assert.match(background, /无法连接 T8 后端/);
  assert.match(background, /window\.postMessage\(\{\s*type:\s*['"]t8:web-image-result['"]/);
  assert.match(background, /postWebImageResultToLocalBridge/);
  assert.match(background, /type:\s*['"]t8:web-image-result['"]/);
  assert.match(background, /const CANVAS_MESSAGE_SOURCE = ['"]t8-web-image-extension['"]/);
  assert.match(background, /source:\s*CANVAS_MESSAGE_SOURCE/);
  assert.match(background, /\/api\/vibex-bridge\/messages/);
  assert.match(background, /sendToCanvas\(payload\)[\s\S]*findExistingCanvasTab\(\)[\s\S]*postWebImageResultToLocalBridge\(messagePayload\)[\s\S]*findOrOpenCanvasTab\(\)/);

  const content = readProjectFile('extension/scripts/content.js');
  assert.match(content, /__t8WebImageContentLoaded/);
  assert.match(content, /t8WebImage\.reverseAndGenerate/);
  assert.doesNotMatch(content, /fetch\(\s*absoluteBackendUrl\(\s*backendBase,\s*['"]\/api\/proxy\/external\/web-image/);
  assert.match(content, /data-send-mode="prompt"/);
  assert.match(content, /data-send-mode="image"/);
  assert.match(content, /data-send-mode="both"/);
  assert.match(content, /buildCanvasSendPayload/);
  assert.match(content, /if \(mode === 'prompt'\) payload\.prompt = prompt/);
  assert.match(content, /if \(mode === 'image'\) payload\.images = images/);
  assert.match(content, /if \(mode === 'both'\)/);
  assert.match(content, /readPromptFromTextarea/);
  assert.match(content, /addEventListener\('input'/);
  assert.match(content, /data-role="generate-image"/);
  assert.match(content, /t8WebImage\.generateImage/);
  assert.match(content, /用当前提示词生成图片/);

  assert.match(background, /t8WebImage\.generateImage/);
  assert.match(background, /\/api\/proxy\/external\/image/);
  assert.match(background, /t8WebImage\.importWebAssets/);
  assert.match(background, /\/api\/web-assets\/import/);
  assert.match(background, /mode:\s*['"]reference['"]/);

  const importer = readProjectFile('extension/scripts/importer.js');
  assert.match(importer, /collectPageImages/);
  assert.match(importer, /captureVisibleTab/);
  assert.match(importer, /fetchUrlsAsDataUrls/);
  assert.match(importer, /t8WebImage\.importWebAssets/);
  assert.match(readProjectFile('extension/popup.html'), /导入画布/);
  assert.match(readProjectFile('extension/popup.html'), /scripts\/importer\.js/);
  assert.match(readProjectFile('extension/sidepanel.html'), /导入画布/);
  assert.match(readProjectFile('extension/sidepanel.html'), /scripts\/importer\.js/);
});

test('Canvas accepts web image extension payloads as prompt and output material nodes', () => {
  const canvas = readProjectFile('src/components/Canvas.tsx');
  assert.match(canvas, /t8:web-image-result/);
  assert.match(canvas, /source:\s*['"]t8-web-image-extension['"]/);
  assert.match(canvas, /web-image-reverse/);
  assert.match(canvas, /importWebImagePayload/);
  assert.match(canvas, /\/api\/vibex-bridge\/pending/);
  assert.match(canvas, /WEB_IMAGE_EXTENSION_MESSAGE_CONTRACT\.type/);
  assert.match(canvas, /createOutputDataFromItems\('image'/);
  assert.match(canvas, /type:\s*'text'/);
  assert.match(canvas, /const includePromptInOutput = mode === 'both' && !!prompt/);
  assert.match(canvas, /if \(mode === 'prompt' && prompt\)/);
  assert.match(canvas, /\.\.\.\(includePromptInOutput\s*\?\s*\{/);
  assert.match(canvas, /mode === 'reference'/);
  assert.match(canvas, /type:\s*'upload'/);
  assert.match(canvas, /createUploadDataFromItems\('image', imageItems\)/);
});

test('Electron bridge web image payloads keep selected generation target behavior', () => {
  const canvas = readProjectFile('src/components/Canvas.tsx');
  assert.match(canvas, /const importWebImagePayload = useCallback/);
  assert.match(canvas, /node\.selected && node\.type === CREATIVE_TARGET_NODE_TYPE/);
  assert.match(canvas, /buildCreativeTargetResult\(\s*selectedTarget/);
  assert.match(canvas, /网页反推[\s\S]*结果已填入选中的生成目标框/);
  assert.match(canvas, /网页反推[\s\S]*提示词已写入选中的生成目标框/);
  assert.match(canvas, /message\?\.type === WEB_IMAGE_EXTENSION_MESSAGE_CONTRACT\.type/);
  assert.match(canvas, /importWebImagePayload\(message,\s*['"]网页反推['"]\)/);
});

test('web asset import route stores captured data URLs as local input files', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-web-assets-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const config = require('../backend/src/config.js');
  const oldConfig = {
    INPUT_DIR: config.INPUT_DIR,
  };
  t.after(() => Object.assign(config, oldConfig));
  config.INPUT_DIR = path.join(tmpDir, 'input');

  const webAssetsRouter = require('../backend/src/routes/webAssets.js');
  const app = express();
  app.use('/api/web-assets', webAssetsRouter);
  const server = await listen(app);
  t.after(() => server.close());

  const base = `http://127.0.0.1:${server.address().port}`;
  const result = await fetch(`${base}/api/web-assets/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [
        {
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          name: '网页参考图.png',
          pageUrl: 'https://example.com/gallery',
          pageTitle: 'Gallery',
        },
        {
          url: 'http://127.0.0.1/private.png',
          name: 'blocked.png',
        },
      ],
    }),
  }).then((res) => res.json());

  assert.equal(result.success, true);
  assert.equal(result.data.count, 1);
  assert.equal(result.data.failed, 1);
  assert.match(result.data.items[0].url, /^\/files\/input\/web_/);
  assert.equal(result.data.items[0].mime, 'image/png');
  assert.equal(result.data.items[0].pageUrl, 'https://example.com/gallery');
  assert.equal(fs.existsSync(path.join(config.INPUT_DIR, result.data.items[0].filename)), true);
  assert.match(result.data.items[1].error, /不允许|不安全|仅支持|失败/);
});
