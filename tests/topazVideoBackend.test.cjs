'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const provider = require('../backend/src/providers/seedanceNz');
const config = require('../backend/src/config');
const router = require('../backend/src/routes/proxy');
const { CreatorActionExecutor } = require('../backend/src/services/creatorActionExecutor');
const catalog = require('../backend/src/shared/creativeModelCatalog.json');
const contract = provider.TOPAZ_VIDEO_CONTRACT;
const listen = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};
const close = (server) => new Promise((resolve) => server.close(resolve));
function request(server, method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method,
      headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, body: JSON.parse(text), text }); });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-topaz-proxy-'));
  const prior = { SETTINGS_FILE: config.SETTINGS_FILE, OUTPUT_DIR: config.OUTPUT_DIR };
  const originalSubmit = provider.submitTopazVideoTask;
  const originalQuery = provider.queryTopazVideoTask;
  const settings = path.join(directory, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ zhenzhenSd2ApiKey: 'fixture-budget-secret' }));
  Object.assign(config, { SETTINGS_FILE: settings, OUTPUT_DIR: directory });
  router._test.setProxySafeRemoteTestOptions({ allowPrivateForTests: true, lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }] });
  const app = express();
  app.use(express.json());
  app.use('/api/proxy', router);
  const server = await listen(app);
  try { await run({ server, directory, settings }); }
  finally {
    provider.submitTopazVideoTask = originalSubmit;
    provider.queryTopazVideoTask = originalQuery;
    router._test.setProxySafeRemoteTestOptions(null);
    await close(server);
    Object.assign(config, prior);
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
test('Topaz real HTTP proxy keeps credential routing, original identity, ordered materialized results and completed-file reuse', async () => {
  const bytes = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb20=', 'base64');
  let downloads = 0;
  const mediaServer = await listen((_req, res) => { downloads++; res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length }); res.end(bytes); });
  try {
    await fixture(async ({ server, directory }) => {
      const id = `fixture-topaz-${Date.now()}`;
      let posts = 0;
      provider.submitTopazVideoTask = async (body, key) => {
        posts++;
        assert.equal(key, 'fixture-budget-secret');
        assert.equal(body.model, contract.model);
        return { taskId: id, model: contract.model, taskType: 'upscale', upstreamHttpStatus: 200 };
      };
      const remote = `http://127.0.0.1:${mediaServer.address().port}/output.mp4?signature=fixture-private`;
      provider.queryTopazVideoTask = async (taskId, key) => {
        assert.equal(taskId, id); assert.equal(key, 'fixture-budget-secret');
        return { status: 'succeeded', videoUrls: [remote, remote], videoUrl: remote, upstreamHttpStatus: 200 };
      };
      const submit = await request(server, 'POST', '/api/proxy/video/topaz/submit', { model: contract.model });
      assert.equal(submit.status, 200);
      assert.equal(submit.body.data.taskId, id);
      const first = await request(server, 'GET', `/api/proxy/video/topaz/status/${id}`);
      assert.equal(first.status, 200, first.text);
      assert.equal(first.body.data.videoUrls.length, 2);
      assert.ok(first.body.data.videoUrls.every((url) => url.startsWith('/files/output/vid_task_')));
      assert.doesNotMatch(first.text, /fixture-private|fixture-budget-secret|127\.0\.0\.1/);
      assert.equal(downloads, 2);
      for (const url of first.body.data.videoUrls) assert.ok(fs.existsSync(path.join(directory, path.basename(url))));
      await request(server, 'GET', `/api/proxy/video/topaz/status/${id}`);
      assert.equal(downloads, 2, 'subsequent polls reuse atomically completed outputs');
      assert.equal(posts, 1, 'status queries never submit');
    });
  } finally { await close(mediaServer); }
});
test('Topaz failed output cannot appear as success and does not leak remote URLs', async () => {
  await fixture(async ({ server }) => {
    provider.queryTopazVideoTask = async () => ({ status: 'succeeded', videoUrls: ['http://127.0.0.1/private.mp4?token=fixture-private'] });
    router._test.setProxySafeRemoteTestOptions(null);
    const response = await request(server, 'GET', `/api/proxy/video/topaz/status/blocked-${Date.now()}`);
    assert.equal(response.status, 502);
    assert.equal(response.body.success, false);
    assert.equal(response.body.data.videoUrl, null);
    assert.doesNotMatch(response.text, /fixture-private|fixture-budget-secret|127\.0\.0\.1/);
  });
});
test('Creator Topaz uses the exact adapter and original-task legacy query rather than generic Seedance', async () => {
  let submitted;
  let queried;
  const executor = new CreatorActionExecutor({ provider: {
    submitTopazVideoTask: async (body) => { submitted = body; return { taskId: 'fixture-task' }; },
    queryTopazVideoTask: async (id) => { queried = id; return { status: 'succeeded', videoUrls: ['https://cdn.example/a.mp4', 'https://cdn.example/a.mp4'] }; },
  } });
  const action = { type: 'video', prompt: 'must not be sent', parameters: { resolution: '2K', topazQuality: 'High' },
    modelSnapshot: { modelId: contract.model, providerId: 'seedance-nz', kind: 'video', catalogDigest: catalog.sourceDigest } };
  await executor.submit(action, 'fixture-key', {}, [{ kind: 'video', source: 'C:\\reference.mp4' }], catalog.video.find((item) => item.model === contract.model));
  assert.deepEqual(submitted, { model: contract.model, videos: ['C:\\reference.mp4'], resolution: '2K', quality: 'High' });
  const result = await executor.poll(action, 'fixture-task', 'fixture-key', {});
  assert.equal(queried, 'fixture-task');
  assert.equal(result.urls.length, 2);
});
