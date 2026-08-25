import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';

const loadRhToolboxUtils = async () => import('../src/utils/rhToolbox.ts');
const loadRhToolboxCapabilities = async () => import('../src/utils/rhToolboxCapabilities.ts');
const loadRhToolboxDeveloper = async () => import('../src/utils/rhToolboxDeveloper.ts');
const loadRhToolboxManifest = async () => import('../src/data/rhToolboxManifest.ts');
const loadSmartTranslation = async () => import('../src/utils/smartTranslation.ts');
const rhToolboxMakerNodeUrl = new URL('../src/components/nodes/RHToolboxMakerNode.tsx', import.meta.url);
const rhToolboxDeveloperUrl = new URL('../src/utils/rhToolboxDeveloper.ts', import.meta.url);
const hasRhToolboxMakerSource = existsSync(rhToolboxMakerNodeUrl);
const hasRhToolboxDeveloperSource = existsSync(rhToolboxDeveloperUrl);

test('RH toolbox node is registered as a visible executable RH node', () => {
  const types = readFileSync(new URL('../src/types/canvas.ts', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const actionBar = readFileSync(new URL('../src/components/NodeActionBar.tsx', import.meta.url), 'utf8');
  const loop = readFileSync(new URL('../src/components/nodes/LoopNode.tsx', import.meta.url), 'utf8');

  assertProductionNodeSchema('rh-toolbox', {
    label: 'RH工具箱',
    category: 'rh',
    inputs: ['text', 'image', 'video', 'audio'],
    outputs: ['text', 'image', 'video', 'audio'],
    executable: true,
  });
  assert.match(types, /\|\s*'rh-toolbox'/);
  assert.match(canvas, /const RHToolboxNode = lazyCanvasNode\(\(\) => import\('\.\/nodes\/RHToolboxNode'\), 'RHToolboxNode'\)/);
  assert.match(canvas, /'rh-toolbox': RHToolboxNode/);
  assert.match(canvas, /'rh-toolbox':\s*\{/);
  assert.match(canvas, /import \{ EXECUTABLE_NODE_TYPES \} from '\.\.\/config\/executableNodeTypes'/);
  assert.match(actionBar, /EXECUTABLE_NODE_TYPES\.has\(n\.type\)/);
  assert.match(loop, /import \{ EXECUTABLE_NODE_TYPES \} from '\.\.\/\.\.\/config\/executableNodeTypes'/);
  assert.match(loop, /topologicalSort\([^;]+EXECUTABLE_NODE_TYPES\)/s);
});

test('RH image capability service exposes cutout, upscale, and expand wrappers for batch processing', () => {
  const service = readFileSync(new URL('../src/services/rhToolboxCapabilities.ts', import.meta.url), 'utf8');
  const presets = readFileSync(new URL('../src/utils/rhToolboxCapabilities.ts', import.meta.url), 'utf8');

  assert.match(service, /export function runRhImageCutout/);
  assert.match(service, /export function runRhImageUpscale/);
  assert.match(service, /export function runRhImageExpand/);
  assert.match(service, /preferredToolId:\s*'image-upscale-4k'/);
  assert.match(service, /capability:\s*'image\.expand'/);
  assert.match(presets, /defaultParamPresetId:\s*'landscape-16-9'/);
  assert.match(presets, /wide-21-9/);
});

test('RH smart translation is a persisted text capability shared by Text, LLM/Vision, and text Output surfaces', async () => {
  const { RH_TOOLBOX_MANIFEST } = await loadRhToolboxManifest();
  const {
    buildRhToolboxNodeInfoList,
    buildRhToolboxQuickActions,
    findRhToolboxToolById,
    normalizeRhToolboxManifest,
  } = await loadRhToolboxUtils();
  const { resolveRhToolboxCapability } = await loadRhToolboxCapabilities();
  const { protectSmartTranslationText, restoreSmartTranslationText } = await loadSmartTranslation();
  const manifest = normalizeRhToolboxManifest(RH_TOOLBOX_MANIFEST);
  const tool = findRhToolboxToolById(manifest, 'translate-cutout-v1');

  assert.equal(tool?.title, '智能翻译');
  assert.equal(tool?.webappId, '2084616885802463233');
  assert.deepEqual(tool?.capabilities, ['text.translate']);
  assert.equal(tool?.inputSchema[0]?.kind, 'text');
  assert.equal(tool?.inputSchema[0]?.rhNodeId, '5');
  assert.equal(tool?.inputSchema[0]?.fieldName, 'prompt');
  assert.equal(tool?.inputSchema[0]?.required, true);
  assert.deepEqual(tool?.outputSchema, [{
    key: 'output-text',
    label: '翻译结果',
    kind: 'text',
    role: 'text-only',
  }]);
  assert.equal(tool?.ui?.showInTextEditor, true);
  assert.equal(resolveRhToolboxCapability(manifest, {
    surface: 'text',
    capability: 'text.translate',
    preferredToolId: 'translate-cutout-v1',
  })?.id, 'translate-cutout-v1');
  assert.deepEqual(buildRhToolboxQuickActions(manifest, 'text').map((action) => action.toolId), ['translate-cutout-v1']);
  assert.deepEqual(buildRhToolboxNodeInfoList(tool!, {
    inputValues: { prompt: 'who are you' },
  }), [{ nodeId: '5', fieldName: 'prompt', fieldValue: 'who are you', valueType: 'text' }]);

  const staleMakerManifest = normalizeRhToolboxManifest({
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    categories: [{ id: 'text-category-nfjhp', name: '翻译', parentId: 'text' }],
    tools: [{
      id: 'translate-cutout-v1',
      title: '智能翻译',
      categoryId: 'text-category-nfjhp',
      webappId: '2084616885802463233',
      enabled: true,
      capabilities: ['image.cutout', 'image.edit'],
      inputSchema: [{ key: 'prompt', kind: 'text', rhNodeId: '5', fieldName: 'prompt', required: false }],
      outputSchema: [{ key: 'output-image', kind: 'image', role: 'append-output' }],
      ui: { showInTextEditor: false },
    }],
  });
  const migrated = findRhToolboxToolById(staleMakerManifest, 'translate-cutout-v1');
  assert.deepEqual(migrated?.capabilities, ['text.translate']);
  assert.equal(migrated?.inputSchema[0]?.required, true);
  assert.equal(migrated?.outputSchema[0]?.kind, 'text');
  assert.equal(migrated?.ui?.showInTextEditor, true);

  const protectedText = protectSmartTranslationText('hello @img1', ['@img1']);
  assert.equal(protectedText.requestText, 'hello __T8_MEDIA_REF_1__');
  assert.equal(restoreSmartTranslationText('你好 __t8_media_ref_1__', protectedText.replacements), '你好 @img1');
  assert.throws(
    () => restoreSmartTranslationText('你好', protectedText.replacements),
    /未保留素材引用 @img1/,
  );

  const service = readFileSync(new URL('../src/services/rhToolboxCapabilities.ts', import.meta.url), 'utf8');
  const button = readFileSync(new URL('../src/components/SmartTranslateButton.tsx', import.meta.url), 'utf8');
  const mentionInput = readFileSync(new URL('../src/components/nodes/MentionPromptInput.tsx', import.meta.url), 'utf8');
  const textNode = readFileSync(new URL('../src/components/nodes/TextNode.tsx', import.meta.url), 'utf8');
  const llmNode = readFileSync(new URL('../src/components/nodes/LLMNode.tsx', import.meta.url), 'utf8');
  const outputNode = readFileSync(new URL('../src/components/nodes/OutputNode.tsx', import.meta.url), 'utf8');
  const backendSettings = readFileSync(new URL('../backend/src/routes/settings.js', import.meta.url), 'utf8');
  assert.match(service, /export async function runRhTextTranslation/);
  assert.match(service, /capability:\s*'text\.translate'/);
  assert.match(service, /restoreSmartTranslationText/);
  assert.match(button, /data-smart-translate-trigger/);
  assert.match(button, /status:\s*'stale'/);
  assert.match(mentionInput, /toolbarAction\?: ReactNode/);
  assert.match(textNode, /<SmartTranslateButton[\s\S]*text=\{text\}/);
  assert.match(textNode, /rebaseMediaMentions/);
  assert.match(llmNode, /<SmartTranslateButton[\s\S]*text=\{localPrompt\}/);
  assert.match(outputNode, /<SmartTranslateButton[\s\S]*text=\{displayText\}/);
  assert.match(outputNode, /update\(\{ outputText: translatedText, smartTranslation: record \}\)/);
  assert.match(backendSettings, /RH_SMART_TRANSLATION_WEBAPP_ID/);
  assert.match(backendSettings, /capabilities:\s*\['text\.translate'\]/);
});

test('RH video material shortcuts ship frame extraction, cutout, and RH video upscalers', async () => {
  const { RH_TOOLBOX_MANIFEST } = await loadRhToolboxManifest();
  const {
    buildRhToolboxNodeInfoList,
    buildRhToolboxQuickActions,
    findRhToolboxToolById,
    normalizeRhToolboxManifest,
  } = await loadRhToolboxUtils();
  const { resolveRhToolboxCapability } = await loadRhToolboxCapabilities();
  const service = readFileSync(new URL('../src/services/rhToolboxCapabilities.ts', import.meta.url), 'utf8');
  const presets = readFileSync(new URL('../src/utils/rhToolboxCapabilities.ts', import.meta.url), 'utf8');
  const rail = readFileSync(new URL('../src/components/RhVideoCapabilityRail.tsx', import.meta.url), 'utf8');
  const uploadNode = readFileSync(new URL('../src/components/nodes/UploadNode.tsx', import.meta.url), 'utf8');
  const outputNode = readFileSync(new URL('../src/components/nodes/OutputNode.tsx', import.meta.url), 'utf8');

  const manifest = normalizeRhToolboxManifest(RH_TOOLBOX_MANIFEST);
  const category = manifest.categories.find((item) => item.id === 'video-category-9d33p');
  assert.equal(category?.name, '视频超分');
  assert.equal(category?.parentId, 'video');
  const cutoutCategory = manifest.categories.find((item) => item.id === 'video-category-9dael');
  assert.equal(cutoutCategory?.name, '视频抠像');
  assert.equal(cutoutCategory?.parentId, 'video');
  assert.match(rail, /status: result\.cancelled \? 'stopped' : result\.failedItems\.length > 0 \? 'partial' : 'succeeded'/);
  assert.match(rail, /if \(result\.failedItems\.length > 0\)[\s\S]*throw new Error\(warning\)/);

  const nvidia = findRhToolboxToolById(manifest, 'video-nividia-upscale');
  assert.equal(nvidia?.title, '英伟达极速超分');
  assert.equal(nvidia?.webappId, '2032095665941123073');
  assert.deepEqual(nvidia?.capabilities, ['video.upscale', 'video.edit']);
  assert.equal(nvidia?.inputSchema[0]?.kind, 'video');
  assert.equal(nvidia?.inputSchema[0]?.rhNodeId, '3');
  assert.equal(nvidia?.outputSchema[0]?.kind, 'video');
  assert.equal(nvidia?.ui?.showInVideoEditor, true);
  assert.deepEqual(
    buildRhToolboxNodeInfoList(nvidia!, {
      inputValues: { 'source-video': 'rh-uploaded-fast.mp4' },
    }),
    [{ nodeId: '3', fieldName: 'video', fieldValue: 'rh-uploaded-fast.mp4', valueType: 'video' }],
  );

  const flashVsr = findRhToolboxToolById(manifest, 'video-flashvsr');
  assert.equal(flashVsr?.title, 'FlashVsr慢速超分');
  assert.equal(flashVsr?.webappId, '2043165928090767362');
  assert.deepEqual(flashVsr?.capabilities, ['video.upscale', 'video.edit']);
  assert.equal(flashVsr?.inputSchema[0]?.kind, 'video');
  assert.equal(flashVsr?.inputSchema[0]?.rhNodeId, '9');
  assert.equal(flashVsr?.inputSchema[0]?.fieldName, 'file');
  assert.equal(flashVsr?.outputSchema[0]?.kind, 'video');
  assert.equal(flashVsr?.ui?.showInVideoEditor, true);

  const videoCutout = findRhToolboxToolById(manifest, 'video-removebg-v1');
  assert.equal(videoCutout?.title, '视频抠像');
  assert.equal(videoCutout?.webappId, '2036113391479169025');
  assert.deepEqual(videoCutout?.capabilities, ['video.cutout', 'video.edit']);
  assert.equal(videoCutout?.inputSchema.find((item) => item.key === 'source-video')?.rhNodeId, '51');
  assert.equal(videoCutout?.inputSchema.find((item) => item.key === 'prompt')?.rhNodeId, '53');
  assert.equal(videoCutout?.outputSchema[0]?.kind, 'video');
  assert.equal(videoCutout?.ui?.showInVideoEditor, true);
  assert.deepEqual(
    buildRhToolboxNodeInfoList(videoCutout!, {
      inputValues: { 'source-video': 'rh-uploaded-cutout.mp4' },
    }),
    [
      { nodeId: '53', fieldName: 'prompt', fieldValue: '男人', valueType: 'text' },
      { nodeId: '51', fieldName: 'video', fieldValue: 'rh-uploaded-cutout.mp4', valueType: 'video' },
      { nodeId: '51', fieldName: 'skip_first_frames', fieldValue: 0, valueType: 'number' },
      { nodeId: '51', fieldName: 'frame_load_cap', fieldValue: 0, valueType: 'number' },
      { nodeId: '56', fieldName: 'value', fieldValue: 960, valueType: 'number' },
    ],
  );

  assert.equal(resolveRhToolboxCapability(manifest, {
    surface: 'video',
    capability: 'video.cutout',
    preferredToolId: 'video-removebg-v1',
  })?.id, 'video-removebg-v1');
  assert.equal(resolveRhToolboxCapability(manifest, {
    surface: 'video',
    capability: 'video.upscale',
    preferredToolId: 'video-nividia-upscale',
  })?.id, 'video-nividia-upscale');
  assert.deepEqual(
    new Set(buildRhToolboxQuickActions(manifest, 'video').map((action) => action.toolId)),
    new Set(['bernini1', 'bernini2', 'video-removebg-v1', 'video-nividia-upscale', 'video-flashvsr']),
  );

  assert.match(presets, /RH_VIDEO_CAPABILITY_PRESETS/);
  assert.match(service, /export async function runRhVideoCapabilityBatch/);
  assert.match(presets, /preferredToolId:\s*'video-removebg-v1'/);
  assert.match(presets, /preferredToolId:\s*'video-nividia-upscale'/);
  assert.match(presets, /preferredToolId:\s*'video-flashvsr'/);
  assert.match(service, /export function runRhVideoCutout/);
  assert.match(service, /RH_VIDEO_CAPABILITY_PRESETS\.cutout\.preferredToolId/);
  assert.match(service, /RH_VIDEO_CAPABILITY_PRESETS\.fastUpscale\.preferredToolId/);
  assert.match(service, /RH_VIDEO_CAPABILITY_PRESETS\.qualityUpscale\.preferredToolId/);
  assert.match(rail, /首尾帧获取/);
  assert.match(rail, /抠像/);
  assert.match(rail, /Scissors/);
  assert.match(rail, /极速超分/);
  assert.match(rail, /质量超分/);
  assert.match(rail, /snapshotVideoFrameAsync/);
  assert.match(rail, /probeVideo/);
  assert.match(rail, /runRhVideoCapabilityBatch/);
  assert.match(uploadNode, /RhVideoCapabilityRail/);
  assert.match(uploadNode, /uploadType === 'video'/);
  assert.match(uploadNode, /handleVideoProduce\(result\.videoUrls/);
  assert.match(uploadNode, /rhCapabilityOutput:\s*true/);
  assert.match(uploadNode, /rhToolboxToolId:\s*_meta\?\.toolId/);
  assert.match(outputNode, /RhVideoCapabilityRail/);
  assert.match(outputNode, /collected\.videos/);
  assert.match(outputNode, /handleVideoProduce\(result\.videoUrls/);
  assert.match(outputNode, /rhCapabilityOutput:\s*true/);
  assert.match(outputNode, /rhToolboxToolId:\s*_meta\?\.toolId/);
});

test('RH toolbox manifest ships maintainer release tools for packaged users', async () => {
  const { RH_TOOLBOX_MANIFEST } = await loadRhToolboxManifest();
  const {
    buildRhToolboxNodeInfoList,
    buildRhToolboxQuickActions,
    filterRhToolboxTools,
    findRhToolboxToolById,
    getRhToolboxToolMajorCategory,
    isRhToolboxBuiltinCategoryId,
    listRhToolboxTools,
    normalizeRhToolboxManifest,
  } = await loadRhToolboxUtils();
  const { resolveRhToolboxCapability } = await loadRhToolboxCapabilities();

  const manifest = normalizeRhToolboxManifest(RH_TOOLBOX_MANIFEST);

  assert.equal(manifest.schema, 't8-rh-toolbox-manifest');
  assert.match(String(manifest.updatedAt || ''), /^2026-08-04/);
  assert.equal(manifest.categories.length, 12);
  const categories = new Map(manifest.categories.map((category) => [category.id, category]));
  assert.deepEqual(
    [
      'custom-rh-tools',
      'text-category-nfjhp',
      'video-category-fwv2n',
      'image-category-d5zwl',
      'image-category-remove-subject',
      'video-category-e2v4g',
      'image-category-e78o2',
      'video-category-6djrs',
      'image-category-e7but',
      'video-category-9d33p',
      'video-category-9dael',
      'image-category-8h6ed',
    ]
      .map((id) => [id, categories.get(id)?.name, categories.get(id)?.parentId]),
    [
      ['custom-rh-tools', '抠图', 'image'],
      ['text-category-nfjhp', '翻译', 'text'],
      ['video-category-fwv2n', '图生视频', 'video'],
      ['image-category-d5zwl', '图像编辑', 'image'],
      ['image-category-remove-subject', '消除主体', 'image'],
      ['video-category-e2v4g', '文生视频', 'video'],
      ['image-category-e78o2', '电商', 'image'],
      ['video-category-6djrs', '视频去水印', 'video'],
      ['image-category-e7but', '扩图', 'image'],
      ['video-category-9d33p', '视频超分', 'video'],
      ['video-category-9dael', '视频抠像', 'video'],
      ['image-category-8h6ed', '移除主体', 'image'],
    ],
  );
  assert.equal(listRhToolboxTools(manifest).length, 15);
  assert.deepEqual(
    listRhToolboxTools(manifest).map((tool) => tool.id),
    [
      'image-cutout-v1',
      'image-upscale-4k',
      'tuantiquv10',
      'bernini1',
      'berninituxiangbianji',
      'bernini2',
      'translate-cutout-v1',
      'jimenfenshen1',
      'kuotu-1',
      'video-removebg-v1',
      'xiaochuzhuti',
      'xiaoyunqueheng',
      'xiaoyunqueshu',
      'video-nividia-upscale',
      'video-flashvsr',
    ],
  );
  for (const tool of listRhToolboxTools(manifest)) {
    const pollIntervalMs = tool.runtime?.pollIntervalMs || 5000;
    const maxPolls = tool.runtime?.maxPolls || 720;
    assert.ok(
      pollIntervalMs * maxPolls >= 60 * 60 * 1000,
      `${tool.id} should keep at least a 60 minute RH polling budget`,
    );
  }
  assert.equal(listRhToolboxTools(manifest, { includeDisabled: true }).length, 15);
  assert.equal(isRhToolboxBuiltinCategoryId('image-tools'), true);
  assert.equal(isRhToolboxBuiltinCategoryId('custom-rh-tools'), false);
  assert.equal(getRhToolboxToolMajorCategory(manifest.tools[0], manifest.categories), 'image');
  assert.deepEqual(
    filterRhToolboxTools(manifest, { majorCategoryId: 'video' }).map((tool) => tool.id),
    ['bernini1', 'bernini2', 'jimenfenshen1', 'video-removebg-v1', 'xiaoyunqueheng', 'xiaoyunqueshu', 'video-nividia-upscale', 'video-flashvsr'],
  );
  assert.deepEqual(
    filterRhToolboxTools(manifest, { capability: 'image.cutout' }).map((tool) => tool.id),
    ['image-cutout-v1', 'tuantiquv10', 'jimenfenshen1', 'kuotu-1', 'xiaochuzhuti', 'xiaoyunqueheng', 'xiaoyunqueshu'],
  );
  assert.deepEqual(
    filterRhToolboxTools(manifest, { capability: 'image.upscale' }).map((tool) => tool.id),
    ['image-upscale-4k'],
  );
  assert.deepEqual(
    filterRhToolboxTools(manifest, { capability: 'video.cutout' }).map((tool) => tool.id),
    ['video-removebg-v1'],
  );
  assert.deepEqual(
    filterRhToolboxTools(manifest, { capability: 'image.remove-subject' }).map((tool) => tool.id),
    [],
  );
  assert.equal(resolveRhToolboxCapability(manifest, { surface: 'image', capability: 'image.expand' })?.id, 'kuotu-1');
  assert.equal(resolveRhToolboxCapability(manifest, { surface: 'image', capability: 'image.remove-subject' })?.id, 'xiaochuzhuti');
  assert.deepEqual(
    new Set(buildRhToolboxQuickActions(manifest, 'image').map((action) => action.toolId)),
    new Set([
      'image-cutout-v1',
      'image-upscale-4k',
      'jimenfenshen1',
      'kuotu-1',
      'tuantiquv10',
      'xiaochuzhuti',
      'xiaoyunqueheng',
      'xiaoyunqueshu',
      'berninituxiangbianji',
    ]),
  );
  assert.deepEqual(
    new Set(buildRhToolboxQuickActions(manifest, 'video').map((action) => action.toolId)),
    new Set(['bernini1', 'bernini2', 'video-removebg-v1', 'video-nividia-upscale', 'video-flashvsr']),
  );

  const cutout = findRhToolboxToolById(manifest, 'image-cutout-v1');
  assert.equal(cutout?.title, '高清抠图');
  assert.equal(cutout?.webappId, '2066002530877927426');
  assert.equal(cutout?.inputSchema[0]?.rhNodeId, '46');
  assert.equal(cutout?.outputSchema[0]?.kind, 'image');

  const upscale4k = findRhToolboxToolById(manifest, 'image-upscale-4k');
  assert.equal(upscale4k?.title, '高清放大4K');
  assert.equal(upscale4k?.webappId, '2066353965784199169');
  assert.equal(upscale4k?.runtime?.instanceType, 'plus');
  assert.equal(upscale4k?.inputSchema[0]?.rhNodeId, '5');
  assert.deepEqual(
    buildRhToolboxNodeInfoList(upscale4k, {
      inputValues: { 'source-image': 'rh-uploaded-upscale.png' },
    }).filter((item) => ['image', 'resolution', 'aspectRatio', 'prompt'].includes(item.fieldName)),
    [
      { nodeId: '5', fieldName: 'image', fieldValue: 'rh-uploaded-upscale.png', valueType: 'image' },
    ],
  );

  const removeSubject = findRhToolboxToolById(manifest, 'xiaochuzhuti');
  assert.equal(removeSubject?.title, '消除主体');
  assert.equal(removeSubject?.webappId, '2067098822521745410');
  assert.equal(removeSubject?.inputSchema[0]?.rhNodeId, '44');
  assert.deepEqual(removeSubject?.capabilities, ['image.cutout', 'image.edit']);
  assert.deepEqual(
    buildRhToolboxNodeInfoList(removeSubject, {
      inputValues: { 'source-image': 'rh-uploaded-remove-subject.png' },
    }),
    [
      { nodeId: '44', fieldName: 'image', fieldValue: 'rh-uploaded-remove-subject.png', valueType: 'image' },
    ],
  );

  const tuantiqu = findRhToolboxToolById(manifest, 'tuantiquv10');
  assert.equal(tuantiqu?.webappId, '2034251740148666369');
  const aspectRatio = tuantiqu?.userParams?.find((param) => param.key === 'node-22-aspect_ratio');
  assert.equal(aspectRatio?.kind, 'select');
  assert.ok((aspectRatio?.options?.length || 0) >= 10);
  assert.ok(aspectRatio?.options?.includes('16:9 landscape 1344x768'));
  assert.deepEqual(
    buildRhToolboxNodeInfoList(tuantiqu, {
      inputValues: { 'source-image': 'rh-uploaded-a.png' },
      userParamValues: { 'node-22-aspect_ratio': '16:9 landscape 1344x768' },
    }).filter((item) => (item.nodeId === '39' && item.fieldName === 'image') || item.fieldName === 'aspect_ratio'),
    [
      { nodeId: '39', fieldName: 'image', fieldValue: 'rh-uploaded-a.png', valueType: 'image' },
      { nodeId: '22', fieldName: 'aspect_ratio', fieldValue: '16:9 landscape 1344x768', valueType: 'select' },
    ],
  );
  assert.deepEqual(
    buildRhToolboxNodeInfoList(tuantiqu, {
      inputValues: { 'source-image': 'rh-uploaded-b.png' },
      userParamValues: {
        aspect_ratio: '9:16 portrait 768x1344',
        width: 768,
        height: 1344,
      },
    }).filter((item) => (
      (item.nodeId === '39' && item.fieldName === 'image') ||
      (item.nodeId === '22' && ['aspect_ratio', 'width', 'height'].includes(item.fieldName))
    )),
    [
      { nodeId: '39', fieldName: 'image', fieldValue: 'rh-uploaded-b.png', valueType: 'image' },
      { nodeId: '22', fieldName: 'aspect_ratio', fieldValue: '9:16 portrait 768x1344', valueType: 'select' },
      { nodeId: '22', fieldName: 'width', fieldValue: 768, valueType: 'number' },
      { nodeId: '22', fieldName: 'height', fieldValue: 1344, valueType: 'number' },
    ],
  );

  const expandManifest = normalizeRhToolboxManifest({
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    categories: [{ id: 'image-category-expand', name: '扩图', parentId: 'image' }],
    tools: [
      {
        id: 'kuotu-1',
        title: '扩图',
        categoryId: 'image-category-expand',
        webappId: '2066227901946748930',
        enabled: true,
        capabilities: ['image.edit'],
        inputSchema: [{ key: 'source-image', kind: 'image', rhNodeId: '5', fieldName: 'image', required: true }],
        outputSchema: [{ key: 'output-image', kind: 'image', role: 'append-output' }],
        userParams: [
          {
            key: 'node-105',
            label: '选择尺寸',
            kind: 'select',
            rhNodeId: '105',
            fieldName: '选择尺寸',
            defaultValue: '16：9（1392x752）',
            options: [
              '原始比例',
              '1：1（1024x1024）',
              '9：16（752x1392）',
              '16：9（1392x752）',
              '21：9（1568x672）',
            ],
          },
        ],
        ui: { showInImageEditor: true },
      },
    ],
  });
  const expandTool = findRhToolboxToolById(expandManifest, 'kuotu-1');
  assert.ok(expandTool);
  assert.equal(
    resolveRhToolboxCapability(expandManifest, { surface: 'image', capability: 'image.expand' })?.id,
    'kuotu-1',
  );
  assert.deepEqual(
    buildRhToolboxNodeInfoList(expandTool, {
      inputValues: { 'source-image': 'rh-uploaded-expand.png' },
      userParamValues: { expand_size: '16：9（1392x752）', resolution: '1344x768' },
    }),
    [
      { nodeId: '5', fieldName: 'image', fieldValue: 'rh-uploaded-expand.png', valueType: 'image' },
      { nodeId: '105', fieldName: '选择尺寸', fieldValue: '16：9（1392x752）', valueType: 'select' },
    ],
  );
  assert.deepEqual(
    buildRhToolboxNodeInfoList(expandTool, {
      inputValues: { 'source-image': 'rh-uploaded-expand.png' },
      userParamValues: { resolution: '1392x752' },
    }).find((item) => item.nodeId === '105'),
    { nodeId: '105', fieldName: '选择尺寸', fieldValue: '16：9（1392x752）', valueType: 'select' },
  );
  assert.deepEqual(
    buildRhToolboxNodeInfoList(expandTool, {
      inputValues: { 'source-image': 'rh-uploaded-expand.png' },
      userParamValues: { aspectRatio: '21:9' },
    }).find((item) => item.nodeId === '105'),
    { nodeId: '105', fieldName: '选择尺寸', fieldValue: '21：9（1568x672）', valueType: 'select' },
  );

  const imageToVideo = findRhToolboxToolById(manifest, 'bernini1');
  assert.equal(imageToVideo?.webappId, '2064192352843034626');
  assert.equal(imageToVideo?.inputSchema.find((input) => input.kind === 'image')?.rhNodeId, '408');
  assert.equal(imageToVideo?.inputSchema.find((input) => input.kind === 'text')?.rhNodeId, '410');
  assert.equal(imageToVideo?.outputSchema[0]?.kind, 'video');

  const textToVideo = findRhToolboxToolById(manifest, 'bernini2');
  assert.equal(textToVideo?.webappId, '2064185875537420290');
  assert.equal(textToVideo?.inputSchema[0]?.rhNodeId, '210');
  assert.equal(textToVideo?.outputSchema[0]?.kind, 'video');

  const fastVideoUpscale = findRhToolboxToolById(manifest, 'video-nividia-upscale');
  assert.equal(fastVideoUpscale?.webappId, '2032095665941123073');
  assert.equal(fastVideoUpscale?.inputSchema[0]?.rhNodeId, '3');
  assert.equal(fastVideoUpscale?.outputSchema[0]?.kind, 'video');

  const qualityVideoUpscale = findRhToolboxToolById(manifest, 'video-flashvsr');
  assert.equal(qualityVideoUpscale?.webappId, '2043165928090767362');
  assert.equal(qualityVideoUpscale?.inputSchema[0]?.rhNodeId, '9');
  assert.equal(qualityVideoUpscale?.inputSchema[0]?.fieldName, 'file');
  assert.equal(qualityVideoUpscale?.outputSchema[0]?.kind, 'video');
});

test('RH toolbox release manifest check is wired into packaging and post-build verification', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const distRelease = readFileSync(new URL('../scripts/dist-release.cjs', import.meta.url), 'utf8');
  const postBuild = readFileSync(new URL('../electron/_post_build.cjs', import.meta.url), 'utf8');
  const checker = readFileSync(new URL('../scripts/check-rh-toolbox-release.cjs', import.meta.url), 'utf8');
  const syncScript = readFileSync(new URL('../scripts/sync-rh-toolbox-manifest.cjs', import.meta.url), 'utf8');

  assert.equal(packageJson.scripts['rh-toolbox:check'], 'node scripts/check-rh-toolbox-release.cjs');
  assert.match(packageJson.scripts['prepack:enc'], /rh-toolbox:check[\s\S]*build[\s\S]*encrypt/);
  assert.match(distRelease, /RH toolbox release manifest check/);
  assert.match(distRelease, /rh-toolbox:check/);
  assert.ok(distRelease.indexOf('rh-toolbox:check') < distRelease.indexOf('prepack:enc'));

  assert.match(checker, /syncRhToolboxManifest/);
  assert.match(syncScript, /data['"], ['"]rh_toolbox_manifest\.json/);
  assert.match(syncScript, /src['"], ['"]data['"], ['"]rhToolboxManifest\.ts/);
  assert.match(syncScript, /toolIdentityKeys/);
  assert.match(checker, /T8_RH_TOOLBOX_MIN_ENABLED/);
  assert.match(checker, /frontendMarkersForManifest/);
  assert.match(checker, /image-cutout-v1/);
  assert.match(checker, /tuantiquv10/);
  assert.match(checker, /bernini1/);
  assert.match(checker, /berninituxiangbianji/);
  assert.match(checker, /bernini2/);
  assert.match(checker, /video-removebg-v1/);
  assert.match(checker, /video-nividia-upscale/);
  assert.match(checker, /video-flashvsr/);
  assert.match(checker, /video-category-9d33p/);
  assert.match(checker, /video-category-9dael/);

  assert.match(postBuild, /checkRhToolboxReleaseManifest/);
  assert.match(postBuild, /loadRhToolboxReleaseManifestMarkers/);
  assert.match(postBuild, /RH_TOOLBOX_MANIFEST/);
  assert.match(postBuild, /tool\.enabled === false/);
});

test('RH toolbox image cutout is exposed as a reusable node capability', async () => {
  const { RH_TOOLBOX_MANIFEST } = await loadRhToolboxManifest();
  const {
    RH_IMAGE_CAPABILITY_PRESETS,
    buildRhToolboxCapabilityInputValues,
    resolveRhImageCapabilityPreset,
    resolveRhToolboxCapability,
  } = await loadRhToolboxCapabilities();
  const service = readFileSync(new URL('../src/services/rhToolboxCapabilities.ts', import.meta.url), 'utf8');
  const button = readFileSync(new URL('../src/components/RhImageCapabilityButton.tsx', import.meta.url), 'utf8');
  const rail = readFileSync(new URL('../src/components/RhImageCapabilityRail.tsx', import.meta.url), 'utf8');
  const uploadNode = readFileSync(new URL('../src/components/nodes/UploadNode.tsx', import.meta.url), 'utf8');
  const outputNode = readFileSync(new URL('../src/components/nodes/OutputNode.tsx', import.meta.url), 'utf8');

  const tool = resolveRhToolboxCapability(RH_TOOLBOX_MANIFEST, {
    surface: 'image',
    capability: 'image.cutout',
    preferredToolId: 'image-cutout-v1',
  });
  const removeSubjectTool = resolveRhToolboxCapability(RH_TOOLBOX_MANIFEST, {
    surface: 'image',
    capability: 'image.remove-subject',
    preferredToolId: 'xiaochuzhuti',
  });

  assert.equal(tool?.id, 'image-cutout-v1');
  assert.equal(tool?.title, '高清抠图');
  assert.equal(removeSubjectTool?.id, 'xiaochuzhuti');
  assert.deepEqual(
    buildRhToolboxCapabilityInputValues(tool, 'image', '/files/input/a.png'),
    { 'source-image': '/files/input/a.png' },
  );
  assert.equal(
    resolveRhToolboxCapability({
      schema: 't8-rh-toolbox-manifest',
      version: 1,
      categories: [{ id: 'image-category-expand', name: '扩图', parentId: 'image' }],
      tools: [
        {
          id: 'outpaint-draft',
          title: '扩图',
          categoryId: 'image-category-expand',
          webappId: '200',
          enabled: true,
          capabilities: ['image.edit'],
          inputSchema: [{ key: 'source-image', kind: 'image', rhNodeId: '1', fieldName: 'image' }],
          outputSchema: [{ key: 'output-image', kind: 'image', role: 'append-output' }],
          ui: { showInImageEditor: true },
        },
      ],
    }, { surface: 'image', capability: 'image.expand' })?.id,
    'outpaint-draft',
  );

  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.cutout.capability, 'image.cutout');
  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.cutout.preferredToolId, 'image-cutout-v1');
  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.upscale.capability, 'image.upscale');
  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.upscale.preferredToolId, 'image-upscale-4k');
  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.expand.capability, 'image.expand');
  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.expand.defaultParamPresetId, 'landscape-16-9');
  assert.ok((RH_IMAGE_CAPABILITY_PRESETS.expand.paramPresets?.length || 0) >= 14);
  assert.equal(
    RH_IMAGE_CAPABILITY_PRESETS.expand.paramPresets?.find((item) => item.id === 'landscape-16-9')?.userParams.expand_size,
    '16：9（1392x752）',
  );
  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.removeSubject.capability, 'image.remove-subject');
  assert.equal(RH_IMAGE_CAPABILITY_PRESETS.removeSubject.preferredToolId, 'xiaochuzhuti');
  assert.equal(resolveRhImageCapabilityPreset('cutout').label, '抠图');

  assert.match(service, /runRhImageCapability/);
  assert.match(service, /runRhImageCutout/);
  assert.match(service, /runRhImageCutoutBatch/);
  assert.match(service, /preferredToolId:\s*'image-cutout-v1'/);
  assert.match(service, /const RH_TOOLBOX_DEVELOPER_MODULE = '\.\.\/utils\/rhToolboxDeveloper'/);
  assert.match(service, /getRhToolboxPersistentManifest/);
  assert.match(service, /mergeRhToolboxManifests/);
  assert.match(service, /mergeRhToolboxManifestWithDeveloperDrafts/);
  assert.match(service, /userParams: options\.userParams/);
  assert.match(service, /@vite-ignore/);
  assert.match(service, /onItemProgress/);
  assert.match(service, /retryCount\?: number/);
  assert.match(service, /continueOnError\?: boolean/);
  assert.match(service, /failedItems/);
  assert.match(service, /cancelled/);
  assert.match(button, /logBus/);
  assert.match(button, /logRhImageCapabilityProgress/);
  assert.match(button, /logBus\.info/);
  assert.match(button, /logBus\.debug/);
  assert.match(button, /logBus\.success/);
  assert.match(button, /logBus\.error/);
  assert.match(button, /data-rh-capability=\{capability\}/);
  assert.match(button, /sourceUrls\?: string\[\]/);
  assert.match(button, /preset\?:/);
  assert.match(button, /preferredToolId\?: string/);
  assert.match(button, /userParams\?: Record<string, string \| number \| boolean>/);
  assert.match(button, /label\?: string/);
  assert.match(button, /RH_IMAGE_CAPABILITY_PRESETS/);
  assert.match(button, /runRhImageCapabilityBatch/);
  assert.doesNotMatch(button, /runRhImageCutoutBatch/);
  assert.match(button, /abortRef\.current\?\.abort\(\)/);
  assert.match(button, /data-rh-running=\{running \? 'true' : 'false'\}/);
  assert.match(button, /variant\?: 'inline' \| 'rail'/);
  assert.match(button, /rh-image-capability-button--rail/);
  assert.match(button, /paramPickerOpen/);
  assert.match(button, /setParamPickerOpen\(false\)/);
  assert.match(button, /window\.addEventListener\('pointerdown'/);
  assert.match(button, /window\.removeEventListener\('pointerdown'/);
  assert.match(button, /rh-image-capability-param-select/);
  assert.match(button, /data-rh-param-select="resolution"/);
  assert.match(button, /选择扩图输出分辨率/);
  assert.match(button, /selectedParamPreset/);
  assert.match(button, /onRunningChange\?: \(running: boolean\) => void/);
  assert.match(button, /onRunningChange\?\.\(true\)/);
  assert.match(button, /onRunningChange\?\.\(false\)/);
  assert.match(button, /点击取消/);
  assert.match(button, /failedItems/);
  assert.match(button, /status: result\.cancelled \? 'stopped' : result\.failedItems\.length > 0 \? 'partial' : 'succeeded'/);
  assert.match(button, /else if \(result\.failedItems\.length > 0\)[\s\S]*throw new Error\(warning\)/);
  assert.match(rail, /data-rh-image-capability-rail/);
  assert.match(rail, /RH_IMAGE_NODE_CAPABILITY_PRESETS/);
  assert.match(rail, /variant="rail"/);
  assert.match(rail, /overflowX:\s*'visible'/);
  assert.match(rail, /onRunningChange\?: \(running: boolean\) => void/);
  assert.match(rail, /runningPresetIds/);
  assert.match(rail, /runningPresetIdsRef/);
  assert.match(rail, /setPresetRunning/);
  assert.match(rail, /onRunningChange\?\.\(runningPresetIds\.size > 0\)/);
  assert.match(rail, /onRunningChange\?\.\(next\.size > 0\)/);
  assert.match(rail, /maxHeight:\s*'calc\(100% - 58px\)'/);
  assert.match(uploadNode, /RhImageCapabilityRail/);
  assert.match(outputNode, /RhImageCapabilityRail/);
  assert.match(uploadNode, /rhCapabilityBusy/);
  assert.match(outputNode, /rhCapabilityBusy/);
  assert.match(uploadNode, /\(selected \|\| rhCapabilityBusy\) && canEditImage/);
  assert.match(outputNode, /showRhCapabilityRail = \(selected \|\| rhCapabilityBusy\) && hasEditableImages/);
  assert.match(uploadNode, /const imageSourceUrls = useMemo/);
  assert.match(uploadNode, /sourceUrls=\{imageSourceUrls\}/);
  assert.match(outputNode, /const publishedImageUrls = imageLongEdge\.outputUrls/);
  assert.match(outputNode, /sourceUrls=\{publishedImageUrls\}/);
  assert.match(uploadNode, /onRunningChange=\{setRhCapabilityBusy\}/);
  assert.match(outputNode, /onRunningChange=\{setRhCapabilityBusy\}/);
  assert.match(uploadNode, /logBus/);
  assert.match(outputNode, /logBus/);
  assert.match(uploadNode, /type:\s*'rh-capability'/);
  assert.match(outputNode, /type:\s*'rh-capability'/);
  assert.match(uploadNode, /rf\.setNodes\(\(prev\) => \[\.\.\.prev\.map/);
  assert.match(outputNode, /rf\.setNodes\(\(prev\) => \[\.\.\.prev\.map/);
  assert.match(uploadNode, /rf\.setCenter/);
  assert.match(outputNode, /rf\.setCenter/);
  assert.match(uploadNode, /已创建 \$\{newNodes\.length\} 个输出素材节点/);
  assert.match(outputNode, /nodes:output\.logs\.rhImageCreated/);
  assert.match(uploadNode, /onComplete=\{\(result\) => handleProduce\(result\.imageUrls, \{ type: 'rh-capability', label: result\.tool\.title \}\)\}/);
  assert.match(outputNode, /onComplete=\{\(result\) => handleProduce\(result\.imageUrls, \{ type: 'rh-capability', label: result\.tool\.title \}\)\}/);
});

test('RH toolbox builds nodeInfoList from configured mappings without per-tool code', async () => {
  const {
    buildRhToolboxNodeInfoList,
    classifyRhToolboxOutputs,
    getRhToolboxNodeInfoFieldOptions,
    inferRhToolboxUserParamsFromNodeInfoList,
    normalizeRhToolboxManifest,
    pickRhToolboxInputs,
  } = await loadRhToolboxUtils();

  const manifest = normalizeRhToolboxManifest({
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    categories: [{ id: 'image-tools', name: '图像工具' }],
    tools: [
      {
        id: 'cutout',
        title: '抠图',
        categoryId: 'image-tools',
        webappId: '200000',
        enabled: true,
        capabilities: ['image.cutout'],
        inputSchema: [
          { key: 'image', kind: 'image', rhNodeId: '7', fieldName: 'image', required: true },
          { key: 'prompt', kind: 'text', rhNodeId: '30', fieldName: 'prompt', required: false },
        ],
        fixedParams: [{ rhNodeId: '31', fieldName: 'mode', value: 'transparent', valueType: 'text' }],
        userParams: [
          {
            key: 'strength',
            label: '强度',
            kind: 'number',
            rhNodeId: '32',
            fieldName: 'strength',
            defaultValue: 0.8,
          },
        ],
        outputSchema: [{ key: 'out', kind: 'image', role: 'replace-source' }],
      },
    ],
  });
  const tool = manifest.tools[0];

  const picked = pickRhToolboxInputs(tool, {
    images: ['/files/input/a.png'],
    texts: ['主体抠图'],
  });
  assert.equal(picked.missing.length, 0);

  const nodeInfoList = buildRhToolboxNodeInfoList(tool, {
    inputValues: { ...picked.values, image: 'rh-uploaded-a.png' },
    userParamValues: { strength: 0.6 },
  });

  assert.deepEqual(nodeInfoList, [
    { nodeId: '7', fieldName: 'image', fieldValue: 'rh-uploaded-a.png', valueType: 'image' },
    { nodeId: '30', fieldName: 'prompt', fieldValue: '主体抠图', valueType: 'text' },
    { nodeId: '32', fieldName: 'strength', fieldValue: 0.6, valueType: 'number' },
    { nodeId: '31', fieldName: 'mode', fieldValue: 'transparent', valueType: 'text' },
  ]);

  const inferredParams = inferRhToolboxUserParamsFromNodeInfoList([
    {
      nodeId: '390',
      nodeName: 'PrimitiveInt',
      fieldName: 'value',
      fieldValue: '129',
      fieldData: '["INT", {"max": 9223372036854775807, "min": -9223372036854775807, "control_after_generate": "fixed"}]',
      fieldType: 'INT',
      description: '总帧数',
      descriptionEn: 'Total frames',
    },
    {
      nodeId: '410',
      nodeName: 'Text',
      fieldName: 'text',
      fieldValue: '女人运球灌篮',
      fieldType: 'STRING',
      description: 'text',
    },
    {
      nodeId: '408',
      nodeName: 'LoadImage',
      fieldName: 'image',
      fieldValue: 'input.png',
      fieldType: 'IMAGE',
      description: 'image',
    },
    {
      nodeId: '417',
      nodeName: 'JWInteger',
      fieldName: 'value',
      fieldValue: '1280',
      fieldData: '["INT", {"max": 18446744073709551615, "min": -18446744073709551615, "default": 0}]',
      fieldType: 'INT',
      description: '最长边',
      descriptionEn: 'Longest side',
    },
  ], [
    { key: 'prompt', rhNodeId: '410', fieldName: 'text' },
    { key: 'source-image', rhNodeId: '408', fieldName: 'image' },
  ]);
  assert.deepEqual(
    inferredParams.map(({ key, label, kind, rhNodeId, fieldName, defaultValue }) => ({
      key,
      label,
      kind,
      rhNodeId,
      fieldName,
      defaultValue,
    })),
    [
      { key: 'node-390-value', label: '总帧数', kind: 'number', rhNodeId: '390', fieldName: 'value', defaultValue: 129 },
      { key: 'node-417-value', label: '最长边', kind: 'number', rhNodeId: '417', fieldName: 'value', defaultValue: 1280 },
    ],
  );

  const inferredSelectParams = inferRhToolboxUserParamsFromNodeInfoList([
    {
      nodeId: '22',
      nodeName: 'Text',
      fieldName: 'aspect_ratio',
      fieldValue: 'custom',
      fieldType: 'TEXT',
      description: '比例选择/自定义',
    },
    {
      nodeId: '24',
      nodeName: 'Combo',
      fieldName: 'quality',
      fieldValue: 'high',
      fieldData: ['low', 'medium', 'high'],
      fieldType: 'TEXT',
      description: '质量',
    },
  ]);
  assert.equal(inferredSelectParams[0].kind, 'select');
  assert.deepEqual(inferredSelectParams[0].options?.slice(0, 4), ['1:1', '16:9', '9:16', '4:3']);
  assert.equal(inferredSelectParams[1].kind, 'select');
  assert.deepEqual(inferredSelectParams[1].options, ['low', 'medium', 'high']);
  assert.deepEqual(
    getRhToolboxNodeInfoFieldOptions({ fieldName: 'instanceType', fieldValue: 'plus', fieldType: 'TEXT' }),
    ['default', 'plus', 'pro'],
  );

  assert.deepEqual(
    buildRhToolboxNodeInfoList({ ...tool, userParams: inferredParams }, { inputValues: {}, userParamValues: {} })
      .filter((item) => item.nodeId === '390' || item.nodeId === '417'),
    [
      { nodeId: '390', fieldName: 'value', fieldValue: 129, valueType: 'number' },
      { nodeId: '417', fieldName: 'value', fieldValue: 1280, valueType: 'number' },
    ],
  );

  const materializedOutputs = classifyRhToolboxOutputs([
    '/files/output/a.png',
    '/files/output/b.mov',
    '/files/output/c.mp3',
  ]);
  assert.deepEqual(materializedOutputs.imageUrls, ['/files/output/a.png']);
  assert.deepEqual(materializedOutputs.videoUrls, ['/files/output/b.mov']);
  assert.deepEqual(materializedOutputs.audioUrls, ['/files/output/c.mp3']);
});

test('RH toolbox service exposes a single callable runner for future quick actions', () => {
  const service = readFileSync(new URL('../src/services/rhToolbox.ts', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');

  assert.match(service, /export async function runRhToolboxTool/);
  assert.match(service, /uploadRhAsset/);
  assert.match(service, /submitRh/);
  assert.match(service, /submitRh\(\{[\s\S]*\}, \{ submissionKey: options\.submissionKey \}\)/);
  assert.match(service, /queryRh/);
  assert.match(component, /runRhToolboxTool/);
  assert.match(component, /submissionKey:\s*reporter\?\.providerSubmissionKey/);
  assert.match(component, /MentionPromptInput/);
  assert.match(component, /rhToolboxTextInputs/);
  assert.match(component, /hasTextInputValue/);
  assert.match(component, /input\.defaultValue == null \? '' : String\(input\.defaultValue\)/);
  assert.match(component, /defaultTextInputs/);
  assert.match(component, /prompt:\s*defaultPrompt/);
  assert.match(component, /hoveredToolId/);
  assert.match(component, /previewTool/);
  assert.match(component, /onMouseEnter=\{\(\) => setHoveredToolId\(tool\.id\)\}/);
  assert.match(component, /悬停工具查看说明/);
  assert.match(component, /previewTool\.description/);
  assert.match(component, /rhToolboxLocalInputs/);
  assert.match(component, /inputValues:\s*explicitInputValues/);
  assert.match(component, /素材输入/);
  assert.match(component, /opacity-0 transition-opacity group-hover:opacity-100/);
  assert.match(component, /RH_TOOLBOX_MAJOR_CATEGORIES/);
  assert.match(component, /rhToolboxMajorCategoryId/);
  assert.match(component, /notifyRhToolboxDeveloperToolEdit/);
  assert.match(component, /rh-toolbox-app-grid grid grid-cols-1 gap-2/);
  assert.match(component, /rh-toolbox-app-button/);
  assert.match(component, /rh-toolbox-app-title/);
  assert.match(component, /rh-toolbox-app-edit-button/);
  assert.match(component, /isRhToolboxBuiltinCategoryId/);
  assert.match(component, /visibleCategoryId/);
  assert.match(styles, /\.rh-toolbox-app-grid button\.rh-toolbox-app-button/);
  assert.match(styles, /-webkit-line-clamp:\s*2 !important/);
  assert.match(styles, /box-shadow:\s*none !important/);
  assert.match(styles, /border-radius:\s*6px !important/);
  assert.match(component, /status !== 'idle'/);
  assert.doesNotMatch(component, /buildRhToolboxQuickActions/);
  assert.doesNotMatch(component, /快捷接入位/);
  assert.doesNotMatch(component, /toolCategory\?\.name \|\| tool\.categoryId/);
  assert.doesNotMatch(component, /title=\{\`\$\{tool\.title\}\$\{toolCategory/);
  assert.match(component, /MaterialPreviewSection/);
  assert.match(service, /inputValues\?: Record<string, string \| string\[\]>/);
  assert.match(service, /缺少输入/);
  assert.match(component, /fetchRhAppInfo/);
  assert.match(component, /inferRhToolboxUserParamsFromNodeInfoList/);
  assert.doesNotMatch(component, /NodeList 映射/);
  assert.doesNotMatch(component, /mappedNodeListRows/);
  assert.match(component, /manifest:\s*runManifest/);
});

test('RH toolbox display config follows theme and does not expose per-tool color or button labels', () => {
  const utils = readFileSync(new URL('../src/utils/rhToolbox.ts', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../src/data/rhToolboxManifest.ts', import.meta.url), 'utf8');
  const node = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(utils, /quickActionLabel\?:/);
  assert.doesNotMatch(utils, /accent\?: string/);
  assert.doesNotMatch(utils, /raw\.ui\.accent/);
  assert.doesNotMatch(utils, /raw\.ui\.quickActionLabel/);
  assert.match(utils, /label:\s*tool\.title/);
  assert.doesNotMatch(manifest, /quickActionLabel/);
  assert.doesNotMatch(manifest, /accent:\s*['"]/);
  assert.match(node, /const accent = isPixel \? 'var\(--px-ink\)' : isLight \? '#0891b2' : '#67e8f9'/);
  assert.doesNotMatch(node, /activeTool\?\.ui\?\.accent/);
});

test('RH toolbox runtime can consume private maker events without shipping maker source', () => {
  const node = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');

  assert.match(node, /const RH_TOOLBOX_DEVELOPER_MODULE = '\.\.\/\.\.\/utils\/rhToolboxDeveloper'/);
  assert.match(node, /import\(\/\* @vite-ignore \*\/ RH_TOOLBOX_DEVELOPER_MODULE\)/);
  assert.match(node, /penguin:rh-toolbox-manifest-updated/);
  assert.match(node, /detail\?\.kind === 'tool-saved'/);
  assert.match(node, /getRhToolboxPersistentManifest/);
  assert.match(node, /mergeRhToolboxManifests\(base, persisted\.data\.manifest\)/);
  assert.match(node, /mergeRhToolboxManifestWithDeveloperDrafts\(baseWithPersistent, detail\?\.manifest\)/);
  assert.match(node, /function dedupeRhToolboxDisplayTools/);
  assert.match(node, /dedupeRhToolboxDisplayTools\(listRhToolboxTools\(manifest, \{ includeDisabled: true \}\)/);
  assert.match(node, /dedupeRhToolboxDisplayTools\(filterRhToolboxTools\(manifest,/);
  assert.match(node, /window\.setInterval\(\(\) => refreshManifest\(\), 1500\)/);
  assert.match(node, /当前 manifest 有 \{allTools\.length\} 个工具/);
  assert.match(node, /rhToolboxSearchQuery:\s*''/);
  assert.match(node, /rhToolboxCategoryId:\s*RH_TOOLBOX_ALL_CATEGORY_ID/);
  assert.match(node, /rhToolboxActiveToolId:\s*nextTool && nextTool\.enabled !== false/);
});

test('RH toolbox maker is dev-only and guarded from packaged builds', () => {
  const registry = readFileSync(new URL('../src/config/nodeRegistry.ts', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const nodeCatalog = readFileSync(new URL('../src/i18n/nodeCatalog.ts', import.meta.url), 'utf8');
  const visibleCatalog = readFileSync(new URL('../src/i18n/nodeVisibleCatalog.ts', import.meta.url), 'utf8');
  const i18nCheck = readFileSync(new URL('../scripts/check-i18n.ts', import.meta.url), 'utf8');
  const ports = readFileSync(new URL('../src/config/portTypes.ts', import.meta.url), 'utf8');
  const postBuild = readFileSync(new URL('../electron/_post_build.cjs', import.meta.url), 'utf8');
  const publicCheck = readFileSync(new URL('../scripts/check-public-clean.cjs', import.meta.url), 'utf8');
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  const features = readFileSync(new URL('../features.json', import.meta.url), 'utf8');

  assert.match(registry, /import\.meta\.env\?\.DEV[\s\S]*type:\s*'rh-toolbox-maker'[\s\S]*label:\s*'RH工具箱制作器'/);
  assert.match(canvas, /const RH_TOOLBOX_MAKER_MODULE = '\.\/nodes\/RHToolboxMakerNode'/);
  assert.match(canvas, /lazyCanvasNode\(\(\) => import\(\/\* @vite-ignore \*\/ RH_TOOLBOX_MAKER_MODULE\), 'RHToolboxMakerNode'\)/);
  assert.match(canvas, /import\.meta\.env\?\.DEV \? \{ 'rh-toolbox-maker': RHToolboxMakerNode \} : \{\}/);
  assert.match(nodeCatalog, /export const DEV_ENGLISH_NODE_CATALOG[\s\S]*?'rh-toolbox-maker'/);
  assert.match(nodeCatalog, /\.\.\.\(import\.meta\.env\?\.DEV\s*\?\s*DEV_ENGLISH_NODE_CATALOG\s*:\s*\{\}\)/);
  assert.match(i18nCheck, /ENGLISH_NODE_CATALOG, DEV_ENGLISH_NODE_CATALOG/);
  assert.match(i18nCheck, /const ENGLISH_NODE_COVERAGE_CATALOG[\s\S]*?DEV_ENGLISH_NODE_CATALOG/);
  assert.match(visibleCatalog, /const RH_TOOLBOX_MAKER_DEV_ENTRIES[\s\S]*?=\s*import\.meta\.env\?\.DEV\s*\?\s*\[[\s\S]*?\['RH工具箱制作器'/);
  assert.match(visibleCatalog, /\.\.\.RH_TOOLBOX_MAKER_DEV_ENTRIES/);
  assert.match(ports, /import\.meta\.env\?\.DEV[\s\S]*'rh-toolbox-maker':\s*\{\s*inputs:\s*\[\],\s*outputs:\s*\['text'\]\s*\}/);
  assert.match(postBuild, /checkNoRhToolboxMaker/);
  assert.match(postBuild, /RHToolboxMakerNode/);
  assert.match(postBuild, /RH工具箱制作器/);
  assert.match(publicCheck, /src\/components\/nodes\/RHToolboxMakerNode\.tsx/);
  assert.match(publicCheck, /src\/utils\/rhToolboxDeveloper\.ts/);
  assert.match(gitignore, /\/src\/components\/nodes\/RHToolboxMakerNode\.tsx/);
  assert.match(gitignore, /\/src\/utils\/rhToolboxDeveloper\.ts/);
  assert.match(features, /RH工具箱制作器/);
});

test('RH toolbox maker rebuilds mappings from the current WebApp snapshot', { skip: !hasRhToolboxMakerSource }, () => {
  const maker = readFileSync(rhToolboxMakerNodeUrl, 'utf8');

  assert.match(maker, /renderSelect\('RunningHub 站点',[\s\S]*\['cn', 'intl'\][\s\S]*\}, \{ intl: 'ai' \}\)/);
  assert.match(maker, /rhToolboxMakerRhSite:\s*value === 'intl' \? 'intl' : 'cn'/);
  assert.match(maker, /getRhToolboxNodeInfoFieldOptions/);
  assert.match(maker, /function fieldOptionsText/);
  assert.match(maker, /optionsText:\s*kind === 'select' \? fieldOptionsText\(field\) : ''/);
  assert.match(maker, /function mappingSignature/);
  assert.match(maker, /currentInputs\.filter\(\(row\) => fieldKeys\.has\(mappingSignature\(row\)\) \|\| isDefaultInputPlaceholder\(row\)\)/);
  assert.match(maker, /currentParams\.filter\(\(row\) => fieldKeys\.has\(mappingSignature\(row\)\)\)/);
  assert.match(maker, /buildAutoMappingsFromFields\(fields,\s*\[\],\s*\[\],\s*\{\s*replaceExisting:\s*true\s*\}\)/);
  assert.match(maker, /requestedWebappId:\s*webappId/);
  assert.match(maker, /rhToolboxMakerFixedParams:\s*\[\]/);
  assert.match(maker, /rhToolboxMakerWebappId:\s*value[\s\S]*rhToolboxMakerAppInfo:\s*undefined[\s\S]*rhToolboxMakerInputs:\s*\[\][\s\S]*rhToolboxMakerUserParams:\s*\[\][\s\S]*rhToolboxMakerFixedParams:\s*\[\]/);
  assert.match(maker, /const mappingsChanged = Boolean\(autoMappings\.addedInputs \|\| autoMappings\.addedParams\)[\s\S]*autoMappings\.inputs\.length !== inputs\.length[\s\S]*autoMappings\.params\.length !== params\.length/);
});

test('RH toolbox maker keeps each draft tool category independent', { skip: !hasRhToolboxMakerSource }, () => {
  const maker = readFileSync(rhToolboxMakerNodeUrl, 'utf8');

  assert.match(maker, /function buildUniqueCategoryId/);
  assert.match(maker, /compactTextHash\(`\$\{majorId\}:\$\{name\}`\)/);
  assert.doesNotMatch(maker, /cleanId\(category\?\.id \|\| newCategoryId \|\| name, 'custom-rh-tools'\)/);
  assert.match(maker, /const categoryId = category[\s\S]*buildUniqueCategoryId\(newCategoryId, name, parentId, categories\)/);
  assert.match(maker, /const patchDraftTool = async \(draft: RhToolboxTool, patch: Partial<RhToolboxTool>/);
  assert.match(maker, /saveRhToolboxDeveloperToolPersistent\(nextTool, categories\)/);
  assert.match(maker, /const firstSubcategory = customCategories\.find\(\(category\) => getRhToolboxCategoryMajorId\(category\) === nextMajorId\)/);
  assert.match(maker, /保存时按该小类入库/);
  assert.match(maker, /onChange=\{\(event\) => patchDraftTool\(draft, \{ categoryId: event\.target\.value \}/);
  assert.match(maker, /保存名称/);
});

test('RH toolbox maker saves a per-tool default instance type', { skip: !hasRhToolboxMakerSource }, () => {
  const maker = readFileSync(rhToolboxMakerNodeUrl, 'utf8');
  const runtime = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/rhToolbox.ts', import.meta.url), 'utf8');

  assert.match(maker, /instanceType:\s*cleanText\(data\.rhToolboxMakerInstanceType\)/);
  assert.match(maker, /rhToolboxMakerInstanceType:\s*tool\.runtime\?\.instanceType \|\| ''/);
  assert.match(maker, /value=\{d\.rhToolboxMakerInstanceType \|\| ''\}/);
  assert.match(maker, /updateData\(\{ rhToolboxMakerInstanceType: event\.target\.value \}\)/);
  assert.match(maker, /保存后该应用默认使用所选实例/);
  assert.match(maker, /<option value="">默认<\/option>/);
  assert.match(maker, /<option value="plus">plus<\/option>/);
  assert.match(maker, /<option value="pro">pro<\/option>/);
  assert.match(runtime, /instanceType:\s*tool\.runtime\?\.instanceType \|\| ''/);
  assert.match(runtime, /getRhToolboxNodeInfoFieldOptions\(matchedField\)/);
  assert.match(runtime, /shouldPatchOptions/);
  assert.match(service, /instanceType:\s*options\.instanceType \|\| tool\.runtime\?\.instanceType \|\| undefined/);
});

test('RH toolbox developer save persists the selected custom category with each tool', {
  skip: !hasRhToolboxMakerSource || !hasRhToolboxDeveloperSource,
}, () => {
  const developer = readFileSync(rhToolboxDeveloperUrl, 'utf8');
  const settings = readFileSync(new URL('../backend/src/routes/settings.js', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../backend/src/config.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
  const maker = readFileSync(rhToolboxMakerNodeUrl, 'utf8');

  assert.match(developer, /isRhToolboxBuiltinCategoryId/);
  assert.match(developer, /for \(const category of incoming\.categories\)/);
  assert.match(developer, /category\.id === normalizedTool\.categoryId/);
  assert.match(developer, /categoryMap\.set\(category\.id, category\)/);
  assert.match(developer, /saveRhToolboxPersistentManifest/);
  assert.match(developer, /readRhToolboxPersistentDeveloperManifest/);
  assert.match(developer, /saveRhToolboxDeveloperToolPersistent/);
  assert.match(developer, /deleteRhToolboxDeveloperToolPersistent/);
  assert.match(maker, /readRhToolboxPersistentDeveloperManifest\(\)/);
  assert.match(maker, /正在保存到 RH工具箱持久应用库/);
  assert.match(config, /RH_TOOLBOX_MANIFEST_FILE:\s*path\.join\(DATA_ROOT, 'data', 'rh_toolbox_manifest\.json'\)/);
  assert.match(settings, /router\.get\('\/rh-toolbox\/manifest'/);
  assert.match(settings, /router\.put\('\/rh-toolbox\/manifest'/);
  assert.match(settings, /normalizeRhToolboxManifestPayload/);
  assert.match(api, /getRhToolboxPersistentManifest/);
  assert.match(api, /saveRhToolboxPersistentManifest/);
});

test('RH toolbox developer drafts replace the edited released tool instead of duplicating by title', {
  skip: !hasRhToolboxDeveloperSource,
}, async () => {
  const { RH_TOOLBOX_MANIFEST } = await loadRhToolboxManifest();
  const { normalizeRhToolboxManifest } = await loadRhToolboxUtils();
  const { mergeRhToolboxManifestWithDeveloperDrafts } = await loadRhToolboxDeveloper();
  const base = normalizeRhToolboxManifest(RH_TOOLBOX_MANIFEST);
  const imageCategory = base.categories.find((category) => category.id === 'image-category-d5zwl') || base.categories[0];
  const developerDraft = normalizeRhToolboxManifest({
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    updatedAt: 'dev',
    categories: [imageCategory],
    tools: [
      {
        id: '4kupscale',
        title: '高清放大4K',
        description: '维护者把已发布 4K 工具切到 plus 实例',
        categoryId: imageCategory.id,
        webappId: '2066353965784199169',
        enabled: true,
        order: 15,
        capabilities: ['image.upscale', 'image.edit'],
        inputSchema: [
          {
            key: 'source-image',
            label: 'image',
            kind: 'image',
            rhNodeId: '5',
            fieldName: 'image',
            required: true,
            uploadAsset: true,
            order: 0,
          },
        ],
        outputSchema: [{ key: 'output-image', label: '输出图', kind: 'image', role: 'append-output' }],
        fixedParams: [],
        userParams: [],
        runtime: { instanceType: 'plus', pollIntervalMs: 5000, maxPolls: 720, fetchAppInfo: true },
        ui: { icon: 'Maximize2', showInNode: true, showInImageEditor: true },
      },
    ],
  });

  const merged = mergeRhToolboxManifestWithDeveloperDrafts(base, developerDraft);
  const upscaleTools = merged.tools.filter((tool) => tool.title === '高清放大4K');

  assert.equal(upscaleTools.length, 1);
  assert.equal(upscaleTools[0].id, '4kupscale');
  assert.equal(upscaleTools[0].runtime?.instanceType, 'plus');
  assert.equal(merged.tools.some((tool) => tool.id === 'image-upscale-4k'), false);
});

test('RH toolbox keeps domestic and overseas apps separate even when their WebApp IDs match', async () => {
  const { mergeRhToolboxManifests } = await loadRhToolboxUtils();
  const makeTool = (rhSite: 'cn' | 'intl') => ({
    id: `same-app-${rhSite}`,
    title: 'Same RunningHub App',
    description: rhSite,
    categoryId: 'custom',
    webappId: '2000000000000000000',
    rhSite,
    enabled: true,
    order: rhSite === 'cn' ? 0 : 1,
    capabilities: ['image.edit'],
    inputSchema: [],
    outputSchema: [{ key: 'output-image', label: 'output', kind: 'image', role: 'append-output' }],
    fixedParams: [],
    userParams: [],
    runtime: { instanceType: 'default', pollIntervalMs: 5000, maxPolls: 720, fetchAppInfo: true },
    ui: { icon: 'Wrench', showInNode: true },
  });
  const domestic = {
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    categories: [{ id: 'custom', name: 'Custom', order: 0 }],
    tools: [makeTool('cn')],
  };
  const overseas = {
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    categories: [{ id: 'custom', name: 'Custom', order: 0 }],
    tools: [makeTool('intl')],
  };

  const merged = mergeRhToolboxManifests(domestic, overseas);
  assert.deepEqual(merged.tools.map((tool) => tool.rhSite).sort(), ['cn', 'intl']);
});

test('RH toolbox developer manifest normalizes old duplicate drafts before display', {
  skip: !hasRhToolboxDeveloperSource,
}, async () => {
  const { RH_TOOLBOX_MANIFEST } = await loadRhToolboxManifest();
  const { normalizeRhToolboxManifest } = await loadRhToolboxUtils();
  const { mergeRhToolboxManifestWithDeveloperDrafts } = await loadRhToolboxDeveloper();
  const base = normalizeRhToolboxManifest(RH_TOOLBOX_MANIFEST);
  const imageCategory = base.categories.find((category) => category.id === 'image-category-d5zwl') || base.categories[0];
  const duplicateDrafts = normalizeRhToolboxManifest({
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    updatedAt: 'dev',
    categories: [imageCategory],
    tools: [
      {
        id: 'old-4k-upscale',
        title: ' 高清放大4K ',
        description: '旧草稿',
        categoryId: imageCategory.id,
        webappId: '2054229362802741249',
        enabled: true,
        order: 15,
        capabilities: ['image.upscale', 'image.edit'],
        inputSchema: [{ key: 'source-image', label: 'image', kind: 'image', rhNodeId: '2', fieldName: 'image', required: true, uploadAsset: true }],
        outputSchema: [{ key: 'output-image', label: '输出图', kind: 'image', role: 'append-output' }],
        fixedParams: [],
        userParams: [],
        runtime: { instanceType: 'default', pollIntervalMs: 5000, maxPolls: 720, fetchAppInfo: true },
        ui: { icon: 'Maximize2', showInNode: true, showInImageEditor: true },
      },
      {
        id: '4kupscale',
        title: '高清放大4K\u200b',
        description: '新草稿',
        categoryId: imageCategory.id,
        webappId: '2066353965784199169',
        enabled: true,
        order: 15,
        capabilities: ['image.upscale', 'image.edit'],
        inputSchema: [{ key: 'source-image', label: 'image', kind: 'image', rhNodeId: '5', fieldName: 'image', required: true, uploadAsset: true }],
        outputSchema: [{ key: 'output-image', label: '输出图', kind: 'image', role: 'append-output' }],
        fixedParams: [],
        userParams: [],
        runtime: { instanceType: 'plus', pollIntervalMs: 5000, maxPolls: 720, fetchAppInfo: true },
        ui: { icon: 'Maximize2', showInNode: true, showInImageEditor: true },
      },
    ],
  });

  const merged = mergeRhToolboxManifestWithDeveloperDrafts(base, duplicateDrafts);
  const normalizedTitle = (value) => String(value || '').replace(/[\s\u200b-\u200f\ufeff]+/g, '').toLowerCase();
  const upscaleTools = merged.tools.filter((tool) => normalizedTitle(tool.title) === normalizedTitle('高清放大4K'));

  assert.equal(upscaleTools.length, 1);
  assert.equal(upscaleTools[0].id, '4kupscale');
  assert.equal(upscaleTools[0].webappId, '2066353965784199169');
  assert.equal(upscaleTools[0].runtime?.instanceType, 'plus');
});

test('RH toolbox maker defaults use a 60 minute RH polling budget while theme copy stays decorative', {
  skip: !hasRhToolboxMakerSource,
}, () => {
  const maker = readFileSync(rhToolboxMakerNodeUrl, 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/rhToolbox.ts', import.meta.url), 'utf8');
  const utils = readFileSync(new URL('../src/utils/rhToolbox.ts', import.meta.url), 'utf8');
  const slamDunkTheme = readFileSync(new URL('../src/styles/theme-slamdunk.css', import.meta.url), 'utf8');

  assert.match(utils, /RH_TOOLBOX_DEFAULT_POLL_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(utils, /RH_TOOLBOX_DEFAULT_MAX_POLLS/);
  assert.match(maker, /rhToolboxMakerMaxPolls:\s*tool\.runtime\?\.maxPolls \|\| RH_TOOLBOX_DEFAULT_MAX_POLLS/);
  assert.match(maker, /maxPolls:\s*Number\(data\.rhToolboxMakerMaxPolls\) \|\| RH_TOOLBOX_DEFAULT_MAX_POLLS/);
  assert.match(canvas, /rhToolboxMakerMaxPolls:\s*720/);
  assert.match(service, /tool\.runtime\?\.maxPolls \|\| RH_TOOLBOX_DEFAULT_MAX_POLLS/);
  assert.match(slamDunkTheme, /content:\s*"TIME OUT"/);
});

test('RH toolbox proxy extracts nested RunningHub output urls and logs every task state', () => {
  const proxy = readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');

  assert.match(proxy, /function collectRunningHubOutputItems/);
  assert.match(proxy, /downloadUrl/);
  assert.match(proxy, /image_url/);
  assert.match(proxy, /resultUrl/);
  assert.match(proxy, /signedUrl/);
  assert.match(proxy, /preview_url/);
  assert.match(proxy, /output_url/);
  assert.match(proxy, /data:image\//);
  assert.match(proxy, /summarizeRunningHubOutputShape/);
  assert.match(proxy, /no output urls/);
  assert.match(proxy, /const arr = collectRunningHubOutputItems\(data\.data\)/);
  assert.match(proxy, /\[RH\/submit\]/);
  assert.match(proxy, /\[RH\/query\]/);
  assert.match(proxy, /status=\$\{status\}/);
});

test('RH stop buttons cancel the remote RunningHub task instead of only stopping local polling', () => {
  const generation = readFileSync(new URL('../src/services/generation.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/rhToolbox.ts', import.meta.url), 'utf8');
  const button = readFileSync(new URL('../src/components/RhImageCapabilityButton.tsx', import.meta.url), 'utf8');
  const runningHubNode = readFileSync(new URL('../src/components/nodes/RunningHubNode.tsx', import.meta.url), 'utf8');
  const rhToolsNode = readFileSync(new URL('../src/components/nodes/RHToolsNode.tsx', import.meta.url), 'utf8');
  const rhToolboxNode = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');
  const proxy = readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');

  assert.match(generation, /export async function cancelRh\(taskId: string, site: RhSite = 'cn'\)/);
  assert.match(generation, /\/api\/proxy\/runninghub\/cancel/);
  assert.match(generation, /safeJsonResponse/);
  assert.match(generation, /返回了非 JSON 响应/);
  assert.match(proxy, /router\.post\('\/runninghub\/cancel'/);
  assert.match(proxy, /\/task\/openapi\/cancel/);
  assert.match(proxy, /Authorization:\s*`Bearer \$\{candidate\.apiKey\}`/);
  assert.match(proxy, /\[RH\/cancel\]/);
  assert.match(proxy, /parseJsonResponse/);
  assert.match(proxy, /parseJsonResponse\(r,\s*`RH \$\{candidate\.label\}取消接口`\)/);
  assert.match(proxy, /返回非 JSON/);
  assert.match(proxy, /task\/openapi\/cancel/);
  assert.match(proxy, /rememberTaskKey\(taskId,\s*candidate\.apiKey/);
  assert.match(proxy, /buildRhSiteCandidates\(settings, requestedSite, taskMeta\?\.apiKey \|\| ''\)/);
  assert.match(service, /cancelRh/);
  assert.match(service, /stage:\s*'cancel'/);
  assert.match(service, /已提交 RH 任务/);
  assert.match(service, /cancelTaskIfNeeded/);
  assert.match(service, /cancelRh\(taskId, site\)/);
  assert.match(button, /用户取消/);
  assert.match(button, /AbortController/);
  assert.match(button, /activeTaskIdsRef/);
  assert.match(button, /await cancelActiveRunningHubTasks/);
  assert.match(button, /正在请求取消 RH 后台任务/);
  assert.match(runningHubNode, /cancelRh/);
  assert.match(runningHubNode, /stopRequestedRef/);
  assert.match(runningHubNode, /cancelInFlightRef/);
  assert.match(runningHubNode, /await cancelRh\(tid, activeRhSiteRef\.current\)/);
  assert.match(runningHubNode, /提交返回后立即取消 RH 后台任务/);
  assert.match(runningHubNode, /stopPoll\(new Error\('已取消'\)\)/);
  assert.match(runningHubNode, /cancelling \? t\('runningHub\.cancelling'\) : t\('runningHub\.stop'\)/);
  assert.match(rhToolsNode, /cancelRh/);
  assert.match(rhToolsNode, /stopRequestedRef/);
  assert.match(rhToolsNode, /cancelInFlightRef/);
  assert.match(rhToolsNode, /await cancelRh\(tid, activeRhSiteRef\.current\)/);
  assert.match(rhToolsNode, /提交返回后立即取消 RH 后台任务/);
  assert.match(rhToolsNode, /reject:\s*\(error\?: Error\) => void/);
  assert.match(rhToolsNode, /cancelling \? '取消中\.\.\.' : '停止'/);
  assert.match(rhToolboxNode, /cancelRh/);
  assert.match(rhToolboxNode, /cancelInFlightRef/);
  assert.match(rhToolboxNode, /await cancelRh\(tid, activeTool\?\.rhSite === 'intl' \? 'intl' : 'cn'\)/);
  assert.match(rhToolboxNode, /cancelling \? '取消中\.\.\.' : '停止'/);
});

test('global run cancellation is broadcast to RH nodes with the active task targets', () => {
  const runBus = readFileSync(new URL('../src/stores/runBus.ts', import.meta.url), 'utf8');
  const actionBar = readFileSync(new URL('../src/components/NodeActionBar.tsx', import.meta.url), 'utf8');
  const runningHubNode = readFileSync(new URL('../src/components/nodes/RunningHubNode.tsx', import.meta.url), 'utf8');
  const rhToolsNode = readFileSync(new URL('../src/components/nodes/RHToolsNode.tsx', import.meta.url), 'utf8');
  const rhToolboxNode = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');
  const button = readFileSync(new URL('../src/components/RhImageCapabilityButton.tsx', import.meta.url), 'utf8');

  assert.match(runBus, /cancelSeq:\s*number/);
  assert.match(runBus, /cancelTargets:\s*string\[\]/);
  assert.match(runBus, /cancelSeq:\s*state\.cancelSeq \+ 1/);
  assert.match(runBus, /cancelTargets:\s*targetIds/);
  assert.match(actionBar, /runningIds = useRunBusStore/);
  assert.match(actionBar, /createCanvasNodeExecutionKey\(activeCanvasId, selectedExe\.id\)/);
  assert.match(actionBar, /runningIds\.includes\(selectedExecutionNodeId\)/);
  for (const source of [runningHubNode, rhToolsNode, rhToolboxNode]) {
    assert.match(source, /useRunBusStore/);
    assert.match(source, /cancelSeq/);
    assert.match(source, /cancelTargets/);
    assert.match(source, /handleStop\(\)/);
    assert.match(source, /createCanvasNodeExecutionKey\(originCanvasIdRef\.current, id\)/);
    assert.match(source, /runCancelTargets\.includes\(executionNodeId\)/);
  }
  assert.match(button, /activeTaskIdsRef/);
  assert.match(button, /cancelRh\(taskId\)/);
});

test('RH toolbox developer helpers stay private and runtime uses guarded imports', () => {
  const service = readFileSync(new URL('../src/services/rhToolbox.ts', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');
  const publicCheck = readFileSync(new URL('../scripts/check-public-clean.cjs', import.meta.url), 'utf8');

  assert.doesNotMatch(service, /RH_TOOLBOX_DEVELOPER_STORAGE_KEY|mergeRhToolboxManifestWithDeveloperDrafts/);
  assert.match(component, /if \(!import\.meta\.env\.DEV\)/);
  assert.match(component, /RH_TOOLBOX_DEVELOPER_MODULE/);
  assert.match(component, /@vite-ignore/);
  assert.match(publicCheck, /src\/utils\/rhToolboxDeveloper\.ts/);
});
