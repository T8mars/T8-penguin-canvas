import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function projectFile(file: string) {
  return path.resolve(process.cwd(), file);
}

function read(file: string) {
  return fs.readFileSync(projectFile(file), 'utf8');
}

function exists(file: string) {
  return fs.existsSync(projectFile(file));
}

async function listen(app: any) {
  return new Promise<any>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('local VibeX browser bridge queues sanitized result payloads and drains once', async (t) => {
  const route = require('../backend/src/routes/vibexBridge.js');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/vibex-bridge', route);
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = await fetch(`${base}/api/vibex-bridge/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 't8:vibex-result',
      source: 'vibex-workbench',
      payload: {
        messageId: 'vibex-web-1',
        videoUrl: 'https://cdn.example.com/result.mp4',
        imageUrls: ['https://cdn.example.com/cover.png'],
        prompt: '一只鸭子在池塘边跳舞',
        taskId: 'task-1',
        apiKey: 'should-not-survive',
        password: 'should-not-survive',
      },
    }),
  }).then((res) => res.json());

  assert.equal(post.success, true);
  assert.equal(post.data.messageId, 'vibex-web-1');
  assert.equal(post.data.queued, true);

  const duplicate = await fetch(`${base}/api/vibex-bridge/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 't8:vibex-result',
      source: 'vibex-workbench',
      payload: { messageId: 'vibex-web-1', videoUrl: 'https://cdn.example.com/result.mp4' },
    }),
  }).then((res) => res.json());
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.data.duplicate, true);

  const firstDrain = await fetch(`${base}/api/vibex-bridge/pending?limit=10`).then((res) => res.json());
  assert.equal(firstDrain.success, true);
  assert.equal(firstDrain.data.messages.length, 1);
  assert.equal(firstDrain.data.messages[0].type, 't8:vibex-result');
  assert.equal(firstDrain.data.messages[0].source, 'vibex-workbench');
  assert.deepEqual(firstDrain.data.messages[0].payload.videoUrls, ['https://cdn.example.com/result.mp4']);
  assert.deepEqual(firstDrain.data.messages[0].payload.imageUrls, ['https://cdn.example.com/cover.png']);
  assert.equal(firstDrain.data.messages[0].payload.prompt, '一只鸭子在池塘边跳舞');
  assert.equal(JSON.stringify(firstDrain).includes('should-not-survive'), false);

  const secondDrain = await fetch(`${base}/api/vibex-bridge/pending?limit=10`).then((res) => res.json());
  assert.equal(secondDrain.success, true);
  assert.equal(secondDrain.data.messages.length, 0);
});

test('local browser bridge also queues web image reverse payloads for Electron canvas', async (t) => {
  const route = require('../backend/src/routes/vibexBridge.js');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/vibex-bridge', route);
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = await fetch(`${base}/api/vibex-bridge/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 't8:web-image-result',
      source: 't8-web-image-extension',
      payload: {
        messageId: 'web-image-electron-1',
        mode: 'image',
        prompt: '不应该随发图片模式创建文本',
        images: ['https://cdn.example.com/generated.png'],
        sourceImageUrl: 'https://cdn.example.com/source.png',
        pageUrl: 'https://example.com/page',
        pageTitle: 'Example Page',
        apiKey: 'should-not-survive',
      },
    }),
  }).then((res) => res.json());

  assert.equal(post.success, true);
  assert.equal(post.data.messageId, 'web-image-electron-1');
  assert.equal(post.data.queued, true);

  const pending = await fetch(`${base}/api/vibex-bridge/pending?limit=10`).then((res) => res.json());
  assert.equal(pending.success, true);
  assert.equal(pending.data.messages.length, 1);
  assert.equal(pending.data.messages[0].type, 't8:web-image-result');
  assert.equal(pending.data.messages[0].source, 't8-web-image-extension');
  assert.equal(pending.data.messages[0].payload.mode, 'image');
  assert.deepEqual(pending.data.messages[0].payload.images, ['https://cdn.example.com/generated.png']);
  assert.equal(pending.data.messages[0].payload.prompt, '不应该随发图片模式创建文本');
  assert.equal(pending.data.messages[0].payload.sourceImageUrl, 'https://cdn.example.com/source.png');
  assert.equal(pending.data.messages[0].payload.pageUrl, 'https://example.com/page');
  assert.equal(JSON.stringify(pending).includes('should-not-survive'), false);
});

test('Chrome extension exposes a RunningHub VibeX bridge content script and backend fallback', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.version, '1.2.0');
  assert.ok(
    manifest.content_scripts.some((entry: any) =>
      entry.js?.includes('scripts/runninghub-bridge.js') &&
      entry.matches?.includes('https://vibex.runninghub.cn/*') &&
      entry.matches?.includes('https://www.runninghub.cn/*')
    ),
    'manifest must inject the RunningHub bridge script on VibeX and RunningHub pages',
  );

  assert.ok(exists('extension/scripts/runninghub-bridge.js'), 'missing RunningHub bridge content script');
  const bridge = read('extension/scripts/runninghub-bridge.js');
  assert.match(bridge, /t8:vibex-result/);
  assert.match(bridge, /vibex-workbench/);
  assert.match(bridge, /window\.addEventListener\(['"]message['"]/);
  assert.match(bridge, /addEventListener\(['"]t8:vibex-result['"]/);
  assert.match(bridge, /t8RunningHub\.forwardVibeXResult/);

  const background = read('extension/scripts/background.js');
  assert.match(background, /t8RunningHub\.forwardVibeXResult/);
  assert.match(background, /sendVibeXResultToCanvas/);
  assert.match(background, /postVibeXResultToLocalBridge/);
  assert.match(background, /\/api\/vibex-bridge\/messages/);
  assert.match(background, /type:\s*['"]t8:vibex-result['"]/);
  assert.match(background, /source:\s*['"]vibex-workbench['"]/);
});

test('Canvas drains local VibeX browser bridge messages and reuses VibeX node import logic', () => {
  const server = read('backend/src/server.js');
  assert.match(server, /vibexBridgeRouter/);
  assert.match(server, /\/api\/vibex-bridge/);

  const canvas = read('src/components/Canvas.tsx');
  assert.match(canvas, /importVibeXPayload/);
  assert.match(canvas, /\/api\/vibex-bridge\/pending/);
  assert.match(canvas, /handleVibeXMessage/);
  assert.match(canvas, /buildVibeXSendNodeSpecs/);
  assert.match(canvas, /registerPlacementShelfNodes\(assignedNewNodes,\s*['"]发送['"]\)/);
});

test('online VibeX integration is documented as a standalone code file', () => {
  assert.ok(exists('docs/vibex-online-send-to-t8-bridge.js'), 'missing standalone online VibeX bridge file');
  const doc = read('docs/vibex-online-send-to-t8-bridge.js');
  assert.match(doc, /postVibeXResultToT8/);
  assert.match(doc, /window\.parent\.postMessage/);
  assert.match(doc, /window\.opener\.postMessage/);
  assert.match(doc, /window\.postMessage/);
  assert.match(doc, /CustomEvent\(['"]t8:vibex-result['"]/);
  assert.match(doc, /t8:vibex-result/);
  assert.match(doc, /vibex-workbench/);
});
