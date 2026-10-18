import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const parser = require('@babel/parser');
const source = fs.readFileSync(new URL('../src/components/nodes/LLMNode.tsx', import.meta.url), 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
let handlerSource = '';
function visit(value: any) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'VariableDeclarator' && value.id?.name === 'handleSend') {
    handlerSource = source.slice(value.init.start, value.init.end);
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(visit);
    else if (child && typeof child === 'object') visit(child);
  }
}
visit(ast);
assert.ok(handlerSource, 'execute the actual LLMNode callback so swallowed failures cannot pass a regex-only check');
const executable = ts.transpileModule(`return ${handlerSource};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function fixture(overrides: Record<string, any> = {}, abortDuringTransport = false) {
  // Keep the existing node snapshot unchanged: React may not have applied any
  // queued updates when the shared Run wrapper observes callback completion.
  const staleNode = { status: 'success', reply: 'previous successful output', history: [] };
  const state = { error: null as string | null, warning: null as string | null, streamingText: '', phase: '' };
  const patches: Array<Record<string, any>> = [];
  const submissions: any[] = [];
  const providerEvents: any[] = [];
  const abortRef: { current: AbortController | null } = { current: null };
  const activeReporterRef: { current: any } = { current: undefined };
  const failure = Object.assign(new Error('synthetic Strata transport failure'), { code: 'strata_network_error' });
  const failTransport = async (request: any) => {
    submissions.push(request);
    if (abortDuringTransport) abortRef.current?.abort();
    throw failure;
  };
  const scope = {
    setError: (value: string | null) => { state.error = value; },
    setWarning: (value: string | null) => { state.warning = value; },
    setStreamingText: (value: any) => { state.streamingText = typeof value === 'function' ? value(state.streamingText) : value; },
    setRequestPhase: (value: string) => { state.phase = value; },
    update: (patch: any) => { patches.push(patch); },
    savedExternalMissing: false, isExternalSelected: true, isSeedanceNzSelected: false,
    modelSelection: { isCustom: false }, model: 'local-model', activeModel: 'local-model',
    providerSelection: { providerId: 'strata-failure', provider: { id: 'strata-failure', label: 'Strata', profile: 'strata' } },
    externalProviderModel: 'local-model',
    collectUpstream: () => ({ text: 'hello', images: [], videos: [] }),
    resolveMediaMentions: (text: string) => text,
    localPrompt: '', userPromptMentions: [], orderedImages: [], orderedTexts: [],
    llmVideoMode: 'frames', videoMaxWidth: 720, videoMaxHeight: 720, videoMaxBase64Mb: 8, videoCrf: 32, videoFrameCount: 12,
    taskCompletionSound: { primeAudio() {}, notifyComplete() {} },
    logBus: { info() {}, warn() {}, error() {}, success() {} }, src: 'llm-failure-test',
    useStream: true, isImgOut: false, history: [], generatedImages: [], temperature: 0.2, maxTokens: 1024,
    d: {}, id: 'llm-failure', abortRef, activeReporterRef,
    buildMessages: (text: string) => [{ role: 'user', content: text }],
    generateExternalLlmStream: failTransport, generateExternalLlm: failTransport,
    generateLlmStream: failTransport, generateLlm: failTransport,
    setPickedFiles() {}, setPickedVideos() {},
    isLlmReplyTruncated: () => false, llmTokenLimitWarning: () => '',
    t: (key: string) => key,
    ...overrides,
  };
  const reporter = {
    providerSubmissionKey: 't8-strata-test-failure',
    providerRequest: async (event: any) => { providerEvents.push({ type: 'request', ...event }); },
    providerResponse: async (event: any) => { providerEvents.push({ type: 'response', ...event }); },
  };
  const handleSend = new Function(...Object.keys(scope), executable)(...Object.values(scope));
  return { handleSend, reporter, state, patches, staleNode, submissions, providerEvents, failure, abortRef, activeReporterRef };
}

for (const [name, overrides, message] of [
  ['missing or disabled external source', { savedExternalMissing: true }, /sourceUnavailable/],
  ['empty custom model', { isExternalSelected: false, modelSelection: { isCustom: true }, model: '' }, /Custom/],
  ['empty input', { collectUpstream: () => ({ text: '', images: [], videos: [] }) }, /未提供用户输入/],
] as const) {
  test(`LLMNode actual callback rejects ${name} before a Provider submission even with a stale success snapshot`, async () => {
    const f = fixture(overrides);
    await assert.rejects(f.handleSend(f.reporter), message);
    assert.equal(f.staleNode.status, 'success', 'test retains the stale React snapshot that used to hide failure');
    assert.equal(f.submissions.length, 0);
    assert.equal(f.providerEvents.length, 0);
    assert.equal(f.patches.at(-1)?.status, 'error');
    assert.match(f.state.error || '', message);
    assert.equal(f.patches.some((patch) => patch.status === 'success' || patch.history), false);
  });
}

for (const stream of [true, false]) {
  test(`LLMNode actual ${stream ? 'streaming' : 'non-streaming'} callback propagates transport failure to the Run wrapper`, async () => {
    const f = fixture({ useStream: stream });
    await assert.rejects(f.handleSend(f.reporter), (error: unknown) => error === f.failure);
    assert.equal(f.submissions.length, 1, 'no automatic retry or cloud fallback');
    assert.equal(f.staleNode.status, 'success');
    assert.equal(f.patches.at(-1)?.status, 'error');
    assert.equal(f.providerEvents.filter((event) => event.type === 'response' && event.status === 'failed').length, 1);
    assert.equal(f.providerEvents.some((event) => event.status === 'succeeded'), false);
    assert.equal(f.patches.some((patch) => patch.status === 'success' || patch.history || patch.reply), false);
    assert.equal(f.abortRef.current, null);
    assert.equal(f.activeReporterRef.current, undefined);
  });

  test(`LLMNode actual ${stream ? 'streaming' : 'non-streaming'} cancelled callback still rejects without emitting a failed Provider result`, async () => {
    const f = fixture({ useStream: stream }, true);
    await assert.rejects(f.handleSend(f.reporter), (error: unknown) => error === f.failure);
    assert.equal(f.submissions.length, 1);
    assert.equal(f.patches.at(-1)?.status, 'idle');
    assert.equal(f.providerEvents.some((event) => event.type === 'response'), false);
    assert.equal(f.patches.some((patch) => patch.status === 'success' || patch.history || patch.reply), false);
  });
}
