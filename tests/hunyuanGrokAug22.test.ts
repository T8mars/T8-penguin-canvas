import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VIDEO_MODELS,
  ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL,
} from '../src/providers/models.ts';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const root = join(import.meta.dirname, '..');
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('Grok lowprice video exposes the four documented modes and exact top-level payload fields', async () => {
  const tab = VIDEO_MODELS.find((item) => item.id === 'grok-video-3');
  const option = tab?.apiModelOptions.find((item) => item.value === ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL);
  assert.ok(option);
  assert.deepEqual(option?.durations, [4, 6, 8, 10]);
  assert.deepEqual(option?.resolutions, ['720p', '1080p', '4k']);
  const text = await provider.buildApimartVideoPayload({ model: ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL, mode: 'text', prompt: 'test', seconds: 4, resolution: '720p', aspect_ratio: '16:9' }, 'key');
  assert.deepEqual(text.payload, { model: ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL, prompt: 'test', resolution: '720p', aspect_ratio: '16:9', nsfw_check: false, seconds: '4' });
  provider.resetCachesForTests();
  const uploaded = async () => json({ url: 'https://cdn.example.com/input' });
  const frame = await provider.buildApimartVideoPayload({ model: ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL, mode: 'frame', prompt: 'test', images: [IMAGE] }, 'key', { fetchImpl: uploaded, uploadIntervalMs: 0 });
  assert.equal(frame.payload.generation_type, 'frame');
  assert.equal(frame.payload.images.length, 1);
  provider.resetCachesForTests();
  const referenceVideo = await provider.buildApimartVideoPayload({ model: ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL, mode: 'reference_video', prompt: 'test', videos: [VIDEO] }, 'key', { fetchImpl: uploaded, uploadIntervalMs: 0 });
  assert.equal('seconds' in referenceVideo.payload, false);
  assert.equal(referenceVideo.payload.metadata.video_url, 'https://cdn.example.com/input');
  await assert.rejects(provider.buildApimartVideoPayload({ model: ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL, mode: 'reference_images', prompt: 'test', images: [IMAGE, IMAGE] }, 'key'), /1 或 3/);
});

test('Veo tab exposes Omni 1.1 lowprice with the documented four-mode payload contract', async () => {
  const tab = VIDEO_MODELS.find((item) => item.id === 'veo3.1');
  const option = tab?.apiModelOptions.find((item) => item.value === ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL);
  assert.ok(option);
  assert.equal(option?.builtinSource, 'seedance-nz');
  assert.deepEqual(option?.durations, [4, 6, 8, 10]);
  assert.deepEqual(option?.resolutions, ['720p', '1080p', '4k']);
  assert.deepEqual(option?.ratios, ['16:9', '9:16']);
  assert.equal(option?.maxRefImages, 3);
  assert.equal(option?.maxRefVideos, 1);

  const text = await provider.buildApimartVideoPayload({
    model: ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
    mode: 'text',
    prompt: 'test',
    seconds: 4,
    resolution: '720p',
    aspect_ratio: '16:9',
  }, 'key');
  assert.deepEqual(text.payload, {
    model: ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
    prompt: 'test',
    resolution: '720p',
    aspect_ratio: '16:9',
    nsfw_check: false,
    seconds: '4',
  });

  provider.resetCachesForTests();
  const uploaded = async () => json({ url: 'https://cdn.example.com/input' });
  const referenceImages = await provider.buildApimartVideoPayload({
    model: ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
    mode: 'reference_images',
    prompt: 'test',
    images: [IMAGE, IMAGE, IMAGE],
  }, 'key', { fetchImpl: uploaded, uploadIntervalMs: 0 });
  assert.equal(referenceImages.payload.generation_type, 'reference');
  assert.equal(referenceImages.payload.images.length, 3);

  provider.resetCachesForTests();
  const referenceVideo = await provider.buildApimartVideoPayload({
    model: ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
    mode: 'reference_video',
    prompt: 'test',
    videos: [VIDEO],
  }, 'key', { fetchImpl: uploaded, uploadIntervalMs: 0 });
  assert.equal('seconds' in referenceVideo.payload, false);
  assert.equal(referenceVideo.payload.metadata.video_url, 'https://cdn.example.com/input');
});

test('Grok segment and region edit use dedicated operation contracts', async () => {
  assert.equal(ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL, 'zhenzhen-image-gk-v2-segment');
  assert.equal(ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL, 'zhenzhen-image-gk-v2-region-edit');
  const segment = await provider.buildApimartImagePayload({ model: ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL, source_task_id: 'source-1', include_mask_rle: true }, 'key');
  assert.deepEqual(segment.payload, { model: ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL, operation: 'segment', source_task_id: 'source-1', include_mask_rle: true });
  const edit = await provider.buildApimartImagePayload({ model: ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL, image_id: 'image-1', prompt: 'change car', object_indices: [0, 2] }, 'key');
  assert.deepEqual(edit.payload, { model: ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL, operation: 'region_edit', image_id: 'image-1', prompt: 'change car', object_indices: [0, 2] });
  const queried = await provider.queryImageTask('task-1', 'key', { fetchImpl: async () => json({ data: { status: 'SUCCESS', content: { result: { image_id: 'image-1', objects: [{ label: 'car' }] } } } }) });
  assert.equal(queried.operationResult.image_id, 'image-1');
  assert.equal(queried.imageUrls.length, 0);
});

