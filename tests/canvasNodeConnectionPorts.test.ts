import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Edge, Node } from '@xyflow/react';
import {
  getNodeConnectionPort,
  getNodePortKinds,
  isConnectionValid,
  resolveNodeConnectionPorts,
} from '../src/config/portTypes.ts';
import { analyzeWorkflow } from '../src/utils/workflowDoctor.ts';

type PortKind = 'text' | 'image' | 'video' | 'audio' | 'model3d' | 'metadata' | 'config' | 'any';
type Resolver = 'static' | 'upload' | 'material-set' | 'loop' | 'pick-from-set' | 'random-route' | 'subflow' | 'toolbox-param';

interface ManifestPort {
  id: string | null;
  kinds: PortKind[];
  required: boolean;
  minConnections: number;
  maxConnections: number | null;
  preferred?: boolean;
}

interface ManifestAuthority {
  resolver: Resolver;
  inputs: ManifestPort[];
  outputs: ManifestPort[];
}

interface Manifest {
  schema: string;
  version: number;
  connectionPorts: Record<string, ManifestAuthority>;
  types: Array<{ type: string }>;
}

const manifest = JSON.parse(
  readFileSync(new URL('../backend/src/shared/canvasNodeSchema.json', import.meta.url), 'utf8'),
) as Manifest;

