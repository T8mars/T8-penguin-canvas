import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { advancedLlmTokenBudget, advancedProviderModelOptions, advancedProvidersForNode, createStrataProvider, resolveAdvancedProviderSelection } from '../src/utils/advancedProviders';
import { resolveSeedanceNzLlmModel } from '../src/config/llm';
import { appendScriptMasterShot, beginScriptMasterAnalysis, createEmptyScriptMasterProject, createScriptMasterAnalysisRequest, failScriptMasterAnalysis, parseScriptMasterAnalysisCandidate, recordScriptMasterAnalysisCandidate } from '../src/utils/scriptMaster';

const require = createRequire(import.meta.url);
const { generateChatWithProvider, testProviderConnection } = require('../backend/src/providers/adapters');
const { strataConnection } = require('../backend/src/providers/strata');
const { normalizeAdvancedProviders } = require('../backend/src/providers/registry');
const ts = require('typescript');
const parser = require('@babel/parser');

function actualCallback(file: string, name: string) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  let callback = '';
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'VariableDeclarator' && value.id?.name === name) {
      const init = value.init?.type === 'CallExpression' ? value.init.arguments[0] : value.init;
      callback = source.slice(init.start, init.end);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(ast);
  assert.ok(callback, `actual production callback ${name}`);
  return ts.transpileModule(`return ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

const sendExecutable = actualCallback('../src/components/nodes/LLMNode.tsx', 'handleSend');
function sender(stream: boolean, cancelAt: 'usage' | 'response' | 'superseded-usage' | 'superseded-response') {
  const parent = new AbortController();
  const patches: any[] = [];
  const responses: any[] = [];
  const abortRef = { current: null as AbortController | null };
  const activeReporterRef = { current: undefined as any };
  const scope = {
    setError() {}, setWarning() {}, setStreamingText() {}, setRequestPhase() {}, update: (patch: any) => patches.push(patch),
    savedExternalMissing: false, isExternalSelected: true, isSeedanceNzSelected: false,
    modelSelection: { isCustom: false }, model: 'local-qwen', activeModel: 'local-qwen',
    providerSelection: { providerId: 'strata-second', provider: { id: 'strata-second', label: 'Strata', profile: 'strata' } },
    externalProviderModel: 'local-qwen', collectUpstream: () => ({ text: 'hello', images: [], videos: [] }),
    resolveMediaMentions: (text: string) => text, localPrompt: '', userPromptMentions: [], orderedImages: [], orderedTexts: [],
    llmVideoMode: 'frames', videoMaxWidth: 720, videoMaxHeight: 720, videoMaxBase64Mb: 8, videoCrf: 32, videoFrameCount: 12,
    taskCompletionSound: { primeAudio() {}, notifyComplete() {} }, logBus: { info() {}, warn() {}, error() {}, success() {} },
    src: 'second-audit', useStream: stream, isImgOut: false, history: [], generatedImages: [], temperature: 0.2, maxTokens: 1024,
    d: {}, id: 'second-audit', abortRef, activeReporterRef,
    buildMessages: (text: string) => [{ role: 'user', content: text }],
    generateExternalLlmStream: async () => ({ content: 'must not be committed after cancel', usage: { total_tokens: 8 }, finishReason: 'stop' }),
    generateExternalLlm: async () => ({ content: 'must not be committed after cancel', usage: { total_tokens: 8 }, finishReason: 'stop' }),
    setPickedFiles() {}, setPickedVideos() {}, isLlmReplyTruncated: () => false, llmTokenLimitWarning: () => '', t: (value: string) => value,
  };
  const reporter = {
    signal: parent.signal, providerSubmissionKey: 'second-audit', providerRequest: async () => {},
    providerUsage: async () => {
      if (cancelAt === 'usage') parent.abort(new Error('cancelled while persisting usage'));
      if (cancelAt === 'superseded-usage') activeReporterRef.current = { identity: 'newer execution' };
    },
    providerResponse: async (event: any) => {
      responses.push(event);
      if (cancelAt === 'response') parent.abort(new Error('cancelled while persisting response'));
      if (cancelAt === 'superseded-response') activeReporterRef.current = { identity: 'newer execution' };
    },
  };
  return { handleSend: new Function(...Object.keys(scope), sendExecutable)(...Object.values(scope)), reporter, parent, patches, responses };
}

for (const stream of [true, false]) for (const at of ['usage', 'response'] as const) {
  test(`second-audit: superseded ${stream ? 'stream' : 'JSON'} execution during ${at} cannot overwrite the newer execution`, async () => {
    const f = sender(stream, `superseded-${at}`);
    await assert.rejects(f.handleSend(f.reporter));
    assert.equal(f.parent.signal.aborted, false, 'identity mismatch alone must guard late adoption');
    assert.equal(f.patches.some((patch) => patch.status === 'success' || patch.status === 'error' || patch.history || patch.reply), false);
  });
}

for (const stream of [true, false]) for (const cancelAt of ['usage', 'response'] as const) {
  test(`second-audit: parent cancellation during ${cancelAt} prevents ${stream ? 'stream' : 'JSON'} result adoption`, async () => {
    const f = sender(stream, cancelAt);
    await assert.rejects(f.handleSend(f.reporter));
    assert.equal(f.parent.signal.aborted, true, 'real reporter parent signal was cancelled');
    assert.equal(f.patches.some((patch) => patch.status === 'success' || patch.history || patch.reply), false);
  });
}

async function fixture(t: any, overrides: any = {}) {
  const state = { model: 'local-qwen', loaded: true, autoLoad: true, vision: false, protocol: 1, mode: 'json', ...overrides };
  const calls: any[] = [];
  const held: http.ServerResponse[] = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ path: req.url, method: req.method, body, auth: req.headers.authorization });
    const json = (value: any, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (state.redirect) { res.statusCode = 307; res.setHeader('location', '/unexpected'); return res.end(); }
    if (req.url?.endsWith('/health')) return json({ service: 'strata' });
    if (req.url?.endsWith('/v1/status')) return json({ service: 'strata', protocol_version: state.protocol, model: state.model, loaded: state.loaded, auto_load: state.autoLoad,
      vision: { enabled: state.vision, available: state.vision }, context: { native: state.context || 32768 },
      structured_output: { formats: state.formats || ['json_object'] }, machine: 'DO_NOT_PROJECT', paths: 'DO_NOT_PROJECT', processes: 'DO_NOT_PROJECT' });
    if (req.url?.endsWith('/v1/models')) return json({ data: state.loaded ? [
      { id: state.model, architecture: { input_modalities: state.vision ? ['text', 'image'] : ['text'], output_modalities: ['text'] } },
      { id: 'friendly-alias', alias_of: state.model, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
      { id: 'not-a-chat-model', architecture: { output_modalities: ['image'] } },
    ] : [] });
    if (!req.url?.endsWith('/v1/chat/completions')) return json({ error: 'unknown' }, 404);
    if (state.mode === 'hold') { res.setHeader('content-type', 'text/event-stream'); res.write(': wait\n\n'); held.push(res); return; }
    if (state.mode === 'error') return json({ error: { message: 'synthetic failure', privatePath: 'PRIVATE_MACHINE_PATH' }, debug: 'PRIVATE_RAW_DEBUG' }, 500);
    if (state.mode === 'stream') {
      res.setHeader('content-type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ model: state.actualModel || state.model, choices: [{ delta: { content: 'hello' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ model: state.actualModel || state.model, choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    return json({ model: state.actualModel || state.model, choices: [{ message: { content: state.text || 'hello' }, finish_reason: 'stop' }] });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const provider = { id: 'strata-second', enabled: true, protocol: 'openai-compatible', profile: 'strata', authMode: 'none',
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, chatModels: ['local-qwen'], defaults: { maxTokens: 1024, reasoningEffort: 'none' } };
  return { state, calls, held, provider };
}

test('second-audit: cold unload state discovers without inference, then execution rechecks current model', async (t) => {
  const f = await fixture(t, { loaded: false });
  const cold = await testProviderConnection(f.provider);
  assert.equal(cold.ok, true); assert.equal(cold.discovery.loaded, false); assert.equal(cold.discovery.models[0].id, 'local-qwen');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
  f.state.model = 'replacement-model'; f.state.loaded = true;
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello' })).code, 'model_unavailable');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
});

test('second-audit: unloaded unconfigured auto-load-off state fails discovery without inference', async (t) => {
  const f = await fixture(t, { loaded: false, autoLoad: false });
  assert.equal((await testProviderConnection(f.provider)).code, 'model_unavailable');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
});

test('second-audit: protocol mismatch never issues an inference POST', async (t) => {
  const f = await fixture(t, { protocol: 2 });
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello' })).code, 'unsupported_strata_protocol');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
});

test('second-audit: discovery redirects fail closed before reaching another endpoint', async (t) => {
  const f = await fixture(t, { redirect: true });
  assert.equal((await testProviderConnection(f.provider)).ok, false);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, '/health');
});

test('second-audit: reverse proxy prefix is retained in all three metadata GETs and final POST', async (t) => {
  const f = await fixture(t);
  const result = await generateChatWithProvider({ ...f.provider, baseUrl: `${f.provider.baseUrl}/proxy` }, { prompt: 'hello' });
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls.map((call) => call.path), ['/proxy/health', '/proxy/v1/status', '/proxy/v1/models', '/proxy/v1/chat/completions']);
});

test('second-audit: canceled middle queue item cannot release a later item before active request', async (t) => {
  const f = await fixture(t, { mode: 'hold' });
  const firstAbort = new AbortController(); const middleAbort = new AbortController();
  const first = generateChatWithProvider(f.provider, { prompt: 'first', stream: true }, { signal: firstAbort.signal });
  while (f.held.length < 1) await new Promise((resolve) => setTimeout(resolve, 5));
  const middle = generateChatWithProvider({ ...f.provider, id: 'middle' }, { prompt: 'middle' }, { signal: middleAbort.signal });
  middleAbort.abort(); assert.equal((await middle).code, 'request_aborted');
  const third = generateChatWithProvider({ ...f.provider, id: 'third', baseUrl: `${f.provider.baseUrl}/proxy` }, { prompt: 'third' });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  f.state.mode = 'json'; firstAbort.abort(); assert.equal((await first).code, 'request_aborted');
  assert.equal((await third).ok, true);
  assert.deepEqual(f.calls.filter((call) => call.method === 'POST').map((call) => call.body.messages[0].content), ['first', 'third']);
});

test('second-audit: disabled or absent source preserves node identity and recovers only after same source returns', () => {
  const provider: any = { id: 'preserved', protocol: 'openai-compatible', profile: 'strata', enabled: true, chatModels: ['local-qwen'] };
  const current: any = { providerSource: 'openai-compatible', providerId: provider.id, providerModel: 'local-qwen' };
  for (const providers of [[], [{ ...provider, enabled: false }]]) {
    const selection = resolveAdvancedProviderSelection(providers, 'llm', current);
    assert.equal(selection.available, false); assert.equal(selection.providerId, current.providerId); assert.equal(selection.providerModel, current.providerModel);
  }
  assert.equal(resolveAdvancedProviderSelection([provider], 'llm', current).available, true);
  assert.equal(resolveAdvancedProviderSelection([{ ...provider, chatModels: ['another'] }], 'llm', current).available, false);
});

test('second-audit: profile survives ID normalization and never exposes image or video options', () => {
  const provider = normalizeAdvancedProviders([{ id: 'zhenzhen', protocol: 'openai-compatible', profile: 'strata', enabled: true, authMode: 'none',
    baseUrl: 'http://127.0.0.1:8080', chatModels: ['local-qwen'], imageModels: ['not-supported'], videoModels: ['not-supported'] }]).find((item: any) => item.id === 'zhenzhen');
  assert.equal(provider.profile, 'strata');
  assert.deepEqual(advancedProviderModelOptions(provider, 'image'), []); assert.deepEqual(advancedProviderModelOptions(provider, 'video'), []);
  assert.deepEqual(advancedProvidersForNode([provider], 'llm').map((item) => item.id), ['zhenzhen']);
});

test('second-audit: alias request accepts canonical response but rejects changed actual model in JSON and SSE', async (t) => {
  const f = await fixture(t);
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', model: 'friendly-alias' })).ok, true);
  for (const stream of [false, true]) {
    f.state.mode = stream ? 'stream' : 'json'; f.state.actualModel = 'changed-behind-discovery';
    assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', stream })).code, 'model_identity_changed');
  }
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 3, 'each explicit invocation submits exactly once');
});

test('second-audit: a new run rechecks removed vision rather than using previously discovered capability', async (t) => {
  const f = await fixture(t, { vision: true });
  assert.equal((await testProviderConnection(f.provider)).discovery.vision, true);
  f.state.vision = false;
  assert.equal((await generateChatWithProvider(f.provider, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } }] }] })).code, 'vision_unavailable');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
});

test('second-audit: messages preserve roles, order, repeated text and explicit output budget', async (t) => {
  const f = await fixture(t);
  const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'repeat' }, { role: 'assistant', content: 'old' }, { role: 'user', content: 'repeat' }];
  assert.equal((await generateChatWithProvider(f.provider, { messages, max_tokens: 2048 })).ok, true);
  const body = f.calls.find((call) => call.method === 'POST').body;
  assert.deepEqual(body.messages, messages); assert.equal(body.max_tokens, 2048);
});

test('second-audit: context budget rejects before POST and API default reasoning omits parameter', async (t) => {
  const f = await fixture(t, { context: 2048 });
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', max_tokens: 2048 })).code, 'context_budget_exceeded');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', max_tokens: 128, reasoningEffort: '' })).ok, true);
  assert.equal(Object.hasOwn(f.calls.at(-1).body, 'reasoning_effort'), false);
});

test('second-audit: unsupported JSON capability prevents POST and invalid completed JSON remains failure', async (t) => {
  const f = await fixture(t, { formats: [] });
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', response_format: { type: 'json_object' } })).code, 'structured_output_unavailable');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
  f.state.formats = ['json_object']; f.state.text = '[]';
  assert.equal((await generateChatWithProvider(f.provider, { prompt: 'hello', response_format: { type: 'json_object' } })).code, 'structured_output_failed');
});

test('second-audit: missing local image fails before generation and does not send local path', async (t) => {
  const f = await fixture(t, { vision: true });
  // Do not touch a retained resource catalog or project database.
  const missing = path.join(os.tmpdir(), `t8-second-audit-nonexistent-${process.pid}-${Date.now()}.png`);
  const result = await generateChatWithProvider(f.provider, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: missing } }] }] });
  assert.equal(result.code, 'invalid_multimodal_reference');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
});

test('second-audit: discovery DTO projects no raw process/path fields and none mode sends no saved Key', async (t) => {
  const f = await fixture(t);
  const result = await testProviderConnection({ ...f.provider, apiKey: 'SYNTHETIC_DO_NOT_SEND' });
  assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes('DO_NOT_PROJECT'), false);
  assert.equal(f.calls.some((call) => call.auth), false);
});

test('second-audit: loopback auth cannot escape using protocol-relative or encoded host URL forms', () => {
  const provider = { authMode: 'none', baseUrl: 'http://127.0.0.1:8080' };
  for (const baseUrl of ['http://127.0.0.1@evil.invalid', 'http://evil.invalid#127.0.0.1', 'http://127.0.0.1?redirect=evil', 'file:///C:/model']) assert.throws(() => strataConnection({ ...provider, baseUrl }));
  assert.throws(() => strataConnection({ ...provider, defaults: { chatEndpoint: 'https://evil.invalid/v1/chat/completions' } }));
});

test('second-audit: transport HTTP failure cannot be adopted as successful output and is never retried', async (t) => {
  const f = await fixture(t, { mode: 'error' });
  const result = await generateChatWithProvider(f.provider, { prompt: 'hello' });
  assert.equal(result.ok, false); assert.equal(result.code, 'http_error');
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

const scriptExecutable = actualCallback('../src/components/nodes/ScriptMasterNode.tsx', 'runExplicitLlmAnalysis');
for (const providerId of ['zhenzhen', 'seedance-nz']) {
  test(`second-audit: ScriptMaster never interprets imported Strata ID ${providerId} as a builtin cloud source`, async () => {
    const provider = { ...createStrataProvider(providerId), chatModels: ['local-qwen'] };
    const projectRef = { current: appendScriptMasterShot(createEmptyScriptMasterProject({ projectId: 'second-audit-script' }), 'Identity test') };
    projectRef.current.providerSelections.llm = { provider: providerId, model: 'local-qwen', version: '' };
    const calls: any[] = [];
    let nodeStatus = ''; let message = '';
    const respond = (kind: string) => async (request: any) => {
      calls.push({ kind, request }); return { content: JSON.stringify({ confidence: 0.9, shots: [], unresolvedItems: [] }) };
    };
    const scope = {
      projectRef, analysisScope: 'all', selectedShot: null, createScriptMasterAnalysisRequest, beginScriptMasterAnalysis,
      setAnalyzing() {}, commit: (project: any, patch: any) => { projectRef.current = project; nodeStatus = patch.status; }, setMessage: (value: string) => { message = value; },
      translate: (key: string) => key,
      generateLlm: respond('builtin'), generateExternalLlm: respond('external'), resolveSeedanceNzLlmModel, advancedLlmTokenBudget,
      useApiKeysStore: { getState: () => ({ settings: { advancedProviders: [provider] } }) },
      recordScriptMasterAnalysisCandidate, parseScriptMasterAnalysisCandidate, failScriptMasterAnalysis,
    };
    await new Function(...Object.keys(scope), scriptExecutable)(...Object.values(scope))();
    assert.equal(calls.filter((call) => call.kind === 'builtin').length, 0, 'never submit to a cloud source because an imported Strata ID collides');
    assert.equal(calls.length, 0, 'ambiguous identities are explicitly rejected, not guessed');
    assert.equal(nodeStatus, 'error'); assert.match(message, /reservedId/);
  });
}
