import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { advancedProviderCredentialReady, advancedProviderModelOptions, advancedProvidersForNode, advancedLlmTokenBudget, createStrataProvider, resolveAdvancedProviderSelection } from '../src/utils/advancedProviders.ts';
import { generateExternalLlm, generateExternalLlmStream } from '../src/services/generation.ts';
import { createRunPreflightHostContextDigest } from '../src/utils/runPreflightHostContext.ts';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext.ts';

const require = createRequire(import.meta.url);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function listen(app: any) { return new Promise<any>((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); }); }

test('Strata frontend preset is opt-in, LLM-only, preserves missing sources and explicit old models', () => {
  const p = { ...createStrataProvider('strata-local'), baseUrl: 'http://127.0.0.1:8080/v1', chatModels: ['local-model'] };
  assert.equal(advancedProviderCredentialReady(p), true);
  assert.equal(advancedProviderCredentialReady({ ...p, baseUrl: 'http://192.168.1.8:8080/v1' }), false);
  assert.deepEqual(advancedProvidersForNode([p], 'image'), []);
  assert.deepEqual(advancedProvidersForNode([p], 'video'), []);
  assert.deepEqual(advancedProviderModelOptions({ ...p, chatModels: [] }, 'llm'), []);
  const selected = resolveAdvancedProviderSelection([p], 'llm', { providerSource: p.protocol, providerId: p.id, providerModel: 'old-model' });
  assert.equal(selected.available, false); assert.equal(selected.providerModel, 'old-model');
  const deleted = resolveAdvancedProviderSelection([], 'llm', { providerSource: p.protocol, providerId: p.id, providerModel: 'old-model' });
  assert.equal(deleted.providerSource, p.protocol); assert.equal(deleted.providerId, p.id);
  assert.deepEqual(p.defaults, { reasoningEffort: 'none', maxTokens: 1024 });
  assert.equal(advancedLlmTokenBudget(undefined), 16384);
  assert.equal(advancedLlmTokenBudget(undefined, p), 1024);
  assert.equal(advancedLlmTokenBudget(16384, p), 16384);
  assert.equal(advancedLlmTokenBudget(4096, { ...p, defaults: { maxTokens: 2048 } }), 4096);
  const digest = (provider: any) => createRunPreflightHostContextDigest({ settings: { advancedProviders: [provider] } as any, assetIds: [], assetRecords: new Map(), policy: null });
  assert.notEqual(digest(p), digest({ ...p, authMode: 'bearer' }));
  assert.notEqual(digest(p), digest({ ...p, profile: undefined }));
  const input = { nodes: [{ id: 'llm', type: 'llm', position: { x: 0, y: 0 }, data: { providerSource: p.protocol, providerId: p.id, providerModel: 'local-model', userPrompt: 'hello' } }],
    edges: [], executionNodeIds: ['llm'], scopeMode: 'exact-plan' as const, settings: { advancedProviders: [p] } as any };
  const ready = buildRunPreflightDiagnostics(input);
  assert.equal(ready.capability.some((item) => item.ruleId === 'provider.credential-not-configured'), false);
  const lan = buildRunPreflightDiagnostics({ ...input, settings: { advancedProviders: [{ ...p, baseUrl: 'http://192.168.1.8:8080/v1' }] } as any });
  assert.equal(lan.capability.some((item) => item.ruleId === 'provider.credential-not-configured'), true);
});