const EXPECTED_SIGNATURES: Record<string, string> = {
  upload: 'upload|none->null[image|video|audio|model3d]',
  'model-3d-upload': 'static|none->null[model3d]',
  'model-3d-preview': 'static|null[model3d]->null[image]',
  'model-3d': 'static|null[text|image]->null[model3d]',
  'world-scene': 'static|input[model3d]->image[image],scene[model3d]',
  'code-animation': 'static|prompt[text]->video[video],storyboard[text]',
  'volcengine-assets': 'static|none->image[image],video[video],audio[audio]',
  'localization-master': 'static|source-media[video|audio],source-text[text],voice-references[audio|video]->localized-video[video],dubbed-audio[audio],subtitles[text],manifest[metadata]',
  'grok-image-tools': 'static|null[image|metadata]->null[image|metadata]',
  'material-set': 'material-set|null[text|image|video|audio]->null[text|image|video|audio]',
  'generation-target': 'static|null[text|image]->null[image]',
  output: 'static|null[text|image|video|audio|model3d|any]->null[any]',
  'feishu-bitable-input': 'static|none->text[text],image[image],video[video],audio[audio],metadata[metadata]',
  'feishu-bitable-output': 'static|null[text|image|video|audio|metadata|any]->text[text],metadata[metadata]',
  text: 'static|null[text|image|video|audio]->null[text]',
  image: 'static|null[text|image]->null[image]',
  video: 'static|null[text|image|video|audio]->null[video]',
  'video-edit': 'static|null[video]->null[video|audio]',
  seedance: 'static|null[text|image|video|audio]->null[video]',
  seedance25: 'static|null[text|image|video|audio]->null[video]',
  'fashvsr-video-upscale': 'static|null[video]->null[video]',
  'director-storyboard': 'static|null[text|image|video|audio]->null[video|text]',
  story: 'static|null[text|image|video|audio]->null[video|text]',
  'script-master': 'static|null[text|image|video|audio]->null[text|metadata]',
  audio: 'static|null[text|image|audio|video],speaker[text]->audio-0[audio],audio-1[audio],text[text],video[video]',
  llm: 'static|null[text|image|video]->null[text]',
  'minimax-h3-prompt-enhancer': 'static|null[text|image|video]->null[text]',
  'minimax-music3-prompt-enhancer': 'static|music-idea[text],lyrics[text]->lyrics[text],music-caption[text],payload[text],report[metadata]',
  'minimax-h3-official-prompt-enhancer': 'static|null[text|image|video|audio]->null[text]',
  'seedance20-prompt-enhancer': 'static|null[text|image|video]->null[text]',
  'mv-music-master': 'static|master-audio[audio],lyrics[text],identity-image[image],style-image[image],motion-reference[video]->final-video[video],master-audio[audio],storyboards[image],prompt-pack[text],manifest[metadata]',
  runninghub: 'static|null[text|image|video|audio|config]->null[image|video]',
  'runninghub-wallet': 'static|null[text|image|video|audio|config]->null[image|video]',
  'rh-config': 'static|null[text|image|video|audio]->null[config]',
  'rh-tools': 'static|null[text|image|video|audio]->null[image|video|audio]',
  'rh-toolbox': 'static|null[text|image|video|audio]->null[text|image|video|audio]',
  vibex: 'static|null[text|image|video|audio]->null[text|image|video|audio]',
  'fal-toolbox': 'static|null[text|image|video|audio]->null[text|image|video|audio|model3d]',
  'grok-oauth-agent': 'static|null[text|image|video|audio]->text[text],image[image],video[video],audio[audio]',
  'codex-cli-agent': 'static|text[text],image[image],video[video],audio[audio]->text[text],image[image],video[video],audio[audio],model3d[model3d]',
  'codex-image-conjure': 'static|text[text],image[image]->image[image],text[text]',
  'artist-style-master': 'static|text[text]->text[text],image[image]',
  'anime-tag-master': 'static|text[text],image[image]->text[text],image[image]',
  'comfyui-store': 'static|null[text|image|video|audio]->null[text|image|video|audio]',
  'comfyui-app-maker': 'static|none->null[text]',
  'multi-angle-3d': 'static|null[text|image]->null[image]',
  'panorama-720': 'static|null[text]->null[image]',
  'penguin-portrait': 'static|null[text|image|metadata]->null[image]',
  'portrait-metadata': 'static|none->null[metadata]',
  'storyboard-grid': 'static|null[image]->null[image]',
  'drawing-board': 'static|null[image]->null[image]',
  browser: 'static|none->null[text|image]',
  'image-compare': 'static|a[image],b[image]->null[image]',
  'frame-extractor': 'static|null[video]->null[image]',
  'frame-pair': 'static|null[video]->first[image],last[image]',
  loop: 'loop|null[text|image|video|audio]->null[text|image|video|audio]',
  'random-route': 'random-route|input_data[any]->none',
  subflow: 'subflow|none->none',
  'pick-from-set': 'pick-from-set|null[text|image|video|audio]->null[text|image|video|audio]',
  'text-split': 'static|null[text]->null[text]',
  resize: 'static|null[image]->null[image]',
  combine: 'static|null[image]->null[image]',
  'remove-bg': 'static|null[image]->null[image]',
  upscale: 'static|null[image]->null[image]',
  'grid-crop': 'static|null[image]->null[image]',
  'grid-editor': 'static|null[image]->null[image]',
  edit: 'static|null[text|image]->null[image]',
  idea: 'static|none->null[text]',
  bp: 'static|none->null[text]',
  relay: 'static|null[any]->null[any]',
  'remove-ai-watermark': 'static|null[image|video|audio]->null[image|video|audio|text|metadata]',
  'video-output': 'static|null[video]->none',
  cinematic: 'toolbox-param|none->null[text]',
  'video-motion': 'toolbox-param|none->null[text]',
  'multi-angle-visual': 'toolbox-param|null[image]->null[text]',
  'portrait-master': 'static|null[text|metadata]->null[text|metadata]',
  'pose-master': 'static|null[text|image|metadata]->null[image|text|metadata]',
  'aggregate-parser': 'static|null[text]->null[text|image|video|audio]',
  'batch-processor': 'static|null[image|video|audio|model3d]->none',
  'batch-tagger': 'static|null[image|video|text]->text[text],metadata[metadata]',
  'topaz-image-upscale': 'static|null[image]->null[image]',
  'topaz-video-upscale': 'static|null[video]->null[video]',
  'face-expression-3d': 'static|model3d[model3d],image[image],metadata[metadata]->image[image],metadata[metadata]',
  'previs-studio': 'static|model3d[model3d]->image[image],video[video],text[text],metadata[metadata]',
  'panorama-3d': 'static|null[image]->null[image]',
};

