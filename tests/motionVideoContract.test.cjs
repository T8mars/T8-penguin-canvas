'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMotionVideoPayload: build, normalizeMotionVideoResponse: normalize, sanitizeMotionMetadata, motionConnectionRef, contract } = require('../backend/src/providers/motionVideoContract');
const provider = require('../backend/src/providers/seedanceNz');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const result = (model = contract.models[0]) => ({ data: { status: 'SUCCESS', model, data: {
  status: 'succeeded', content: { video_url: 'https://media.example.test/a.mp4' },
  storyboard: { scenes: [{ id: 'scene-1', title: 'HELLO', duration: 5 }] }, fallback_scenes: ['scene-1'],
} } });

for (const model of contract.models) for (const duration of contract.durations) {
  test(`Motion exact request and omission: ${model}/${duration}`, () => {
    const built = build({ model, prompt: ' Hello ', duration, ratio: '9:16', resolution: '1080p',
      seconds: 6, seed: 3, width: 10, height: 20, metadata: { hidden: true },
      motion: { template_id: 'api_default', title: ' ', music: 'api_default', revise_from: 'stale', revision_instruction: 'stale' } });
    assert.deepEqual(built.payload, { model, prompt: 'Hello', duration, ratio: '9:16', resolution: '1080p' });
    assert.equal(built.operation, 'generate');
  });
}
test('Motion preserves ordered keywords and documented templates, rejects invalid input before transport', async () => {
  const built = build({ prompt: 'hello', motion: { template_id: 'voxel-world', music: 'auto', keywords: ['a,b', 'c', 'a,b'], language: 'en' } });
  assert.deepEqual(built.payload.motion, { language: 'en', template_id: 'voxel-world', music: 'auto', keywords: ['a,b', 'c', 'a,b'] });
  let calls = 0;
  for (const invalid of [{ duration: '15' }, { duration: 5 }, { ratio: 'auto' }, { resolution: '4K' }, { model: 'other' },
    { operation: 'revise', motion: {} }, { motion: { keywords: 'a,b' } }, { motion: { music: 'off' } },
    { motion: { assets: ['/api/resources/file/x'] } }, { motion: { template_id: 'invented' } }]) {
    await assert.rejects(provider.submitMotionVideoTask({ prompt: 'hello', ...invalid }, 'fixture-key', { fetchImpl: async () => { calls++; return json({}); } }));
  }
  assert.equal(calls, 0);
});
test('Motion success requires all wrapper states completed, exact model and all ordered results', () => {
  const response = result();
  response.data.data.content.video_urls = ['https://media.example.test/b.mp4', 'https://media.example.test/a.mp4', 'https://media.example.test/b.mp4'];
  const parsed = normalize(response, { model: contract.models[0] });
  assert.equal(parsed.status, 'succeeded');
  assert.deepEqual(parsed.videoUrls, response.data.data.content.video_urls);
  assert.deepEqual(parsed.motionResult.fallbackScenes, ['scene-1']);
  assert.equal(parsed.motionResult.storyboard.scenes[0].title, 'HELLO');
  for (const state of ['preview_ready', 'rendering', 'coding']) {
    response.data.data.status = state;
    assert.equal(normalize(response).status, 'pending');
    assert.deepEqual(normalize(response).videoUrls, []);
  }
  response.data.data.status = 'succeeded'; response.data.status = 'IN_PROGRESS';
  assert.equal(normalize(response).status, 'pending');
  response.data.status = 'FAILURE';
  assert.equal(normalize(response).status, 'failed');
  assert.throws(() => normalize(result(contract.models[1]), { model: contract.models[0] }), { code: 'MOTION_MODEL_MISMATCH' });
  assert.throws(() => normalize(result('unknown')), { code: 'MOTION_MODEL_MISMATCH' });
  const missing = result(); missing.data.data.content = {};
  assert.throws(() => normalize(missing), { code: 'MOTION_OUTPUT_MISSING' });
});
test('optional metadata stays bounded, untrusted, redacted and cannot invalidate a video', () => {
  const response = result();
  response.data.data.storyboard = { title: 'fixture-private-key https://cdn.example.test/a?token=secret', authorization: 'sensitive', scenes: Array.from({ length: 300 }, () => ({ text: 'x' })) };
  const parsed = normalize(response, { secrets: ['fixture-private-key'] });
  assert.equal(parsed.status, 'succeeded');
  assert.equal(parsed.motionResult.storyboard.scenes.length, 256);
  assert.ok(parsed.motionResult.warnings.includes('metadata_truncated'));
  assert.ok(!JSON.stringify(parsed.motionResult).includes('fixture-private-key'));
  assert.ok(!JSON.stringify(parsed.motionResult).includes('token=secret'));
  assert.ok(!('authorization' in parsed.motionResult.storyboard));
  response.data.data.storyboard = 'malformed'; response.data.data.fallback_scenes = 9;
  assert.equal(normalize(response).status, 'succeeded');
  assert.deepEqual(normalize(response).motionResult.warnings.sort(), ['fallback_invalid', 'storyboard_invalid']);
  assert.equal(Object.getPrototypeOf(sanitizeMotionMetadata(JSON.parse('{"__proto__":{"polluted":true}}')).data), null);
});
test('revision queries completed base with the same model before exactly one paid POST', async () => {
  const calls = [];
  const submitted = await provider.submitMotionVideoTask({ prompt: 'original', operation: 'revise',
    motion: { revise_from: 'base-task', revision_instruction: 'change HELLO to HI' } }, 'fixture-key', {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'POST') {
        assert.equal(JSON.parse(init.body).motion.revise_from, 'base-task');
        return json({ data: { task_id: 'new-task' } });
      }
      return json(result());
    },
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/v1/video/generations/base-task'));
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(submitted.taskId, 'new-task');
});
test('incomplete, denied and wrong-model bases issue zero paid requests', async () => {
  for (const response of [json({ data: { status: 'IN_PROGRESS' } }), json({ error: 'denied' }, 403), json(result(contract.models[1]))]) {
    let posts = 0;
    await assert.rejects(provider.submitMotionVideoTask({ prompt: 'original', operation: 'revise',
      motion: { revise_from: 'base-task', revision_instruction: 'change text' } }, 'fixture-key', {
      fetchImpl: async (_url, init) => { if (init.method === 'POST') posts++; return response; },
    }));
    assert.equal(posts, 0);
  }
});
test('ambiguous submit failure is not retried, missing credentials perform no request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw Object.assign(Error('reset'), { code: 'ECONNRESET' }); };
  await assert.rejects(provider.submitMotionVideoTask({ prompt: 'hello' }, 'fixture-key', { fetchImpl }));
  assert.equal(calls, 1);
  await assert.rejects(provider.submitMotionVideoTask({ prompt: 'hello' }, '', { fetchImpl }));
  assert.equal(calls, 1);
  assert.match(motionConnectionRef('fixture-key'), /^seedance-nz:[a-f0-9]{64}$/);
  assert.equal(motionConnectionRef(' fixture-key '), motionConnectionRef('fixture-key'));
  assert.notEqual(motionConnectionRef('other-key'), motionConnectionRef('fixture-key'));
});
