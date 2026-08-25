import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasReusableGenerationResult,
  shouldReuseGenerationResult,
} from '../src/utils/reuseGenerationResult.ts';

function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

test('reuse is opt-in and falls back to generation when no usable output exists', () => {
  assert.equal(shouldReuseGenerationResult('image', { imageUrl: '/output/old.png' }), false);
  assert.equal(shouldReuseGenerationResult('image', { reuseResult: true }), false);
  assert.equal(shouldReuseGenerationResult('video', { reuseResult: true, taskId: 'old-task', prompt: 'old prompt' }), false);
  assert.equal(shouldReuseGenerationResult('audio', { reuseResult: true, tracks: [] }), false);
});

test('each requested generation family recognizes only its downstream output kind', () => {
  assert.equal(shouldReuseGenerationResult('image', { reuseResult: true, imageUrl: '/output/image.png' }), true);
  assert.equal(shouldReuseGenerationResult('image', { reuseResult: true, videoUrl: '/output/video.mp4' }), false);
  assert.equal(shouldReuseGenerationResult('video', { reuseResult: true, videoUrl: '/output/video.mp4' }), true);
  assert.equal(shouldReuseGenerationResult('seedance', { reuseResult: true, videoUrls: ['https://cdn.test/sd.mp4'] }), true);
  assert.equal(shouldReuseGenerationResult('audio', {
    reuseResult: true,
    tracks: [{ audioUrl: 'data:audio/mpeg;base64,AAAA' }],
  }), true);
});

test('RH generators accept real media outputs and RH toolbox also accepts text output', () => {
  assert.equal(shouldReuseGenerationResult('runninghub', { reuseResult: true, urls: ['/output/rh.webp'] }), true);
  assert.equal(shouldReuseGenerationResult('rh-tools', { reuseResult: true, audioUrl: '/output/rh.mp3' }), true);
  assert.equal(shouldReuseGenerationResult('rh-toolbox', { reuseResult: true, outputText: 'expanded prompt' }), true);
  assert.equal(hasReusableGenerationResult('runninghub', { outputText: 'not a RunningHub media result' }), false);
});

test('all requested node surfaces expose the default-off option and unified skip predicate', () => {
  const files = [
    ['ImageNode.tsx', 'image'],
    ['VideoNode.tsx', 'video'],
    ['SeedanceNode.tsx', 'seedance'],
    ['AudioNode.tsx', 'audio'],
    ['RunningHubNode.tsx', 'runninghub'],
    ['RHToolsNode.tsx', 'rh-tools'],
    ['RHToolboxNode.tsx', 'rh-toolbox'],
  ] as const;

  for (const [file, kind] of files) {
    const source = read(`../src/components/nodes/${file}`);
    assert.match(source, /<ReuseResultToggle/);
    assert.match(source, /checked=\{d\?\.reuseResult === true\}/);
    assert.match(source, /update\(\{ reuseResult: checked \}\)/);
    assert.match(source, new RegExp(`shouldReuseGenerationResult\\('${kind}', nodeData\\)`));
  }
});

test('unified run hook skips the executor but still archives reused output and completes the run', () => {
  const hook = read('../src/hooks/useRunTrigger.ts');
  assert.match(hook, /shouldReuseResult\?: \(nodeData: Record<string, unknown>\) => boolean/);
  assert.match(hook, /if \(reusedExistingResult\)[\s\S]*phase: 'reused-existing-output'[\s\S]*return;/);
  assert.match(hook, /!reusedExistingResult && \(initialTrace\.provider \|\| initialTrace\.model\)/);
  assert.match(hook, /reusedResult: true/);
  assert.match(hook, /markDone\(executionNodeId, capturedExecutionToken, true\)/);
});

test('new nodes and shared schema default reuseResult to false', () => {
  const canvas = read('../src/components/Canvas.tsx');
  const schema = JSON.parse(read('../backend/src/shared/canvasNodeSchema.json'));
  const requiredTypes = ['image', 'video', 'seedance', 'audio', 'runninghub', 'runninghub-wallet', 'rh-tools', 'rh-toolbox', 'edit'];

  for (const type of requiredTypes) {
    const entry = schema.types.find((item: any) => item.type === type);
    assert.equal(entry.generation.allowedDataFields.reuseResult.type, 'boolean', type);
    assert.equal(entry.generation.defaults.reuseResult, false, type);
  }
  assert.match(canvas, /image: \{[^\n]*reuseResult: false/);
  assert.match(canvas, /video: \{ reuseResult: false \}/);
  assert.match(canvas, /audio: \{[^\n]*reuseResult: false/);
  assert.match(canvas, /runninghub: \{ reuseResult: false \}/);
  assert.match(canvas, /'runninghub-wallet': \{ reuseResult: false \}/);
});