function portListSignature(ports: ManifestPort[]) {
  return ports.length === 0
    ? 'none'
    : ports.map((port) => `${port.id === null ? 'null' : port.id}[${port.kinds.join('|')}]`).join(',');
}

function authoritySignature(authority: ManifestAuthority) {
  return `${authority.resolver}|${portListSignature(authority.inputs)}->${portListSignature(authority.outputs)}`;
}

function canvasNode(type: string, data: Record<string, unknown> = {}, id = `node-${type}`): Node {
  return { id, type, position: { x: 0, y: 0 }, data } as Node;
}

function requireResolved(node: Node) {
  const resolution = resolveNodeConnectionPorts(node);
  assert.equal(resolution.resolved, true, resolution.resolved ? undefined : `${node.type}: ${resolution.reason}`);
  if (!resolution.resolved) throw new Error(resolution.reason);
  return resolution;
}

function dynamicFixture(type: string): Record<string, unknown> {
  if (type === 'upload') return { uploadType: 'image' };
  if (type === 'material-set') return { materialSetKind: 'image', materialSetItems: [{ url: 'https://example.test/a.png' }] };
  if (type === 'loop') return { kind: 'image' };
  if (type === 'pick-from-set') return { pickKind: 'image' };
  if (type === 'random-route') return { randomRouteTotalOutputs: 3 };
  if (type === 'subflow') {
    return {
      definitionId: 'fixture-flow',
      definitionVersion: 2,
      definition: {
        id: 'fixture-flow', version: 2,
        inputs: [{ id: 'prompt', kind: 'text', required: true, maxConnections: 1 }],
        outputs: [{ id: 'result', kind: 'image', required: false }],
      },
    };
  }
  if (type === 'video-motion' || type === 'multi-angle-visual') return { kind: type };
  return {};
}

test('all production types have a valid, exact connection authority matching audited JSX Handles', () => {
  assert.equal(manifest.schema, 't8-canvas-node-schema-v1');
  assert.equal(manifest.version, 1);
  const auditedCount = Object.keys(EXPECTED_SIGNATURES).length;
  assert.equal(manifest.types.length, auditedCount);
  assert.equal(new Set(manifest.types.map((entry) => entry.type)).size, auditedCount);
  assert.deepEqual(Object.keys(manifest.connectionPorts).sort(), Object.keys(EXPECTED_SIGNATURES).sort());
  assert.deepEqual(manifest.types.map((entry) => entry.type).sort(), Object.keys(manifest.connectionPorts).sort());

  const resolvers = new Set<Resolver>(['static', 'upload', 'material-set', 'loop', 'pick-from-set', 'random-route', 'subflow', 'toolbox-param']);
  const kinds = new Set<PortKind>(['text', 'image', 'video', 'audio', 'model3d', 'metadata', 'config', 'any']);
  for (const [type, authority] of Object.entries(manifest.connectionPorts)) {
    assert.equal(resolvers.has(authority.resolver), true, `${type} resolver`);
    assert.equal(authoritySignature(authority), EXPECTED_SIGNATURES[type], `${type} authority`);
    for (const direction of ['inputs', 'outputs'] as const) {
      assert.equal(new Set(authority[direction].map((port) => port.id)).size, authority[direction].length, `${type} ${direction} IDs`);
      for (const port of authority[direction]) {
        assert.equal(port.id === null || (typeof port.id === 'string' && port.id.length > 0 && port.id.trim() === port.id), true, `${type} port ID`);
        assert.equal(Array.isArray(port.kinds) && port.kinds.length > 0, true, `${type} port kinds`);
        assert.equal(new Set(port.kinds).size, port.kinds.length, `${type} duplicate kinds`);
        assert.equal(port.kinds.every((kind) => kinds.has(kind)), true, `${type} unknown kind`);
        assert.equal(typeof port.required, 'boolean', `${type} required`);
        assert.equal(Number.isSafeInteger(port.minConnections) && port.minConnections >= 0, true, `${type} minimum`);
        assert.equal(port.maxConnections === null
          || (Number.isSafeInteger(port.maxConnections) && port.maxConnections >= port.minConnections), true, `${type} maximum`);
        if (port.preferred !== undefined) assert.equal(typeof port.preferred, 'boolean', `${type} preferred`);
      }
    }
  }
});

