const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { testProviderConnection, generateChatWithProvider, generateImageWithProvider, generateVideoWithProvider } = require('../backend/src/providers/adapters');
const { strataConnection } = require('../backend/src/providers/strata');
const { normalizeAdvancedProviders, maskAdvancedProviders } = require('../backend/src/providers/registry');

async function fixture(t, overrides = {}) {
  const calls = [];
  const state = { vision: false, loaded: true, model: 'local-qwen', mode: 'json', ...overrides };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, method: req.method, auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined });
    const json = (value) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (state.key && req.headers.authorization !== `Bearer ${state.key}`) { res.statusCode = 401; return json({ error: 'bad key' }); }
    if (req.url === '/health') return json({ service: 'strata', loaded: state.loaded, model: state.model });
    if (req.url === '/v1/status') return json({ service: 'strata', protocol_version: state.protocol ?? 1, model: state.model, loaded: state.loaded, auto_load: true,
      vision: { enabled: state.vision, available: state.vision }, context: { native: 32768 }, instance_id: 'test-instance',
      structured_output: { formats: ['json_object'], constrained_decoding: false, stream_buffered: true },
      machine: { secret: 'not-for-client' }, processes: { pid: 123 }, paths: ['private'] });
    if (req.url === '/v1/models') return json({ object: 'list', data: state.loaded ? [
      { id: state.model, architecture: { input_modalities: state.vision ? ['text', 'image'] : ['text'], output_modalities: ['text'] } },
      { id: 'alias', alias_of: state.model, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
      { id: 'image-model', architecture: { output_modalities: ['image'] } },
    ] : [] });
    if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return json({ error: 'wrong path' }); }
    if (state.mode === 'headers-delay') { setTimeout(() => { if (!res.destroyed) json({ choices: [{ message: { content: 'late' }, finish_reason: 'stop' }] }); }, 160); return; }
    if (state.mode === 'body-delay') {
      res.setHeader('content-type', 'application/json'); res.flushHeaders();
      setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: 'late' }, finish_reason: 'stop' }] })); }, 160); return;
    }
    if (state.mode.startsWith('hold')) {
      res.setHeader('content-type', 'text/event-stream'); res.flushHeaders();
      res.write(': ping\n\n');
      if (state.mode === 'hold-delta') res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
      req.once('close', () => {});
      return;
    }
    if (state.mode.startsWith('stream')) {
      res.setHeader('content-type', 'text/event-stream');
      res.write(': ping\n\n');
      res.write(`data: ${JSON.stringify({ model: state.model, choices: [{ delta: { reasoning_content: 'thinking' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ model: state.model, choices: [{ delta: { content: 'hello' } }] })}\n\n`);
      if (state.mode === 'stream-error') res.write('data: {"error":{"message":"generation failed"}}\n\n');
      else if (state.mode !== 'stream-eof') {
        res.write(`data: ${JSON.stringify({ model: state.model, choices: [{ delta: {}, finish_reason: state.mode === 'stream-length' ? 'length' : 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      res.end(); return;
    }
    json({ model: state.model, choices: [{ message: { content: state.text || 'hello' }, finish_reason: state.finish || 'stop' }], usage: { total_tokens: 8 } });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { calls, state, provider: { id: 'strata-test', label: 'Strata', protocol: 'openai-compatible', profile: 'strata', authMode: 'none', enabled: true,
    apiKey: 'must-not-send', baseUrl: `http://127.0.0.1:${server.address().port}`, chatModels: [state.model], defaults: { reasoningEffort: 'none', maxTokens: 1024 } } };
}

test('Strata configuration roundtrips profile, masks credentials and explicitly clears a key', () => {
  const raw = { id: 'strata-local', profile: 'strata', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080', authMode: 'bearer', apiKey: 'secret', imageModels: ['bad'] };
  const first = normalizeAdvancedProviders([raw]).find((p) => p.id === 'strata-local');
  assert.equal(first.profile, 'strata'); assert.deepEqual(first.imageModels, []);
  const masked = maskAdvancedProviders([first]).find((p) => p.id === 'strata-local');
  assert.notEqual(masked.apiKey, 'secret'); assert.equal(masked.hasApiKey, true);
  const saved = normalizeAdvancedProviders([masked], [first]).find((p) => p.id === 'strata-local');
  assert.equal(saved.apiKey, 'secret');
  const cleared = normalizeAdvancedProviders([{ ...masked, clearApiKey: true }], [first]).find((p) => p.id === 'strata-local');
  assert.equal(cleared.apiKey, '');
});

test('Strata auth gate checks final endpoint, literal loopback, URL credentials and no cross-origin overrides', () => {
  const p = { baseUrl: 'http://127.0.0.1:8080', authMode: 'none' };
  assert.equal(strataConnection(p).baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(strataConnection({ ...p, baseUrl: `${p.baseUrl}/v1/` }).baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(strataConnection({ ...p, baseUrl: 'http://[::1]:8080/proxy' }).baseUrl, 'http://[::1]:8080/proxy/v1');
  for (const baseUrl of ['http://localhost:8080', 'http://192.168.1.8:8080', 'http://127.0.0.1.evil.com', 'http://a:b@127.0.0.1', 'http://127.0.0.1?key=x']) {
    assert.throws(() => strataConnection({ ...p, baseUrl }));
  }
  assert.throws(() => strataConnection({ ...p, defaults: { chatEndpoint: 'http://192.168.1.8/v1/chat/completions' } }));
  assert.equal(strataConnection({ baseUrl: 'http://192.168.1.8:8080/v1', authMode: 'bearer', apiKey: 'test' }).headers.Authorization, 'Bearer test');
});

test('Strata discovery makes GETs only, returns aliases and no raw machine details; cold models are discoverable', async (t) => {
  const f = await fixture(t);
  const r = await testProviderConnection(f.provider);
  assert.equal(r.ok, true); assert.equal(f.calls.length, 3); assert.ok(f.calls.every((c) => c.method === 'GET' && !c.auth));
  assert.deepEqual(r.discovery.models.map((m) => m.id), ['local-qwen', 'alias']);
  assert.equal(r.discovery.models[1].aliasOf, 'local-qwen');
  assert.ok(!JSON.stringify(r).includes('not-for-client'));
  f.state.loaded = false;
  const cold = await testProviderConnection(f.provider);
  assert.equal(cold.ok, true); assert.equal(cold.discovery.loaded, false); assert.equal(cold.discovery.models[0].id, 'local-qwen');
});

test('Strata validates the same trimmed final endpoint used for POST, before discovery or credentials leave', async (t) => {
  const f = await fixture(t, { key: 'test-only-key' });
  const provider = { ...f.provider, authMode: 'bearer', apiKey: 'test-only-key' };
  for (const key of ['chatEndpoint', 'chat_endpoint']) {
    for (const override of [' https://example.invalid/v1/chat/completions ', '\thttps://example.invalid/v1/chat/completions\r\n', '\r\nHTTPs://example.invalid/v1/chat/completions\t']) {
      let fetches = 0;
      const result = await generateChatWithProvider({ ...provider, defaults: { [key]: override } }, { prompt: 'hello' }, {
        fetchImpl: async () => { fetches++; throw Error('No network expected'); },
      });
      assert.equal(result.code, 'invalid_endpoint', `${key}: ${JSON.stringify(override)}`);
      assert.equal(fetches, 0, 'Reject before any GET/POST, including Bearer discovery');
    }
  }
  const sameOrigin = `${f.provider.baseUrl}/v1/chat/completions`;
  assert.equal((await generateChatWithProvider({ ...provider, defaults: { chatEndpoint: ` \t${sameOrigin}\r\n` } }, { prompt: 'hello' })).ok, true);
  assert.equal(f.calls.at(-1).path, '/v1/chat/completions');
  assert.equal(f.calls.at(-1).auth, 'Bearer test-only-key');
});

test('Strata text uses canonical discovery, explicit no-thinking, small default and no saved key in none mode', async (t) => {
  const f = await fixture(t);
  const r = await generateChatWithProvider(f.provider, { prompt: 'hello' });
  assert.equal(r.ok, true); assert.equal(r.text, 'hello');
  const post = f.calls.find((c) => c.method === 'POST');
  assert.equal(post.auth, undefined); assert.equal(post.body.reasoning_effort, 'none'); assert.equal(post.body.max_tokens, 1024);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  const old = await generateChatWithProvider(f.provider, { prompt: 'hello', max_tokens: 2048, reasoningEffort: '' });
  assert.equal(old.ok, true); assert.equal(f.calls.at(-1).body.max_tokens, 2048); assert.equal(f.calls.at(-1).body.reasoning_effort, undefined);
});

test('Strata stale models, missing vision and unsupported media never issue a generation POST', async (t) => {
  const f = await fixture(t);
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', model: 'stale' })).code, 'model_unavailable');
  assert.equal((await generateChatWithProvider(f.provider, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }] })).code, 'vision_unavailable');
  f.state.vision = true;
  assert.equal((await generateChatWithProvider(f.provider, { llmVideoMode: 'url', messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { url: 'https://example.com/movie.mp4' } }] }] })).code, 'unsupported_video_mode');
  assert.equal((await generateImageWithProvider(f.provider, { prompt: 'image' })).ok, false);
  assert.equal((await generateVideoWithProvider(f.provider, { prompt: 'video' })).ok, false);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
});

