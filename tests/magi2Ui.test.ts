import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MAGI2, createMagi2Request } from '../src/utils/magi2';
import { videoModelsForSource } from '../src/providers/models';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext';
import { submitMagi2Video, queryMagi2Video } from '../src/services/generation';

const require = createRequire(import.meta.url);
const { providerDeclarationForNode } = require('../backend/src/collaboration/runIntentAuthority');

test('six Magi fragments import with the exact model, ordered materials and budget credential', () => {
  assert.equal(videoModelsForSource('seedance-nz').find(model => model.id === 'magi-2')?.label, 'Magi');
  assert.equal(videoModelsForSource('zhenzhen').some(model => model.id === 'magi-2'), false);
  for (const model of MAGI2.models) {
    for (const mode of ['text', 'frame', 'reference']) {
      const file = new URL('../docs/workflows/' + model + '-' + mode + '.json', import.meta.url);
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /sk-|apiKey|taskId|https?:|signed/i);
      const fragment = workflowManifestToFragment(JSON.parse(text));
      assert.ok(fragment);
      const node = fragment.nodes.find(node => node.id === 'generate');
      assert.ok(node);
      assert.deepEqual(providerDeclarationForNode(node, fragment), { provider: 'seedance-nz', model });
      assert.equal(node.data.magi2Mode, mode);
      assert.deepEqual(fragment.edges.filter(edge => edge.target === 'generate').map(edge => edge.source),
        mode === 'text' ? [] : mode === 'frame' ? ['first-frame', 'last-frame'] : ['subject', 'motion', 'sound']);

      const preflight = (key: string) => buildRunPreflightDiagnostics({
        nodes: [node], edges: [], executionNodeIds: [node.id], projectId: 'fixture',
        settings: { zhenzhenApiKey: 'unrelated', zhenzhenSd2ApiKey: key, advancedProviders: [] } as any,
        assets: [], providersComplete: true, policy: null,
      });
      assert.ok(preflight('').capability.some(row => row.ruleId === 'provider.seedance-nz-credential-missing'));
      assert.ok(!preflight('fixture').capability.some(row => row.ruleId.includes('credential-missing')));
    }
    const descriptor = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model, taskId: 'original/task' });
    assert.equal(descriptor?.kind, 'magi');
    assert.equal(descriptor?.model, model);
    assert.equal(descriptor?.taskId, 'original/task');
  }
});

test('Magi frontend submits explicit references with seed zero and cold polls the exact model', async () => {
  const previous = globalThis.fetch;
  const model = MAGI2.models[1];
  const controller = new AbortController();
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ success: true, data: { taskId: 'original/task', model, status: 'running' } });
  };
  try {
    const references = { images: ['same', 'same'], audios: [], videos: [] };
    const settings = { magi2Mode: 'reference', magi2GenerateAudio: false, magi2Seed: 0 };
    const request = createMagi2Request(model, 'Prompt', 4, 'api_default', settings, references);
    assert.throws(() => createMagi2Request(model, 'Prompt', 4, 'api_default',
      { ...settings, magi2Mode: 'text' }, references));
    await submitMagi2Video(request, { signal: controller.signal, submissionKey: 'fixture-attempt' });
    await queryMagi2Video('original/task', model, { signal: controller.signal });
    assert.equal(calls[0].url, '/api/proxy/video/magi/submit');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(calls[0].init?.signal, controller.signal);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), request);
    assert.equal(request.seed, 0);
    assert.equal(calls[1].url, '/api/proxy/video/magi/status/original%2Ftask?model=' + model);
    assert.equal(calls[1].init?.signal, controller.signal);
  } finally {
    globalThis.fetch = previous;
  }
});