test('the runtime resolver handles every production node type without aggregate fallback', () => {
  for (const { type } of manifest.types) {
    const resolution = requireResolved(canvasNode(type, dynamicFixture(type)));
    assert.equal(resolution.resolver, manifest.connectionPorts[type].resolver, type);
  }
});

test('fixed null and named Handles are exact and cannot inherit aggregate node kinds', () => {
  const batchTagger = canvasNode('batch-tagger');
  assert.deepEqual(getNodePortKinds(batchTagger, 'output', 'text'), ['text']);
  assert.deepEqual(getNodePortKinds(batchTagger, 'output', 'metadata'), ['metadata']);
  assert.deepEqual(getNodePortKinds(batchTagger, 'output', 'bogus'), []);
  assert.equal(getNodeConnectionPort(batchTagger, 'output', null), null);

  const output = canvasNode('output', {}, 'output');
  const text = canvasNode('text', {}, 'text');
  assert.equal(isConnectionValid(text, output, { sourceHandle: null, targetHandle: null }), true);
  assert.equal(isConnectionValid(text, output, { sourceHandle: null, targetHandle: 'bogus' }), false);
  assert.deepEqual(getNodePortKinds(canvasNode('bp'), 'input', null), []);
  assert.deepEqual(getNodePortKinds(canvasNode('portrait-metadata'), 'input', null), []);

  const codex = canvasNode('codex-cli-agent', {}, 'codex');
  const drawingBoard = canvasNode('drawing-board', {}, 'drawing');
  assert.equal(isConnectionValid(codex, drawingBoard, { sourceHandle: 'text', targetHandle: null }), false);
  assert.equal(isConnectionValid(codex, drawingBoard, { sourceHandle: 'image', targetHandle: null }), true);
  assert.equal(isConnectionValid(
    canvasNode('feishu-bitable-input', {}, 'feishu'),
    canvasNode('text-split', {}, 'split'),
    { sourceHandle: 'metadata', targetHandle: null },
  ), false);

  const group = canvasNode('groupBox', {}, 'group');
  assert.deepEqual(getNodePortKinds(group, 'output', 'group-out'), ['any']);
  assert.deepEqual(getNodePortKinds(group, 'output', null), []);
  assert.equal(isConnectionValid(group, output, { sourceHandle: 'group-out', targetHandle: null }), true);
});

