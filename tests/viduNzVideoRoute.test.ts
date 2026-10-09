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

test('Vidu proxy uses the domestic key and keeps task polling in its own authority scope', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-vidu-nz-route-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const config = require('../backend/src/config.js');
  const oldConfig = { SETTINGS_FILE: config.SETTINGS_FILE, OUTPUT_DIR: config.OUTPUT_DIR };
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.OUTPUT_DIR = path.join(tmpDir, 'output');
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({
    zhenzhenApiKey: 'legacy-key-must-not-be-used',
    zhenzhenSd2ApiKey: 'domestic-vidu-key',
  }));
  t.after(() => Object.assign(config, oldConfig));

  const seedanceNz = require('../backend/src/providers/seedanceNz.js');
  const originals = {
    submitViduTask: seedanceNz.submitViduTask,
    queryTask: seedanceNz.queryTask,
    queryViduTask: seedanceNz.queryViduTask,
  };
  let submittedRequest: any;
  let submittedKey = '';
  let queriedKey = '';
  seedanceNz.submitViduTask = async (request: any, apiKey: string) => {
    submittedRequest = request;
    submittedKey = apiKey;
    return { taskId: 'vidu-route-task-1', model: request.model, taskType: 't2v' };
  };
  seedanceNz.queryTask = async (_taskId: string, apiKey: string) => {
    queriedKey = apiKey;
    return { status: 'running', progress: 50, videoUrl: null, failReason: null };
  };
  t.after(() => Object.assign(seedanceNz, originals));

  const proxyRouter = require('../backend/src/routes/proxy.js');
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api/proxy', proxyRouter);
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const submit = await fetch(`${base}/api/proxy/video/vidu/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'vidu-q3-turbo-t2v',
      prompt: 'A paper bird takes flight under soft studio light',
      duration: 4,
      resolution: 'default',
      ratio: '16:9',
    }),
  }).then((response) => response.json());

  assert.equal(submit.success, true);
  assert.equal(submit.data.taskId, 'vidu-route-task-1');
  assert.equal(submittedKey, 'domestic-vidu-key');
  assert.equal(submittedRequest.model, 'vidu-q3-turbo-t2v');

  const status = await fetch(`${base}/api/proxy/video/vidu/status/vidu-route-task-1`)
    .then((response) => response.json());
  assert.equal(status.success, true);
  assert.equal(status.data.status, 'running');
  assert.equal(status.data.progress, '50');
  assert.equal(queriedKey, 'domestic-vidu-key');
  assert.doesNotMatch(JSON.stringify({ submit, status }), /domestic-vidu-key|legacy-key-must-not-be-used/);
  const coldQueries: any[] = [];
  seedanceNz.queryViduTask = async (taskId: string, apiKey: string, options: any) => {
    coldQueries.push({ taskId, apiKey, model: options.model });
    return { status: 'running', progress: 50, videoUrl: null, failReason: null };
  };
  for (const model of seedanceNz.VIDU_Q4_MODELS) {
    const cold = await fetch(`${base}/api/proxy/video/vidu/status/cold-${model}?model=${encodeURIComponent(model)}`)
      .then((response) => response.json());
    assert.equal(cold.success, true);
    assert.equal(cold.data.model, model);
    assert.equal(cold.data.status, 'running');
    assert.deepEqual(coldQueries.at(-1), { taskId: `cold-${model}`, apiKey: 'domestic-vidu-key', model });
    assert.doesNotMatch(JSON.stringify(cold), /domestic-vidu-key|legacy-key-must-not-be-used/);
  }
});