test('Hunyuan 3D validates both models, ordered view limits, and documented poll endpoint', async () => {
  const text = await provider.buildHunyuan3dPayload({ model: 'hunyuan3d-v3.1-text-to-3d', prompt: 'penguin', face_count: 10000, generate_type: 'Sketch' }, 'key');
  assert.deepEqual(text.payload, { model: 'hunyuan3d-v3.1-text-to-3d', prompt: 'penguin', face_count: 10000, enable_pbr: false, generate_type: 'Sketch' });
  provider.resetCachesForTests();
  const image = await provider.buildHunyuan3dPayload({ model: 'hunyuan3d-v3.1-image-to-3d', prompt: 'penguin', images: [IMAGE], enable_pbr: true }, 'key', { fetchImpl: async () => json({ url: 'https://cdn.example.com/front.png' }), uploadIntervalMs: 0 });
  assert.deepEqual(image.payload.images, ['https://cdn.example.com/front.png']);
  assert.equal(image.payload.face_count, 500000);
  await assert.rejects(provider.buildHunyuan3dPayload({ model: 'hunyuan3d-v3.1-image-to-3d', prompt: 'x', images: [] }, 'key'), /1-8/);
  let requested = '';
  const result = await provider.queryHunyuan3dTask('3d-task', 'key', { fetchImpl: async (url: string) => { requested = url; return json({ data: { status: 'SUCCESS', result_url: 'https://cdn.example.com/model.glb' } }); } });
  assert.match(requested, /\/v1\/3d\/generations\/3d-task$/);
  assert.equal(result.modelUrl, 'https://cdn.example.com/model.glb');
  const nested = await provider.queryHunyuan3dTask('nested-task', 'key', { fetchImpl: async () => json({ data: { status: 'SUCCESS', content: { preview_url: 'https://cdn.example.com/preview.png', file_urls: ['https://cdn.example.com/archive.zip', 'https://cdn.example.com/final.glb'] } } }) });
  assert.deepEqual(nested.modelUrls, ['https://cdn.example.com/final.glb']);
});

test('new nodes, extensible Hunyuan tab, routes, and twelve workflows are credential-free', () => {
  const schema = JSON.parse(readFileSync(join(root, 'backend/src/shared/canvasNodeSchema.json'), 'utf8'));
  assert.equal(schema.types.some((item: any) => item.type === 'model-3d' && item.label === '3D'), true);
  assert.equal(schema.types.some((item: any) => item.type === 'grok-image-tools'), true);
  const modelNode = readFileSync(join(root, 'src/components/nodes/Model3DNode.tsx'), 'utf8');
  assert.match(modelNode, /MODEL_3D_TABS/);
  assert.match(modelNode, /label: 'Hunyuan 3D'/);
  const routes = readFileSync(join(root, 'backend/src/routes/proxy.js'), 'utf8');
  assert.match(routes, /\/3d\/seedance-nz\/submit/);
  assert.match(routes, /saveRemoteFalToolboxFile\(remoteUrl, 'model3d'/);
  const names = [
    'zhenzhen-video-g-omni-flash-lowprice-text.json', 'zhenzhen-video-g-omni-flash-lowprice-frame.json',
    'zhenzhen-video-g-omni-flash-lowprice-reference-images.json', 'zhenzhen-video-g-omni-flash-lowprice-reference-video.json',
    'zhenzhen-video-g-omni-1.1-flash-lowprice-text.json', 'zhenzhen-video-g-omni-1.1-flash-lowprice-frame.json',
    'zhenzhen-video-g-omni-1.1-flash-lowprice-reference-images.json', 'zhenzhen-video-g-omni-1.1-flash-lowprice-reference-video.json',
    'hunyuan3d-v3.1-text-to-3d.json', 'hunyuan3d-v3.1-image-to-3d.json',
    'zhenzhen-image-gk-v2-segment.json', 'zhenzhen-image-gk-v2-region-edit.json',
  ];
  for (const name of names) {
    const raw = readFileSync(join(root, 'docs/workflows', name), 'utf8');
    assert.doesNotMatch(raw, /sk-[A-Za-z0-9]/);
    const workflow = JSON.parse(raw);
    assert.equal(workflow.nodeCount, workflow.nodes.length);
    assert.equal(workflow.edgeCount, workflow.edges.length);
  }
  const liveVerifier = readFileSync(join(root, 'scripts/verify-veo-omni11-live.cjs'), 'utf8');
  assert.match(liveVerifier, /SEEDANCE_NZ_LIVE_API_KEY/);
  assert.match(liveVerifier, /zhenzhen-video-g-omni-1\.1-flash-lowprice/);
  assert.match(liveVerifier, /ffprobe/);
  assert.match(liveVerifier, /-f', 'null'/);
  assert.doesNotMatch(liveVerifier, /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(liveVerifier, /zhenzhenSd2ApiKey/);
});