test('Strata text SSE delivers deltas, ignores reasoning and requires an explicit successful terminal', async (t) => {
  const f = await fixture(t, { mode: 'stream' });
  const deltas = [];
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', stream: true }, { onDelta: (delta) => deltas.push(delta) })).ok, true);
  assert.deepEqual(deltas, ['hello']);
  for (const mode of ['stream-eof', 'stream-error', 'stream-length']) {
    f.state.mode = mode;
    const r = await generateChatWithProvider(f.provider, { prompt: 'hello', stream: true });
    assert.equal(r.ok, false, mode);
  }
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 4, 'no automatic POST retry');
});

test('Strata vision enforces the byte budget after compression and never falls back to an invalid original', async (t) => {
  const f = await fixture(t, { vision: true });
  const sharp = require('sharp');
  const bytes = await sharp(require('node:crypto').randomBytes(128 * 128 * 4), { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer();
  const message = url => [{ role: 'user', content: [{ type: 'text', text: 'Describe the image' }, { type: 'image_url', image_url: { url } }] }];
  const result = await generateChatWithProvider(f.provider, { imageMaxBase64Bytes: 128, messages: message(`data:image/png;base64,${bytes.toString('base64')}`) });
  assert.equal(result.code, 'invalid_multimodal_reference');
  assert.match(result.error, /视觉输入预算/);
  const invalid = await generateChatWithProvider(f.provider, { messages: message(`data:image/png;base64,${Buffer.from('not an image').toString('base64')}`) });
  assert.equal(invalid.code, 'invalid_multimodal_reference');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0, 'No paid/model POST when local preparation fails');
});

for (const mode of ['headers-delay', 'body-delay', 'hold']) {
  test(`Strata shared deadline cancels ${mode}, including after headers`, async (t) => {
    const f = await fixture(t, { mode });
    const start = Date.now();
    const r = await generateChatWithProvider(f.provider, { prompt: 'hello', stream: mode === 'hold' }, { timeoutMs: 75 });
    assert.equal(r.ok, false); assert.equal(r.code, 'timeout'); assert.ok(Date.now() - start < 550);
    assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  });
}

test('Strata manual cancel aborts the upstream and serializes even across different provider IDs/keys', async (t) => {
  const f = await fixture(t, { mode: 'hold' });
  const firstAbort = new AbortController(); const secondAbort = new AbortController();
  const first = generateChatWithProvider(f.provider, { prompt: 'first', stream: true }, { signal: firstAbort.signal });
  while (!f.calls.some((c) => c.method === 'POST')) await new Promise((r) => setTimeout(r, 5));
  const second = generateChatWithProvider({ ...f.provider, id: 'another-id', apiKey: 'another-key' }, { prompt: 'second' }, { signal: secondAbort.signal });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  secondAbort.abort(); assert.equal((await second).code, 'request_aborted');
  firstAbort.abort(); assert.equal((await first).code, 'request_aborted');
  f.state.mode = 'json';
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'after cancel' })).ok, true);
});