test('upload, material-set, loop, and pick-from-set resolve instance discriminators like their JSX components', () => {
  for (const kind of ['image', 'video', 'audio', 'model3d'] as const) {
    assert.deepEqual(requireResolved(canvasNode('upload', { uploadType: kind })).outputs[0].kinds, [kind]);
  }
  for (const uploadType of [undefined, '', 'bogus', 42]) {
    assert.deepEqual(requireResolved(canvasNode('upload', { uploadType })).outputs[0].kinds, []);
  }

  const material = (data: Record<string, unknown>) => requireResolved(canvasNode('material-set', data));
  assert.deepEqual(material({}).inputs[0].kinds, ['text', 'image', 'video', 'audio']);
  assert.deepEqual(material({ materialSetKind: 'bogus', materialSetItems: [{ url: 'https://example.test/a.png' }] }).outputs[0].kinds, []);
  assert.deepEqual(material({ materialSetKind: 'image', materialSetItems: [] }).outputs[0].kinds, []);
  assert.deepEqual(material({ materialSetKind: 'image', materialSetItems: [{ kind: 'image', url: '  ' }] }).outputs[0].kinds, []);
  assert.deepEqual(material({ materialSetKind: 'image', materialSetItems: [{ kind: 'video', url: 'https://example.test/a.mp4' }] }).outputs[0].kinds, []);
  assert.deepEqual(material({ materialSetKind: 'image', materialSetItems: [{ kind: 'invalid', url: 'https://example.test/a.png' }] }).outputs[0].kinds, []);
  assert.deepEqual(material({ materialSetKind: 'image', materialSetItems: [{ url: 'https://example.test/a.png' }] }).outputs[0].kinds, ['image']);
  assert.deepEqual(material({ materialSetKind: 'text', materialSetItems: [{ text: 'hello' }] }).outputs[0].kinds, ['text']);
  assert.deepEqual(material({ materialSetKind: 'text', materialSetItems: [{ url: 'hello' }] }).outputs[0].kinds, ['text']);
  assert.deepEqual(material({ materialSetKind: 'text', materialSetItems: [{ text: '   ', url: 'fallback-is-not-used' }] }).outputs[0].kinds, []);

  for (const kind of ['text', 'image', 'video', 'audio'] as const) {
    const loop = requireResolved(canvasNode('loop', { kind }));
    const pick = requireResolved(canvasNode('pick-from-set', { pickKind: kind }));
    assert.deepEqual([loop.inputs[0].kinds, loop.outputs[0].kinds], [[kind], [kind]]);
    assert.deepEqual([pick.inputs[0].kinds, pick.outputs[0].kinds], [[kind], [kind]]);
  }
  const customLoop = requireResolved(canvasNode('loop', { kind: 'text', mode: 'parallel-custom' }));
  assert.deepEqual(customLoop.inputs[0].kinds, ['text', 'image', 'video', 'audio']);
  assert.deepEqual(customLoop.outputs[0].kinds, ['text']);
  assert.equal(isConnectionValid(
    canvasNode('upload', { uploadType: 'image' }, 'image-source'),
    canvasNode('loop', { kind: 'text', mode: 'parallel-custom' }, 'custom-loop'),
    { sourceHandle: null, targetHandle: null },
  ), true);
  for (const discriminator of [undefined, '', 'bogus', 42]) {
    assert.deepEqual(requireResolved(canvasNode('loop', { kind: discriminator })).outputs[0].kinds, ['image']);
    assert.deepEqual(requireResolved(canvasNode('pick-from-set', { pickKind: discriminator })).outputs[0].kinds, ['image']);
  }
});

test('random-route exposes only input_data and the normalized output_1..output_N Handles', () => {
  for (const [requested, expected] of [[1, 1], [10, 10], [100, 100], [0, 1], [101, 100]] as const) {
    const resolution = requireResolved(canvasNode('random-route', { randomRouteTotalOutputs: requested }));
    assert.deepEqual(resolution.inputs.map((port) => port.id), ['input_data']);
    assert.equal(resolution.outputs.length, expected);
    assert.equal(resolution.outputs[0].id, 'output_1');
    assert.equal(resolution.outputs.at(-1)?.id, `output_${expected}`);
    assert.equal(resolution.outputs.every((port) => port.kinds.length === 1 && port.kinds[0] === 'any'), true);
  }
  const route = canvasNode('random-route', { randomRouteTotalOutputs: 3 });
  assert.deepEqual(getNodePortKinds(route, 'input', 'input_data'), ['any']);
  assert.deepEqual(getNodePortKinds(route, 'output', 'output_3'), ['any']);
  for (const handle of ['output_4', 'output_01', 'input_data', null]) {
    assert.deepEqual(getNodePortKinds(route, 'output', handle), []);
  }
  assert.deepEqual(getNodePortKinds(route, 'input', null), []);
});

