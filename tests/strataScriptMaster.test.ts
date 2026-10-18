import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { advancedLlmTokenBudget, createStrataProvider } from '../src/utils/advancedProviders.ts';
import { resolveSeedanceNzLlmModel } from '../src/config/llm.ts';
import {
  appendScriptMasterShot, beginScriptMasterAnalysis, createEmptyScriptMasterProject,
  createScriptMasterAnalysisRequest, failScriptMasterAnalysis,
  parseScriptMasterAnalysisCandidate, recordScriptMasterAnalysisCandidate,
} from '../src/utils/scriptMaster.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const parser = require('@babel/parser');
const source = fs.readFileSync(new URL('../src/components/nodes/ScriptMasterNode.tsx', import.meta.url), 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
let handlerSource = '';
function visit(value: any) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'VariableDeclarator' && value.id?.name === 'runExplicitLlmAnalysis') {
    assert.equal(value.init.callee.name, 'useCallback');
    handlerSource = source.slice(value.init.arguments[0].start, value.init.arguments[0].end);
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(visit);
    else if (child && typeof child === 'object') visit(child);
  }
}
visit(ast);
assert.ok(handlerSource, 'execute the actual ScriptMaster analysis handler, not a copied request builder');
const executable = ts.transpileModule(`return ${handlerSource};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

async function runAnalysis(providerId: string, providers: any[]) {
  const projectRef = { current: appendScriptMasterShot(createEmptyScriptMasterProject({ projectId: 'strata-budget-test' }), 'Budget test') };
  projectRef.current.providerSelections.llm = { provider: providerId, model: 'test-model', version: '' };
  const calls: Array<{ kind: string; request: any }> = [];
  const state = { analyzing: false, nodeStatus: '', message: '' };
  const respond = (kind: string) => async (request: any) => {
    calls.push({ kind, request });
    return { content: JSON.stringify({ confidence: 0.9, shots: [], unresolvedItems: [] }) };
  };
  const scope = {
    projectRef, analysisScope: 'all', selectedShot: null,
    createScriptMasterAnalysisRequest, beginScriptMasterAnalysis,
    setAnalyzing: (value: boolean) => { state.analyzing = value; },
    commit: (project: any, patch: any) => { projectRef.current = project; state.nodeStatus = patch.status; },
    setMessage: (value: string) => { state.message = value; },
    translate: (key: string) => key,
    generateLlm: respond('builtin'), generateExternalLlm: respond('external'),
    resolveSeedanceNzLlmModel, advancedLlmTokenBudget,
    useApiKeysStore: { getState: () => ({ settings: { advancedProviders: providers } }) },
    recordScriptMasterAnalysisCandidate, parseScriptMasterAnalysisCandidate, failScriptMasterAnalysis,
  };
  const handler = new Function(...Object.keys(scope), executable)(...Object.values(scope));
  await handler();
  assert.equal(state.analyzing, false);
  assert.equal(state.nodeStatus, 'review', state.message);
  assert.equal(projectRef.current.analysis.providerCalls, 1);
  assert.equal(projectRef.current.analysis.candidates.length, 1);
  assert.equal(calls.length, 1, 'one explicit analysis, without repair or media generation');
  return calls[0];
}

test('ScriptMaster actual analysis uses the Strata 1024 output budget instead of cloud 16384', async () => {
  const provider = createStrataProvider('strata-script');
  const call = await runAnalysis(provider.id, [provider]);
  assert.equal(call.kind, 'external');
  assert.equal(call.request.max_tokens, 1024);
  assert.equal(call.request.providerId, provider.id);
});

test('ScriptMaster actual analysis respects a Strata configured output budget', async () => {
  const provider = { ...createStrataProvider('strata-script'), defaults: { maxTokens: 2048 } };
  const call = await runAnalysis(provider.id, [provider]);
  assert.equal(call.kind, 'external');
  assert.equal(call.request.max_tokens, 2048);
});

test('ScriptMaster actual analysis keeps the non-Strata external 16384 budget', async () => {
  const provider = { id: 'ordinary-external', protocol: 'openai-compatible', defaults: { maxTokens: 2048 } };
  const call = await runAnalysis(provider.id, [provider]);
  assert.equal(call.kind, 'external');
  assert.equal(call.request.max_tokens, 16384);
});

for (const providerId of ['zhenzhen', 'seedance-nz']) {
  test(`ScriptMaster actual analysis leaves ${providerId} builtin source and budget unchanged`, async () => {
    const call = await runAnalysis(providerId, [createStrataProvider('unselected-strata')]);
    assert.equal(call.kind, 'builtin');
    assert.equal(call.request.source, providerId);
    assert.equal(call.request.max_tokens, 16384);
    assert.equal(call.request.providerId, undefined);
  });
}