test('actual settings → discovery → frontend stream → adapter HTTP chain persists Strata without a key', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-strata-route-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const config = require('../backend/src/config.js');
  const fields = ['SETTINGS_FILE', 'OUTPUT_DIR', 'DEFAULT_LOCAL_SAVE_DIR', 'DEFAULT_CANVAS_AUTO_SAVE_DIR', 'DEFAULT_RESOURCE_LIBRARY_DIR', 'DEFAULT_THEME_TEMPLATE_DIR'];
  const previous = Object.fromEntries(fields.map((key) => [key, config[key]]));
  t.after(() => Object.assign(config, previous));
  fields.forEach((key) => { config[key] = path.join(tmp, key === 'SETTINGS_FILE' ? 'settings.json' : key); });
  let posts = 0; let disconnected = false; let release: (() => void) | undefined;
  const upstream = express(); upstream.use(express.json());
  upstream.get('/health', (_req, res) => res.json({ service: 'strata', loaded: true }));
  upstream.get('/v1/status', (_req, res) => res.json({ service: 'strata', protocol_version: 1, model: 'real-fixture-model', loaded: true, auto_load: true,
    context: { native: 32768 }, vision: { enabled: false, available: false } }));
  upstream.get('/v1/models', (_req, res) => res.json({ data: [{ id: 'real-fixture-model', architecture: { output_modalities: ['text'], input_modalities: ['text'] } }] }));
  upstream.post('/v1/chat/completions', (req, res) => {
    posts++; assert.equal(req.headers.authorization, undefined);
    if (!req.body.stream) return res.json({ choices: [{ message: { content: 'not streamed' }, finish_reason: 'stop' }] });
    res.set('content-type', 'text/event-stream');
    res.write('data: {"model":"real-fixture-model","choices":[{"delta":{"content":"first"}}]}\n\n');
    res.on('close', () => { if (!res.writableEnded) disconnected = true; });
    release = () => res.end('data: {"choices":[{"delta":{"content":" second"},"finish_reason":"stop"}],"usage":{"total_tokens":4}}\n\ndata: [DONE]\n\n');
  });
  const upstreamServer = await listen(upstream); t.after(() => { upstreamServer.closeAllConnections(); upstreamServer.close(); });
  const app = express(); app.use(express.json());
  app.use('/api/settings', require('../backend/src/routes/settings.js'));
  app.use('/api/proxy/external', require('../backend/src/routes/externalProviders.js'));
  const server = await listen(app); t.after(() => { server.closeAllConnections(); server.close(); });
  const nativeFetch = globalThis.fetch; const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = ((url: any, options: any) => nativeFetch(typeof url === 'string' && url.startsWith('/') ? `${base}${url}` : url, options)) as typeof fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const provider = { ...createStrataProvider('strata-http'), baseUrl: `http://127.0.0.1:${upstreamServer.address().port}`, chatModels: ['real-fixture-model'] };
  const saved = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ advancedProviders: [provider] }) }).then((r) => r.json());
  assert.equal(saved.success, true);
  const discovery = await fetch('/api/proxy/external/test-provider', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: provider.id }) }).then((r) => r.json());
  assert.equal(discovery.success, true); assert.equal(discovery.data.discovery.model, 'real-fixture-model'); assert.equal(posts, 0);
  const restored = await fetch('/api/settings').then((r) => r.json());
  assert.equal(restored.data.advancedProviders.find((p: any) => p.id === provider.id).authMode, 'none');
  const chunks: string[] = []; let complete = false;
  const request = { providerId: provider.id, model: 'real-fixture-model', messages: [{ role: 'user' as const, content: 'hello' }] };
  const pending = generateExternalLlmStream(request, { onDelta: (text) => chunks.push(text) }).then((result) => { complete = true; return result; });
  for (let n = 0; n < 100 && !chunks.length; n++) await wait(5);
  assert.deepEqual(chunks, ['first']); assert.equal(complete, false, 'delta must arrive before completion');
  release!(); const result = await pending;
  assert.equal(result.content, 'first second'); assert.equal(result.finishReason, 'stop'); assert.equal(posts, 1);
  assert.equal((await generateExternalLlm(request)).content, 'not streamed');
  const controller = new AbortController();
  const cancelled = generateExternalLlmStream(request, { signal: controller.signal, onDelta: () => controller.abort() });
  await assert.rejects(cancelled);
  for (let n = 0; n < 100 && !disconnected; n++) await wait(5);
  assert.equal(disconnected, true, 'browser cancel must reach upstream socket');
  const missing = await fetch('/api/proxy/external/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, providerId: 'deleted-strata' }) }).then((r) => r.json());
  assert.equal(missing.success, false); assert.equal(posts, 3, 'no missing-provider cloud fallback or cancellation retry');
});