test('subflow identity, version, revision, and cross-direction Handle IDs fail closed when forged', () => {
  const validData = dynamicFixture('subflow');
  const valid = requireResolved(canvasNode('subflow', validData));
  assert.deepEqual(valid.inputs.map((port) => [port.id, port.kinds]), [['prompt', ['text']]]);
  assert.deepEqual(valid.outputs.map((port) => [port.id, port.kinds]), [['result', ['image']]]);

  const unresolved = (data: Record<string, unknown>) => assert.equal(resolveNodeConnectionPorts(canvasNode('subflow', data)).resolved, false);
  unresolved({ ...validData, definitionId: 'forged-flow' });
  unresolved({ ...validData, definitionVersion: 3 });
  unresolved({ ...validData, definitionVersion: 0 });
  unresolved({ ...validData, definitionVersion: '2' });
  unresolved({ ...validData, definitionVersion: true });
  unresolved({ ...validData, definitionId: undefined });
  unresolved({
    ...validData,
    definitionRevision: 4,
    definition: { ...(validData.definition as Record<string, unknown>), revision: 5 },
  });
  unresolved({
    ...validData,
    definition: {
      ...(validData.definition as Record<string, unknown>),
      inputs: [{ id: 'shared', kind: 'text' }],
      outputs: [{ id: 'shared', kind: 'image' }],
    },
  });
  for (const badPort of [
    { id: ' bad', kind: 'text' },
    { id: 'fractional-minimum', kind: 'text', minConnections: 1.5 },
    { id: 'fractional-maximum', kind: 'text', maxConnections: 1.5 },
    { id: 'string-minimum', kind: 'text', minConnections: '1' },
    { id: 'non-boolean-required', kind: 'text', required: 1 },
  ]) {
    unresolved({
      ...validData,
      definition: { ...(validData.definition as Record<string, unknown>), inputs: [badPort] },
    });
  }
});

test('toolbox parameter nodes enforce type-kind identity while cinematic preserves its component default', () => {
  assert.equal(requireResolved(canvasNode('cinematic')).resolver, 'toolbox-param');
  assert.equal(requireResolved(canvasNode('video-motion', { kind: 'video-motion' })).resolver, 'toolbox-param');
  assert.equal(requireResolved(canvasNode('multi-angle-visual', { kind: 'multi-angle-visual' })).resolver, 'toolbox-param');
  assert.equal(resolveNodeConnectionPorts(canvasNode('video-motion')).resolved, false);
  assert.equal(resolveNodeConnectionPorts(canvasNode('cinematic', { kind: 'video-motion' })).resolved, false);
  assert.equal(resolveNodeConnectionPorts(canvasNode('cinematic', { kind: 42 })).resolved, false);
  assert.equal(resolveNodeConnectionPorts(canvasNode('multi-angle-visual', { kind: 'cinematic' })).resolved, false);
});

test('Workflow Doctor reports exact bad Handles, named-port type mismatches, and isolated unresolved contracts', () => {
  const nodes: Node[] = [
    canvasNode('batch-tagger', {}, 'tagger'),
    canvasNode('text-split', {}, 'split'),
    canvasNode('text', {}, 'text'),
    canvasNode('output', {}, 'output'),
    canvasNode('codex-cli-agent', {}, 'codex'),
    canvasNode('drawing-board', {}, 'drawing'),
    canvasNode('video-motion', { kind: 'cinematic' }, 'bad-toolbox'),
    canvasNode('subflow', {
      definitionId: 'fixed', definitionVersion: 1,
      definition: { id: 'forged', version: 1, inputs: [], outputs: [] },
    }, 'bad-subflow'),
  ];
  const edges: Edge[] = [
    { id: 'bad-named-source', source: 'tagger', target: 'split', sourceHandle: 'bogus', targetHandle: null },
    { id: 'bad-fixed-target', source: 'text', target: 'output', sourceHandle: null, targetHandle: 'bogus' },
    { id: 'named-kind-mismatch', source: 'codex', target: 'drawing', sourceHandle: 'text', targetHandle: null },
  ];
  const issues = analyzeWorkflow(nodes, edges);
  assert.equal(issues.some((issue) => issue.ruleId === 'ports.handle-unknown' && issue.edgeIds.includes('bad-named-source')), true);
  assert.equal(issues.some((issue) => issue.ruleId === 'ports.handle-unknown' && issue.edgeIds.includes('bad-fixed-target')), true);
  assert.equal(issues.some((issue) => issue.ruleId === 'ports.type-incompatible' && issue.edgeIds.includes('named-kind-mismatch')), true);
  assert.equal(issues.some((issue) => issue.ruleId === 'ports.handle-unknown' && issue.location.scope === 'node' && issue.nodeIds.includes('bad-toolbox')), true);
  assert.equal(issues.some((issue) => issue.ruleId === 'ports.handle-unknown' && issue.location.scope === 'subflow' && issue.nodeIds.includes('bad-subflow')), true);
});
