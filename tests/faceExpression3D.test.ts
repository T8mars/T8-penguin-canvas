import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  FACE_CHANNELS,
  FACE_EXPRESSION_PRESETS,
  applyFacePreset,
  applyPhotoCalibration,
  buildFaceBatchPlan,
  defaultFaceExpressionState,
  emptyFaceChannels,
  faceExpressionMetadata,
  normalizeFaceExpressionState,
  outputSizeForPreset,
  randomizeFaceExpression,
  setFaceChannel,
} from '../src/utils/faceExpression3D.ts';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';
import {
  FACE_EXPRESSION_LIBRARY_PRESETS,
  FACE_PRESET_LIBRARY_REFERENCES,
  FACE_PRESET_LIBRARY_LEVELS,
} from '../src/utils/faceExpressionPresetLibrary.ts';

function read(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('3D face expression schema exposes all 52 MediaPipe-compatible channels', () => {
  assert.equal(FACE_CHANNELS.length, 52);
  assert.equal(new Set(FACE_CHANNELS).size, 52);
  const state = defaultFaceExpressionState();
  assert.deepEqual(Object.keys(state.expression.channels).sort(), [...FACE_CHANNELS].sort());
});

test('face expression state normalizes unsafe persisted values', () => {
  const state = normalizeFaceExpressionState({
    expression: { channels: { jawOpen: 9 }, strength: -2 },
    output: { width: 9000, height: 1, format: 'jpeg', transparent: true },
    pose: { head: { yaw: 400 } },
  });
  assert.equal(state.expression.channels.jawOpen, 1);
  assert.equal(state.expression.strength, 0);
  assert.equal(state.output.width, 4096);
  assert.equal(state.output.height, 256);
  assert.equal(state.output.transparent, false);
  assert.equal(state.pose.head.yaw, 75);
});

test('symmetry lock mirrors left/right channels without changing unrelated values', () => {
  const base = defaultFaceExpressionState();
  const next = setFaceChannel(base, 'mouthSmileLeft', 0.72);
  assert.equal(next.expression.channels.mouthSmileLeft, 0.72);
  assert.equal(next.expression.channels.mouthSmileRight, 0.72);
  assert.equal(next.expression.channels.jawOpen, 0);
  const unlocked = setFaceChannel({ ...base, expression: { ...base.expression, symmetryLocked: false } }, 'eyeBlinkLeft', 0.8);
  assert.equal(unlocked.expression.channels.eyeBlinkLeft, 0.8);
  assert.equal(unlocked.expression.channels.eyeBlinkRight, 0);
});

test('replace presets clear residue while additive presets preserve it', () => {
  const base = defaultFaceExpressionState();
  const dirty = { ...base, expression: { ...base.expression, channels: { ...emptyFaceChannels(), tongueOut: 1 } } };
  const replaced = applyFacePreset(dirty, 'soft-smile', 'replace');
  assert.equal(replaced.expression.channels.tongueOut, 0);
  assert.ok(replaced.expression.channels.mouthSmileLeft > 0);
  const added = applyFacePreset(dirty, 'soft-smile', 'add');
  assert.equal(added.expression.channels.tongueOut, 1);
});

test('seeded random expression is reproducible and advances its seed', () => {
  const base = defaultFaceExpressionState();
  const a = randomizeFaceExpression(base);
  const b = randomizeFaceExpression(base);
  assert.deepEqual(a.expression.channels, b.expression.channels);
  assert.equal(a.expression.randomSeed, base.expression.randomSeed + 1);
});

test('batch planner supports pair and cartesian modes with stable order and cap', () => {
  const base = defaultFaceExpressionState();
  const pair = buildFaceBatchPlan(normalizeFaceExpressionState({
    ...base,
    batch: { mode: 'pair', expressionPresetIds: ['soft-smile', 'sad'], cameraPresetIds: ['portrait'], maxItems: 10 },
  }));
  assert.deepEqual(pair.map((item) => [item.expressionPresetId, item.cameraPresetId]), [['soft-smile', 'portrait'], ['sad', 'portrait']]);
  const cartesian = buildFaceBatchPlan(normalizeFaceExpressionState({
    ...base,
    batch: { mode: 'cartesian', expressionPresetIds: ['soft-smile', 'sad'], cameraPresetIds: ['portrait', 'close-up'], maxItems: 3 },
  }));
  assert.deepEqual(cartesian.map((item) => [item.expressionPresetId, item.cameraPresetId]), [
    ['soft-smile', 'portrait'], ['soft-smile', 'close-up'], ['sad', 'portrait'],
  ]);
});

test('output presets and metadata retain exact render settings', () => {
  const base = defaultFaceExpressionState();
  const output = outputSizeForPreset('9:16', base.output);
  assert.deepEqual([output.width, output.height], [1152, 2048]);
  const state = normalizeFaceExpressionState({ ...base, output });
  const metadata = faceExpressionMetadata(state, '/files/output/face.png');
  assert.equal(metadata.schema, 't8-face-expression-state');
  assert.equal(metadata.output.width, 1152);
  assert.equal(metadata.imageUrl, '/files/output/face.png');
});

test('photo calibration updates measurable proportions, colors and blendshapes', () => {
  const base = defaultFaceExpressionState();
  const calibrated = applyPhotoCalibration(base, {
    sourceUrl: '/files/input/portrait.png', analyzedAt: '2026-07-12T00:00:00.000Z', confidence: 0.9,
    faceWidth: 1.1, faceHeight: 0.95, jawWidth: 1.04, eyeSpacing: 0.98, eyeSize: 1.08,
    browHeight: 1.02, noseLength: 0.96, noseWidth: 1.03, mouthWidth: 1.06, lipThickness: 1.12,
    skinColor: '#C58F73', hairColor: '#241C19', irisColor: '#526A70',
  }, { mouthSmileLeft: 0.66, mouthSmileRight: 0.64 });
  assert.equal(calibrated.model.proportions.faceWidth, 1.1);
  assert.equal(calibrated.model.skinColor, '#C58F73');
  assert.equal(calibrated.expression.channels.mouthSmileLeft, 0.66);
  assert.equal(calibrated.model.photoCalibration?.sourceUrl, '/files/input/portrait.png');
});

test('built-in presets have unique ids and a neutral fallback', () => {
  assert.equal(new Set(FACE_EXPRESSION_PRESETS.map((item) => item.id)).size, FACE_EXPRESSION_PRESETS.length);
  assert.equal(FACE_EXPRESSION_PRESETS[0]?.id, 'neutral');
});

test('validated preset library contains 100 bounded, distinct and conflict-free expressions', () => {
  assert.equal(FACE_EXPRESSION_LIBRARY_PRESETS.length, 100);
  assert.equal(FACE_PRESET_LIBRARY_REFERENCES.compoundExpressions, 'https://doi.org/10.1073/pnas.1322355111');
  assert.equal(FACE_PRESET_LIBRARY_LEVELS.length, 4);
  assert.equal(new Set(FACE_EXPRESSION_LIBRARY_PRESETS.map((item) => item.id)).size, 100);
  assert.equal(new Set(FACE_EXPRESSION_LIBRARY_PRESETS.map((item) => item.name)).size, 100);
  assert.deepEqual(
    Object.fromEntries(['basic', 'compound', 'social'].map((category) => [category, FACE_EXPRESSION_LIBRARY_PRESETS.filter((item) => item.category === category).length])),
    { basic: 24, compound: 60, social: 16 },
  );

  const channelSet = new Set<string>(FACE_CHANNELS);
  for (const preset of FACE_EXPRESSION_LIBRARY_PRESETS) {
    const entries = Object.entries(preset.channels);
    assert.ok(entries.length > 0, `${preset.id} has no active channels`);
    assert.ok(preset.actionUnits.length > 0, `${preset.id} has no evidence basis`);
    for (const [channel, value] of entries) {
      assert.ok(channelSet.has(channel), `${preset.id} uses unknown channel ${channel}`);
      assert.ok(Number(value) >= 0 && Number(value) <= 1, `${preset.id}.${channel} is outside 0..1`);
    }
    const c = preset.channels;
    assert.ok(!((c.eyeBlinkLeft || 0) > 0.35 && (c.eyeWideLeft || 0) > 0.35), `${preset.id} conflicts on left eyelid`);
    assert.ok(!((c.eyeBlinkRight || 0) > 0.35 && (c.eyeWideRight || 0) > 0.35), `${preset.id} conflicts on right eyelid`);
    assert.ok(!((c.mouthSmileLeft || 0) > 0.35 && (c.mouthFrownLeft || 0) > 0.35), `${preset.id} conflicts on left mouth corner`);
    assert.ok(!((c.mouthSmileRight || 0) > 0.35 && (c.mouthFrownRight || 0) > 0.35), `${preset.id} conflicts on right mouth corner`);
  }

  const base = defaultFaceExpressionState();
  const applied = applyFacePreset(base, 'library-happily-surprised-standard', 'replace');
  assert.equal(applied.expression.presetId, 'library-happily-surprised-standard');
  assert.ok(applied.expression.channels.mouthSmileLeft > 0);
  assert.ok(applied.expression.channels.browInnerUp > 0);
});

test('default model is the licensed ICT neutral human head and legacy defaults migrate', () => {
  const base = defaultFaceExpressionState();
  assert.equal(base.model.adapterId, 't8-ict-neutral-head-v1');
  assert.equal(base.model.adapterVersion, 3);
  assert.equal(base.model.visibleParts.hair, false);
  assert.equal(base.model.skinColor, '#B8BAB8');
  assert.equal(base.model.irisColor, '#536563');

  const migrated = normalizeFaceExpressionState({
    model: {
      source: 'procedural', adapterId: 't8-studio-head-v1', adapterVersion: 1,
      skinColor: '#D8A17E', hairColor: '#2B211D', irisColor: '#4B6B78',
      visibleParts: { hair: true },
    },
  });
  assert.equal(migrated.model.adapterId, 't8-ict-neutral-head-v1');
  assert.equal(migrated.model.adapterVersion, 3);
  assert.equal(migrated.model.visibleParts.hair, false);
  assert.equal(migrated.model.skinColor, '#B8BAB8');

  const customized = normalizeFaceExpressionState({
    model: {
      source: 'procedural', adapterId: 't8-studio-head-v1', adapterVersion: 1,
      skinColor: '#C58F73', hairColor: '#241C19', visibleParts: { hair: true },
    },
  });
  assert.equal(customized.model.skinColor, '#C58F73');
  assert.equal(customized.model.visibleParts.hair, true);
});

test('node is registered as executable 3D image/metadata producer and persists local outputs', () => {
  const types = read('src/types/canvas.ts');
  const canvas = read('src/components/Canvas.tsx');
  const node = read('src/components/nodes/FaceExpression3DNode.tsx');
  assert.match(types, /'face-expression-3d'/);
  assertProductionNodeSchema('face-expression-3d', {
    label: '3D表情编辑',
    category: '3d',
    inputs: ['model3d', 'image', 'metadata'],
    outputs: ['image', 'metadata'],
    executable: true,
  });
  assert.match(canvas, /FaceExpression3DNode/);
  assert.match(canvas, /'face-expression-3d'/);
  assert.match(node, /uploadDataUrl\(dataUrl/);
  assert.match(node, /imageUrls: urls/);
  assert.match(node, /outputText:\s*''/);
  assert.doesNotMatch(node, /outputText:\s*`3D 表情图片/);
  assert.match(node, /useRunTrigger\(id/);
  assert.doesNotMatch(node, /imageUrl:\s*dataUrl/);
});

test('editor exposes every required professional workflow tab and photo analysis uses FaceLandmarker', () => {
  const editor = read('src/components/face-expression-3d/FaceExpression3DEditor.tsx');
  const resources = read('src/i18n/resources.ts');
  const analysis = read('src/utils/facePhotoAnalysis.ts');
  const scene = read('src/three/faceExpression/FaceExpressionScene.ts');
  for (const id of ['expression', 'presets', 'pose', 'camera', 'lighting', 'output', 'batch']) {
    assert.match(editor, new RegExp(`\\{ id: '${id}', labelKey: 'tabs\\.${id}'`));
  }
  assert.match(editor, /useTranslation\('nodes'\)/);
  assert.match(editor, /faceExpression3d\.editor/);
  assert.match(editor, /data-testid="face-expression-preset-library"/);
  assert.match(editor, /filteredLibraryPresets\.length\}\/100/);
  assert.match(editor, /editorT\('professional52'\)/);
  assert.match(editor, /simpleChannels\.\$\{channel\}/);
  assert.match(editor, /channels\.\$\{channel\}/);
  assert.match(editor, /editorT\('photoBoundary'\)/);
  assert.match(resources, /professional52: '专业 52'/);
  assert.match(resources, /professional52: 'Pro 52'/);
  assert.match(resources, /mouthSmileLeft: '微笑'/);
  assert.match(resources, /mouthSmileLeft: 'Smile'/);
  assert.match(analysis, /FaceLandmarker/);
  assert.match(analysis, /outputFaceBlendshapes: true/);
  assert.match(scene, /GLTFLoader/);
  assert.match(scene, /BUILTIN_FACE_MODEL_URL = '\/assets\/face-expression\/t8-ict-neutral-head-v1\.glb'/);
  assert.match(scene, /loadModel\(BUILTIN_FACE_MODEL_URL, 'builtin'\)/);
  assert.doesNotMatch(scene, /this\.procedural/);
  assert.doesNotMatch(scene, /createProceduralHead|T8NeutralClayHead|SphereGeometry|BoxGeometry/);
  assert.match(editor, /editorT\('neutralCompare'\)/);
  assert.match(editor, /editorT\('modelHealthSource'\)/);
  assert.match(resources, /ICT Face Model Light/);
  assert.match(scene, /exportImage/);
  assert.match(scene, /4096/);
});

test('bundled ICT GLB is licensed, compact and exposes the exact T8 52-channel schema', () => {
  const modelUrl = new URL('../public/assets/face-expression/t8-ict-neutral-head-v1.glb', import.meta.url);
  const model = readFileSync(modelUrl);
  const jsonLength = model.readUInt32LE(12);
  const gltf = JSON.parse(model.subarray(20, 20 + jsonLength).toString('utf8').trim());
  const manifest = JSON.parse(read('public/assets/face-expression/asset-manifest.json'));
  const builder = read('scripts/build-ict-face-glb.cjs');
  const license = read('public/assets/face-expression/LICENSE-ICT-FaceKit.txt');
  assert.ok(model.length < 25 * 1024 * 1024, `model is ${(model.length / 1024 / 1024).toFixed(2)} MB`);
  assert.deepEqual(gltf.meshes[0].extras.targetNames, [...FACE_CHANNELS]);
  assert.equal(gltf.meshes[0].primitives.length, 12);
  assert.equal(gltf.extras.adapterId, 't8-ict-neutral-head-v1');
  assert.equal(gltf.extras.license, 'MIT');
  assert.equal(manifest.expressionChannels, 52);
  assert.equal(manifest.sizeBytes, model.length);
  assert.equal(manifest.sha256, createHash('sha256').update(model).digest('hex').toUpperCase());
  assert.match(builder, /const IRIS_FORWARD_OFFSET = 0\.006/);
  assert.doesNotMatch(builder, /vertices\[index \* 3 \+ 2\] \+= 0\.025/);
  assert.ok(manifest.modifications.some((item: string) => item.includes('eyeBlink morphs close')));
  assert.match(license, /Copyright \(c\) 2020 USC Institute for Creative Technologies/);
  const packageJson = read('package.json');
  const postBuild = read('electron/_post_build.cjs');
  assert.match(packageJson, /"face-model:build": "node scripts\/build-ict-face-glb\.cjs"/);
  assert.match(packageJson, /"from": "dist",\s*"to": "frontend",\s*"filter": \[\s*"\*\*\/\*"/);
  for (const required of ['t8-ict-neutral-head-v1.glb', 'asset-manifest.json', 'LICENSE-ICT-FaceKit.txt']) {
    assert.match(postBuild, new RegExp(required.replaceAll('.', '\\.')));
  }
});
