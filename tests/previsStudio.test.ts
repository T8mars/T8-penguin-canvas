import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readBuffer = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));

const SOURCE_URL = 'https://github.com/GuiYi-Xi/monoform-previs-studio';
const SOURCE_COMMIT = '77f4bae83eeee550a6f416757231f438155bf674';

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
  const canvas = read('src/components/Canvas.tsx');
  assert.match(canvas, /'previs-studio':\s*PrevisStudioNode/);
  assert.match(canvas, /'previs-studio':\s*\{/);
  assert.match(read('src/types/canvas.ts'), /\|\s*'previs-studio'/);
});

test('完整工作台按需加载且样式隔离，不在紧凑节点常驻 WebGL', () => {
  const node = read('src/components/nodes/PrevisStudioNode.tsx');
  const editor = read('src/features/previs-studio/PrevisStudioEditor.tsx');
  assert.match(node, /lazy\(\(\) => import\('\.\.\/\.\.\/features\/previs-studio\/PrevisStudioEditor'\)\)/);
  assert.match(node, /createPortal\(/);
  assert.match(node, /t\('previs\.fullWorkbench'\)/);
  assert.doesNotMatch(node, /<Canvas[\s>]/);
  assert.match(editor, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(editor, /monoform-studio\.css\?inline/);
});

test('工作台保留人物、道具、摄像机、关键帧、姿态和工程能力', () => {
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const viewport = read('src/features/previs-studio/Viewport.jsx');
  const rig = read('src/features/previs-studio/rig.js');
  for (const marker of ['Timeline', 'SceneList', 'LeftSidebar', 'Inspector', 'saveProject', 'loadProject', 'addKeyframe', 'addObjectKeyframe']) {
    assert.match(studio, new RegExp(marker));
  }
  assert.match(viewport, /TransformControls/);
  assert.match(viewport, /xbot-animated\.glb/);
  assert.equal((rig.match(/bone\('/g) || []).length >= 27, true);
  assert.match(rig, /\.\.\.fingerBones\('Left'/);
  assert.match(rig, /\.\.\.fingerBones\('Right'/);
  assert.match(rig, /export const RIG_PRESETS/);
});

test('静帧和动画导出遵守 5 秒、24 FPS、H.264 MP4 与停止合同', () => {
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const node = read('src/components/nodes/PrevisStudioNode.tsx');
  assert.match(studio, /const FPS = 24/);
  assert.match(studio, /const TOTAL_FRAMES = 120/);
  assert.match(studio, /getFirstEncodableVideoCodec\(\['avc'\]/);
  assert.match(studio, /for \(let frame = 0; frame < TOTAL_FRAMES; frame \+= 1\)/);
  assert.match(studio, /PREVIS_EXPORT_CANCELLED/);
  assert.match(studio, /cancelExport:/);
  assert.match(node, /createCanvasNodeExecutionKey\(originCanvasIdRef\.current, id\)/);
  assert.match(node, /cancelTargets\.includes\(executionNodeId\)/);
  assert.match(node, /status: 'stopped', taskStatus: 'cancelled'/);
  assert.match(node, /schema: 't8-previs-output-v1'/);
  assert.match(node, /role: 'composition_reference'/);
  assert.match(node, /role: 'motion_camera_reference'/);
  assert.match(node, /copyFileToOutput\(uploadedUrl, filename, 'previs'\)/);
  assert.match(node, /\/files\/output\/previs\//);
  assert.match(node, /hasUnsafeLegacyOutput/);
  assert.match(node, /clearLegacyVideo/);
  assert.match(node, /clearLegacyImage/);
  assert.equal((node.match(/await reporter\.output\(/g) || []).length, 2);
  assert.match(node, /kind: 'image', sourceUrl: url, filename, mimeType: 'image\/png'/);
  assert.match(node, /kind: 'video', sourceUrl: url, filename, mimeType: 'video\/mp4'/);
});

test('参考项目出处、固定提交和感谢在节点与完整工作台中均可见', () => {
  const node = read('src/components/nodes/PrevisStudioNode.tsx');
  const studio = read('src/features/previs-studio/MonoformStudio.jsx');
  const resources = read('src/i18n/resources.ts');
  const notice = read('public/previs-studio/NOTICE.txt');
  for (const content of [node, studio, notice]) {
    assert.ok(content.includes(SOURCE_URL));
    assert.ok(content.includes(SOURCE_COMMIT));
  }
  assert.match(node, /t\('previs\.thanks'\)/);
  assert.match(studio, /t\('previs\.studio\.sourceCredit'\)/);
  assert.match(resources, /感谢原作者/);
  assert.match(resources, /thanks to the original author/);
});

test('固定导入的上游二进制资源没有漂移', () => {
  const assets = [
    ['public/previs-studio/models/xbot-animated.glb', 2_930_032, '002f8d269de68e5dce3d25195caf390d1aa359bbfaae3fcf4c8dc78ec36c3ba5'],
    ['public/previs-studio/models/x-bot.fbx', 1_750_032, '3980c5f41ad0f6cfb835c6c0d61a2684082c83538cc3b20717950096dde256fd'],
    ['public/previs-studio/branding/monoform-mark.png', 25_735, 'b8ff858a4f1701d4744b9d2eca70c2f65ec857e21f9a97ce255f34ceaf27f438'],
  ] as const;
  for (const [path, size, sha256] of assets) {
    const url = new URL(`../${path}`, import.meta.url);
    assert.equal(statSync(url).size, size);
    assert.equal(createHash('sha256').update(readBuffer(path)).digest('hex'), sha256);
  }
});
