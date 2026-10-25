import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldCollectNodeTextOutput } from '../src/utils/imageNodeOutputMode.ts';
import { collectLoopIterationMaterials } from '../src/utils/loopDerivedExecution.ts';

function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

test('image nodes output images only by default, including saved nodes without the setting', () => {
  assert.equal(shouldCollectNodeTextOutput('image', {}), false);
  assert.equal(shouldCollectNodeTextOutput('image', { imageOnlyOutput: true }), false);
  assert.equal(shouldCollectNodeTextOutput('edit', {}), false);
  assert.equal(shouldCollectNodeTextOutput('edit', { imageOnlyOutput: true }), false);
});

test('image nodes can explicitly restore prompt text output without affecting other nodes', () => {
  assert.equal(shouldCollectNodeTextOutput('image', { imageOnlyOutput: false }), true);
  assert.equal(shouldCollectNodeTextOutput('edit', { imageOnlyOutput: false }), true);
  assert.equal(shouldCollectNodeTextOutput('text', {}), true);
  assert.equal(shouldCollectNodeTextOutput('llm', { imageOnlyOutput: true }), true);
});

test('image-only output survives loop snapshots', () => {
  const imageNode = {
    id: 'image-1',
    type: 'image',
    position: { x: 0, y: 0 },
    data: { prompt: 'hidden prompt', imageUrl: 'result.png' },
  } as any;
  const textLoop = {
    id: 'loop-1',
    type: 'loop',
    position: { x: 0, y: 0 },
    data: { kind: 'text' },
  } as any;
  const edge = { id: 'image-loop', source: 'image-1', target: 'loop-1' } as any;

  assert.deepEqual(collectLoopIterationMaterials(textLoop, [textLoop, imageNode], [edge]), []);

  imageNode.data.imageOnlyOutput = false;
  assert.deepEqual(
    collectLoopIterationMaterials(textLoop, [textLoop, imageNode], [edge]).map((item) => item.url),
    ['hidden prompt'],
  );
});

test('ImageNode exposes the default-on output setting and every text collector honors it', () => {
  const imageNode = read('../src/components/nodes/ImageNode.tsx');
  const upstreamMaterials = read('../src/components/nodes/useUpstreamMaterials.ts');
  const outputNode = read('../src/components/nodes/OutputNode.tsx');
  const relayNode = read('../src/components/nodes/RelayNode.tsx');
  const randomRouteNode = read('../src/components/nodes/RandomRouteNode.tsx');
  const groupBoxNode = read('../src/components/nodes/GroupBoxNode.tsx');
  const sendMaterials = read('../src/utils/sendMaterials.ts');
  const canvas = read('../src/components/Canvas.tsx');
  const schema = JSON.parse(read('../backend/src/shared/canvasNodeSchema.json'));
  const imageSchema = schema.types.find((item: any) => item.type === 'image');

  assert.match(imageNode, /const imageOnlyOutput = d\?\.imageOnlyOutput !== false/);
  assert.match(imageNode, /checked=\{imageOnlyOutput\}/);
  assert.match(imageNode, /update\(\{ imageOnlyOutput: event\.currentTarget\.checked \}\)/);
  assert.match(imageNode, /translate\('nodes:image\.imageOnly'\)/);
  assert.match(imageNode, /aria-label=\{translate\('nodes:image\.imageOnlyAria'\)\}/);
  assert.match(upstreamMaterials, /shouldCollectNodeTextOutput\(n\.type, n\.data, ud\)/);
  assert.match(outputNode, /shouldCollectNodeTextOutput\(\(n as any\)\?\.type, n\?\.data, ud\)/);
  assert.match(outputNode, /ud\.imageOnlyOutput === false/);
  assert.match(relayNode, /shouldCollectNodeTextOutput\(n\?\.type, n\?\.data, ud\)/);
  assert.match(relayNode, /useNodeConnections\(\{ id: p\.id, handleType: 'target' \}\)/);
  assert.match(relayNode, /useNodesData\(upstreamIds\)/);
  assert.match(randomRouteNode, /shouldCollectNodeTextOutput\(upstreamNode\?\.type, upstreamNode\?\.data\)/);
  assert.match(randomRouteNode, /useNodeConnections\(\{ id: p\.id, handleType: 'target' \}\)/);
  assert.match(randomRouteNode, /useNodesData\(upstreamIds\)/);
  assert.match(groupBoxNode, /shouldCollectNodeTextOutput\(n\.type, n\.data\)/);
  assert.match(sendMaterials, /kind === 'text' && !shouldCollectNodeTextOutput\(node\.type, node\.data\)/);
  assert.match(canvas, /image:\s*\{[^\n]*imageOnlyOutput:\s*true/);
  assert.match(canvas, /edit:\s*\{[^\n]*imageOnlyOutput:\s*true/);
  assert.match(canvas, /suppressStandaloneTextOutputs[^\n]*shouldCollectNodeTextOutput\(t, d\)/);
  assert.equal(imageSchema.generation.allowedDataFields.imageOnlyOutput.type, 'boolean');
  assert.equal(imageSchema.generation.defaults.imageOnlyOutput, true);
});
