import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import express from 'express';
import { AGNES_VIDEO } from '../src/utils/agnesVideo';
import { advancedProviderModelOptions, resolveAdvancedProviderSelection } from '../src/utils/advancedProviders';
const require = createRequire(import.meta.url);
const { generateVideoWithProvider } = require('../backend/src/providers/adapters.js');
const { normalizeAdvancedProviders } = require('../backend/src/providers/registry.js');
const provider = { id: 'agnes', protocol: 'agnes', enabled: true, apiKey: 'test-only-key', baseUrl: 'https://apihub.agnes-ai.com/v1' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function request(input: any, result = { status: 'completed', url: 'https://cdn.example.com/result.mp4' }) {
  const calls: any[] = [];
  const output = await generateVideoWithProvider(provider, { prompt: 'penguin waves', model: AGNES_VIDEO.models[0], ...input }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return response(init.method === 'POST' ? { video_id: 'video-1', task_id: 'task-not-for-polling', status: 'queued' } : result);
    }, sleepImpl: async () => {}, maxPolls: 1,
  });
  return { output, calls };
}

test('Agnes 2.0 saved provider and node selection migrate without altering unrelated models', () => {
  const old = { ...provider, videoModels: [AGNES_VIDEO.retiredModel], defaults: { videoModel: AGNES_VIDEO.retiredModel } };
  const normalized = normalizeAdvancedProviders([old]).find((p: any) => p.id === 'agnes');
  assert.deepEqual(normalized.videoModels, AGNES_VIDEO.models);
  assert.equal(normalized.defaults.videoModel, AGNES_VIDEO.models[0]);
  assert.deepEqual(advancedProviderModelOptions(old as any, 'video'), AGNES_VIDEO.models);
  const selected = resolveAdvancedProviderSelection([old] as any, 'video', { providerId: 'agnes', providerSource: 'agnes', providerModel: AGNES_VIDEO.retiredModel });
  assert.equal(selected.available, true); assert.equal(selected.providerModel, AGNES_VIDEO.models[0]);
  assert.equal(old.videoModels[0], AGNES_VIDEO.retiredModel, 'read-time mapping does not mutate saved canvas');
  const custom = normalizeAdvancedProviders([{ ...old, id: 'agnes-custom' }]).find((p: any) => p.id === 'agnes-custom');
  assert.deepEqual(custom.videoModels, AGNES_VIDEO.models); assert.equal(custom.defaults.videoModel, AGNES_VIDEO.models[0]);
});

test('Agnes 2.5 complete ratio/tier/duration matrix uses only documented fields', async () => {
  for (const model of AGNES_VIDEO.models) for (const ratio of AGNES_VIDEO.ratios)
    for (const size of model.endsWith('flash') ? ['720P'] : AGNES_VIDEO.sizes) for (const duration of [4, 12]) {
      const { output, calls } = await request({ model, ratio, resolution: size, duration,
        providerParams: { width: 1920, height: 1080, frame_rate: 24, num_frames: 121, quality: 'bad' } });
      assert.equal(output.ok, true);
      assert.deepEqual(calls[0].body, { model, prompt: 'penguin waves', seconds: String(duration), mode: 'text', size, aspect_ratio: ratio });
      const query = new URL(calls[1].url); assert.equal(query.searchParams.get('video_id'), 'video-1');
      assert.equal(query.searchParams.get('model_name'), model);
      assert.equal(calls.filter(c => c.method === 'POST').length, 1);
    }
});

test('Agnes reference and keyframe modes preserve all media order, duplicates and video options', async () => {
  const images = ['https://cdn.example.com/a.png', 'https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'];
  const audios = ['https://cdn.example.com/a.mp3'];
  const videos = [{ url: 'https://cdn.example.com/a.mp4', start_seconds: 2, require_audio: true }];
  const result = await request({ images, audios, videos });
  assert.equal(result.output.ok, true); assert.equal(result.calls[0].body.mode, 'reference');
  assert.deepEqual(result.calls[0].body.images, images); assert.deepEqual(result.calls[0].body.audios, audios); assert.deepEqual(result.calls[0].body.videos, videos);
  const frames = await request({ images: [images[0], images[2]], providerParams: { mode: 'keyframe' } });
  assert.equal(frames.output.ok, true); assert.equal(frames.calls[0].body.first_frame, images[0]); assert.equal(frames.calls[0].body.last_frame, images[2]);
  assert.equal(frames.calls[0].body.images, undefined);
});