test('Strata bearer errors do not downgrade auth, retry, or return false JSON successes', async (t) => {
  const f = await fixture(t, { key: 'real-key' });
  const p = { ...f.provider, authMode: 'bearer', apiKey: 'wrong' };
  assert.equal((await testProviderConnection(p)).code, 'authentication_failed');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].auth, 'Bearer wrong');
  p.apiKey = 'real-key'; f.state.text = 'not JSON';
  assert.equal((await generateChatWithProvider(p, { prompt: 'JSON', response_format: { type: 'json_object' } })).code, 'structured_output_failed');
  f.state.text = '{"ok":true}';
  assert.equal((await generateChatWithProvider(p, { prompt: 'JSON', response_format: { type: 'json_object' } })).ok, true);
});

test('Strata cancellation inside onDelta observes the next rejected body read without an unhandled rejection', async (t) => {
  const f = await fixture(t, { mode: 'hold-delta' });
  const controller = new AbortController();
  const result = await generateChatWithProvider(f.provider, { prompt: 'hello', stream: true }, {
    signal: controller.signal, onDelta: () => controller.abort(),
  });
  assert.equal(result.code, 'request_aborted');
  await new Promise((resolve) => setTimeout(resolve, 30));
});

test('both Creator runtimes reject the Strata profile before any tool/repair or cloud fallback', () => {
  const provider = { id: 'strata-test', protocol: 'openai-compatible', profile: 'strata', authMode: 'none', baseUrl: 'http://127.0.0.1:8080/v1', enabled: true, chatModels: ['local-model'] };
  const settings = { advancedProviders: [provider] };
  assert.throws(() => require('../backend/src/services/creatorLlmRuntimeV2').providerFromSettings(provider.id, 'local-model', settings), { code: 'CREATOR_STRATA_NOT_SUPPORTED' });
  assert.throws(() => require('../backend/src/services/creatorAgentLlmRuntime').providerForDecision({ status: 'ready', selected: { provider: provider.id, model: 'local-model', executable: true } }, settings), { code: 'CREATOR_STRATA_NOT_SUPPORTED' });
  for (const id of ['zhenzhen', 'seedance-nz']) {
    const imported = { ...settings, llmApiKey: 'synthetic-cloud-key', zhenzhenSd2ApiKey: 'synthetic-cloud-key', advancedProviders: [{ ...provider, id }] };
    assert.throws(() => require('../backend/src/services/creatorLlmRuntimeV2').providerFromSettings(id, 'local-model', imported), { code: 'CREATOR_STRATA_NOT_SUPPORTED' });
    assert.throws(() => require('../backend/src/services/creatorAgentLlmRuntime').providerForDecision({ status: 'ready', selected: { provider: id, model: 'local-model', executable: true } }, imported), { code: 'CREATOR_STRATA_NOT_SUPPORTED' });
  }
});
