import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const readBuffer = (path: string) => readFileSync(new URL('../' + path, import.meta.url));

const SOURCE_URL = 'https://github.com/GuiYi-Xi/monoform-previs-studio';
const SOURCE_COMMIT = 'daa54b2f6e78cc69f07102f7d32f6fabe3ac4a54';

test('白模预演节点注册为可执行 3D 节点并公开标准输出端口', () => {
  const schema = JSON.parse(read('backend/src/shared/canvasNodeSchema.json'));
  const definition = schema.types.find((item: { type?: string }) => item.type === 'previs-studio');
  const ports = schema.connectionPorts['previs-studio'];
  assert.equal(definition.category, '3d');
  assert.notEqual(definition.visible, false);
  assert.equal(definition.executable, true);
  assert.equal(definition.label, '白模预演');
  assert.deepEqual(ports.inputs.map((port: { id: string }) => port.id), ['model3d']);
  assert.deepEqual(ports.outputs.map((port: { id: string }) => port.id), ['image', 'video', 'text', 'metadata']);
  assert.match(read('src/components/Canvas.tsx'), /'previs-studio':\s*PrevisStudioNode/);
  assert.match(read('src/types/canvas.ts'), /\|\s*'previs-studio'/);
});

test('完整工作台按需加载、Shadow DOM 隔离且保留节点级项目与受控导入', () => {
  const node = read('src/components/nodes/PrevisStudioNode.tsx');
  const editor = read('src/features/previs-studio/PrevisStudioEditor.tsx');
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  assert.match(node, /lazy\(\(\) => import\('\.\.\/\.\.\/features\/previs-studio\/PrevisStudioEditor'\)\)/);
  assert.doesNotMatch(node, /<Canvas[\s>]/);
  assert.match(editor, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(editor, /monoform-studio\.css\?inline/);
  assert.match(studio, /storageKey = PROJECT_STORAGE_KEY/);
  assert.match(studio, /normalizeProjectData\(initialProject\) \|\| readCachedProject\(storageKey\)/);
  assert.match(studio, /onImportAsset \? await onImportAsset\(file\)/);
  assert.match(studio, /onProjectChange\?\.\(currentProject\)/);
  assert.match(node, /const writeProject = useCallback/);
  assert.match(node, /if \(signature === lastProjectSignatureRef\.current\) return/);
});

test('上游 v0.6.0 工程 v16、多镜头和每镜独立状态完整接入', () => {
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const shots = read('src/features/previs-studio/ShotsPanel.jsx');
  assert.match(studio, /const PROJECT_VERSION = 16/);
  assert.match(studio, /const FPS_OPTIONS = \[24, 25, 30\]/);
  assert.match(studio, /durationSeconds: 15/);
  assert.match(studio, /if \(shots\.length >= 30\)/);
  assert.match(studio, /const liveShotRecord =/);
  assert.match(studio, /reference: cloneProjectValue\(DEFAULT_REFERENCE\)/);
  assert.match(studio, /objectKeyframes: \{\}/);
  assert.match(studio, /applyShotState\(target\)/);
  assert.match(shots, /previs\.studio\.shots\.title/);
  assert.match(shots, /shot\.durationSeconds/);
  assert.match(shots, /shot\.objectKeyframes/);
});

test('时间轴支持动态 1–60 秒、24/25/30 FPS，且不允许截掉现有关键帧', () => {
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  assert.match(studio, /clamp\(Math\.round\(Number\(settings\.durationSeconds\).*?, 1, 60\)/s);
  assert.match(studio, /const nextTotalFrames = next\.fps \* next\.durationSeconds/);
  assert.match(studio, /if \(nextTotalFrames < lastKeyframeFrame\)/);
  assert.match(studio, /requiredSeconds = Math\.max\(1, Math\.ceil\(lastKeyframeFrame \/ next\.fps\)\)/);
  assert.match(studio, /settings\.loopPlayback/);
  assert.match(studio, /totalFrames=\{totalFrames\}/);
});

test('动作模型、连续循环和人物状态关键帧来自上游当前实现', () => {
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const viewport = read('src/features/previs-studio/Viewport.jsx');
  const rig = read('src/features/previs-studio/rig.js');
  for (const pose of ['squat_full', 'sit_prepare', 'sit_low', 'sit', 'wave']) {
    assert.match(rig, new RegExp('\\b' + pose + ':'));
  }
  assert.match(rig, /export function poseCanLoop/);
  assert.match(rig, /loopable: true/);
  assert.match(studio, /continuousMotion/);
  assert.match(studio, /objectKeyframeFromObject/);
  assert.match(viewport, /xbot-animated\.glb/);
  assert.match(viewport, /animationTime/);
});

test('参考图、灯光、相机视角和变换工具均进入工作台与导出链', () => {
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const viewport = read('src/features/previs-studio/Viewport.jsx');
  for (const marker of ['ReferenceOverlay', 'LightingPanel', 'CameraAnglePanel', 'ViewportAspectPicker', 'transformSpace', 'snapEnabled', 'groundRequest', 'monitorMode']) {
    assert.match(studio, new RegExp(marker));
  }
  assert.match(studio, /includeInExport/);
  assert.match(studio, /referenceCanvasForExport/);
  assert.match(studio, /openEditorView/);
  assert.match(studio, /openCameraView/);
  assert.match(studio, /levelCameraHorizon/);
  assert.match(viewport, /cameraView/);
  assert.match(viewport, /editorCameraData/);
  assert.match(viewport, /transformSpace/);
  assert.match(viewport, /depthMesh/);
});

test('静帧和动画导出使用当前镜头 FPS、时长、画幅并保留 H.264/STOP 合同', () => {
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const node = read('src/components/nodes/PrevisStudioNode.tsx');
  assert.match(studio, /const nextExportFrameCount = totalFrames/);
  assert.match(studio, /getFirstEncodableVideoCodec\(\['avc'\]/);
  assert.match(studio, /for \(let sample = 0; sample < nextExportFrameCount; sample \+= 1\)/);
  assert.match(studio, /videoSource\.add\(sample \/ fps, 1 \/ fps/);
  assert.match(studio, /return \{ blob, width, height, fps, frameCount: nextExportFrameCount, durationSeconds: settings\.durationSeconds/);
  assert.match(studio, /PREVIS_EXPORT_CANCELLED/);
  assert.match(studio, /cancelExport:/);
  assert.match(node, /schema: 't8-previs-output-v1'/);
  assert.match(node, /copyFileToOutput\(uploadedUrl, filename, 'previs'\)/);
  assert.equal((node.match(/await reporter\.output\(/g) || []).length, 2);
});

test('上游出处、固定提交、动画来源和感谢信息均可审计', () => {
  const node = read('src/components/nodes/PrevisStudioNode.tsx');
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const notice = read('public/previs-studio/NOTICE.txt');
  const sources = read('public/previs-studio/models/ANIMATION_SOURCES.md');
  for (const content of [node, studio, notice]) {
    assert.ok(content.includes(SOURCE_URL));
    assert.ok(content.includes(SOURCE_COMMIT));
  }
  assert.match(sources, /RobotExpressive\.glb/);
  assert.match(sources, /CMU_13_29\.bvh/);
  assert.match(sources, /CC0 1\.0/);
});

test('固定导入的上游二进制资源没有漂移', () => {
  const assets = [
    ['public/previs-studio/models/xbot-animated.glb', 3_771_868, '25140d499f5912441cce324943c0960d8c8ad4914b272ded973105889a2a0726'],
    ['public/previs-studio/models/x-bot.fbx', 1_750_032, '3980c5f41ad0f6cfb835c6c0d61a2684082c83538cc3b20717950096dde256fd'],
    ['public/previs-studio/branding/monoform-mark.png', 25_735, 'b8ff858a4f1701d4744b9d2eca70c2f65ec857e21f9a97ce255f34ceaf27f438'],
  ] as const;
  for (const [path, size, sha256] of assets) {
    const url = new URL('../' + path, import.meta.url);
    assert.equal(statSync(url).size, size);
    assert.equal(createHash('sha256').update(readBuffer(path)).digest('hex'), sha256);
  }
});