test('Agnes invalid combinations, excess and non-public references are rejected before POST', async () => {
  for (const input of [
    { duration: 3 }, { duration: 13 }, { duration: 4.5 }, { ratio: 'auto' }, { resolution: '1280x720' },
    { model: 'agnes-video-unknown' }, { model: 'agnes-video-2.5-flash', resolution: '1080P' },
    { model: 'agnes-video-2.5-flash', videos: ['https://cdn.example.com/a.mp4'] },
    { model: 'agnes-video-2.5-flash', images: Array(6).fill('https://cdn.example.com/a.png') },
    { images: Array(9).fill('https://cdn.example.com/a.png') }, { audios: Array(4).fill('https://cdn.example.com/a.mp3') },
    { providerParams: { mode: 'text' }, images: ['https://cdn.example.com/a.png'] },
    { providerParams: { mode: 'keyframe' } }, { providerParams: { mode: 'reference' } },
    { providerParams: { mode: 'invalid' } }, { videos: [{ url: 'https://cdn.example.com/a.mp4', require_audio: 'yes' }] },
    ...['/files/input/a.png', '/api/resources/file/a', 'data:image/png;base64,QUJD', 'http://127.0.0.1/a.png', 'http://[::1]/a.png', 'http://host.local/a.png', 'http://10.0.0.1/a.png'].map(url => ({ images: [url] })),
  ]) {
    const { output, calls } = await request(input);
    assert.equal(output.ok, false, JSON.stringify(input)); assert.equal(calls.length, 0);
    assert.equal(output.code, 'invalid_video_parameters');
  }
});

test('Agnes HTTP 400 detail and nested error are visible and never trigger POST retry', async () => {
  for (const body of [{ detail: 'width is a forbidden field' }, { error: { message: 'mode is required', code: 'invalid_request' } }]) {
    let count = 0;
    const output = await generateVideoWithProvider(provider, { model: 'agnes-video-2.5', prompt: 'hello' }, {
      fetchImpl: async () => { count++; return response(body, 400); },
    });
    assert.equal(output.ok, false); assert.match(output.error, /HTTP 400/); assert.match(output.error, /forbidden field|mode is required/);
    assert.equal(count, 1);
  }
});

test('Agnes ignores pending URLs and failure URLs, trusting public terminal status only', async () => {
  let polls = 0;
  const output = await generateVideoWithProvider(provider, { model: 'agnes-video-2.5', prompt: 'hello' }, {
    fetchImpl: async (_url: string, init: any) => {
      if (init.method === 'POST') return response({ video_id: 'video-1', status: 'queued', url: 'https://cdn.example.com/not-ready.mp4' });
      polls++; return response(polls === 1 ? { status: 'in_progress', url: 'https://cdn.example.com/not-ready.mp4' }
        : { status: 'completed', internal_status: 'pending', url: 'https://cdn.example.com/ready.mp4' });
    }, sleepImpl: async () => {}, maxPolls: 2,
  });
  assert.deepEqual(output.videoUrls, ['https://cdn.example.com/ready.mp4']); assert.equal(polls, 2);
  const failed = await request({}, { status: 'failed', url: 'https://cdn.example.com/invalid.mp4' });
  assert.equal(failed.output.ok, false);
});

test('Agnes production adapter performs real HTTP POST and original-video GET on independent random port', async t => {
  const app = express(); app.use(express.json()); const calls: any[] = [];
  app.post('/v1/videos', (req, res) => { calls.push(req.body); res.json({ video_id: 'http-video-1', task_id: 'different-task', status: 'queued' }); });
  app.get('/agnesapi', (req, res) => {
    assert.equal(req.query.video_id, 'http-video-1'); assert.equal(req.query.model_name, 'agnes-video-2.5');
    res.json({ status: 'completed', url: 'https://cdn.example.com/http.mp4' });
  });
  const server = await new Promise<any>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const result = await generateVideoWithProvider({ ...provider, baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
    { model: AGNES_VIDEO.retiredModel, prompt: 'legacy node', duration: 2, resolution: '480p' }, { sleepImpl: async () => {}, maxPolls: 1 });
  assert.equal(result.ok, true); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { model: 'agnes-video-2.5', prompt: 'legacy node', seconds: '4', mode: 'text', size: '720P', aspect_ratio: '16:9' });
});
