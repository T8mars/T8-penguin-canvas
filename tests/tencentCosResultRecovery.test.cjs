'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeRemoteMediaFetch, tencentCosResultUrlFallback } = require('../backend/src/utils/safeRemoteMediaFetch');
const marker = Symbol.for('t8-penguin-canvas.system-fetch-bridge.v1');
const original = 'https://test-bucket-1250000000.cos.ap-hongkong.myqcloud.com/a%2Fb.png?q-signature=test%2Bsignature&x=1';
const alias = 'https://test-bucket-1250000000.cos.ap-hongkong.tencentcos.cn/a%2Fb.png?q-signature=test%2Bsignature&x=1';

test('COS recovery maps only the exact documented HTTPS bucket domain and preserves object identity', () => {
  assert.equal(tencentCosResultUrlFallback(original), alias);
  for (const url of [original.replace('https:', 'http:'), original.replace('https://', 'https://user:secret@'),
    original.replace('.myqcloud.com/', '.myqcloud.com.evil.test/'), original.replace('.cos.', '.cos-internal.'),
    original.replace('.myqcloud.com/', '.myqcloud.com:8443/'), 'https://cdn.example.com/a.png', alias,
    'https://not-a-bucket.cos.ap-hongkong.myqcloud.com/a.png']) assert.equal(tencentCosResultUrlFallback(url), null, url);
});

test('trusted COS GET recovers after network failure, strips cross-domain credentials and preserves byte limits', async (t) => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url === original) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    assert.equal(url, alias);
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.cookie, undefined);
    assert.equal(init.headers['x-api-key'], undefined);
    assert.equal(init.headers['x-safe'], 'keep');
    return new Response(Buffer.from('image-bytes'), { headers: { 'content-type': 'image/png' } });
  };
  fake[marker] = { nodeFetch: saved };
  globalThis.fetch = fake;
  const options = { trustedProviderOutput: true, maxBytes: 100, deadlineMs: 1000, idleTimeoutMs: 1000,
    headers: { Authorization: 'secret', Cookie: 'cookie', 'X-API-Key': 'secret', 'X-Safe': 'keep' },
    lookupImpl: async () => { throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); } };
  const result = await safeRemoteMediaFetch(original, options);
  assert.equal(result.buffer.toString(), 'image-bytes');
  assert.equal(result.providerResultDomainFallback, 'tencent-cos');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((item) => item.init.method === 'GET'));
  calls.length = 0;
  await assert.rejects(safeRemoteMediaFetch(original, { ...options, maxBytes: 1 }), /超过|字节/);
  assert.equal(calls.length, 2);
});

test('COS alias recovery is not used for ordinary URLs, HTTP authorization errors or cancelled reads', async (t) => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const calls = [];
  const fake = async (url) => { calls.push(url); return new Response('forbidden', { status: 403 }); };
  fake[marker] = { nodeFetch: saved };
  globalThis.fetch = fake;
  await assert.rejects(safeRemoteMediaFetch(original, { trustedProviderOutput: true }), /403/);
  assert.deepEqual(calls, [original]);
  calls.length = 0;
  await assert.rejects(safeRemoteMediaFetch(original, { lookupImpl: async () => { throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); } }));
  assert.deepEqual(calls, []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(safeRemoteMediaFetch(original, { trustedProviderOutput: true, signal: controller.signal }));
  assert.deepEqual(calls, []);
});
