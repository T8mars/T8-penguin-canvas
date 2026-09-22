import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  QWEN_IMAGE_GLOBAL_21_MODEL,
  QWEN_IMAGE_GLOBAL_21_RATIOS,
  QWEN_IMAGE_GLOBAL_21_RESOLUTIONS,
  ANIMATE_MOTION_TRANSFER_MODEL,
  ANIMATE_MOTION_TRANSFER_POSE_METHODS,
} from '../src/providers/models.ts';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery.ts';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const root = join(import.meta.dirname, '..');
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';

test('Qwen 2.1 and Animate are independent seedance.nz model entries', () => {
  const qwen = IMAGE_MODELS.find((item) => item.id === QWEN_IMAGE_GLOBAL_21_MODEL);
  assert.ok(qwen);
  assert.equal(qwen.paramKind, 'qwen-image-global-2.1');
  assert.equal(qwen.defaultAspectRatio, '3:4');
  assert.equal(qwen.defaultSize, '2k');
  assert.equal(qwen.maxReferenceImages, 10);
  assert.deepEqual(qwen.aspectRatios, [...QWEN_IMAGE_GLOBAL_21_RATIOS]);
  assert.deepEqual(qwen.sizes, [...QWEN_IMAGE_GLOBAL_21_RESOLUTIONS]);

  const animate = VIDEO_MODELS.find((item) => item.id === ANIMATE_MOTION_TRANSFER_MODEL);
  assert.ok(animate);
  assert.equal(animate.kind, 'animate');
  assert.equal(animate.builtinSource, 'seedance-nz');
  assert.equal(animate.supportImages, true);
  assert.equal(animate.supportVideos, true);
  assert.equal(animate.maxRefImages, 1);
  assert.deepEqual(animate.resolutions, ['480p', '720p', '1080p']);
  assert.deepEqual([...ANIMATE_MOTION_TRANSFER_POSE_METHODS], ['vitpose', 'sdpose', 'wuwupose']);
});

test('Qwen Image Global 2.1 emits only the documented T2I fields', async () => {
  const built = await provider.buildQwenImageGlobal21Payload({
    model: QWEN_IMAGE_GLOBAL_21_MODEL,
    prompt: '  cinematic penguin poster  ',
    resolution: '4k',
    ratio: '21:9',
    seed: 9007199254740991,
    n: 6,
    size: '1024*1024',
    negative_prompt: 'ignored',
    prompt_extend: true,
  }, 'test-key');
  assert.equal(built.taskType, 't2i');
  assert.deepEqual(built.payload, {
    model: QWEN_IMAGE_GLOBAL_21_MODEL,
    prompt: 'cinematic penguin poster',
    metadata: { resolution: '4k', ratio: '21:9', seed: 9007199254740991 },
  });
});

test('Qwen Image Global 2.1 uploads 1-10 ordered references and omits seed -1', async () => {
  provider.resetCachesForTests();
  let upload = 0;
  const fetchImpl = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    upload += 1;
    return new Response(JSON.stringify({ url: `https://cdn.example.com/ref-${upload}.png` }), { status: 200 });
  };
  const built = await provider.buildQwenImageGlobal21Payload({
    model: QWEN_IMAGE_GLOBAL_21_MODEL,
    prompt: 'edit consistently',
    images: [IMAGE, 'data:image/png;base64,AAAA'],
    seed: -1,
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(built.taskType, 'i2i');
  assert.deepEqual(built.payload, {
    model: QWEN_IMAGE_GLOBAL_21_MODEL,
    prompt: 'edit consistently',
    metadata: { resolution: '2k', ratio: '3:4' },
    images: ['https://cdn.example.com/ref-1.png', 'https://cdn.example.com/ref-2.png'],
  });
});

test('Qwen Image Global 2.1 rejects invalid fields before upload/submission', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('{}', { status: 500 }); };
  await assert.rejects(provider.buildQwenImageGlobal21Payload({ model: QWEN_IMAGE_GLOBAL_21_MODEL, prompt: '', images: [IMAGE] }, 'k', { fetchImpl }), /必须填写提示词/);
  await assert.rejects(provider.buildQwenImageGlobal21Payload({ model: QWEN_IMAGE_GLOBAL_21_MODEL, prompt: 'x', resolution: '8k', images: [IMAGE] }, 'k', { fetchImpl }), /分辨率只支持/);
  await assert.rejects(provider.buildQwenImageGlobal21Payload({ model: QWEN_IMAGE_GLOBAL_21_MODEL, prompt: 'x', ratio: '4:5', images: [IMAGE] }, 'k', { fetchImpl }), /不支持比例/);
  await assert.rejects(provider.buildQwenImageGlobal21Payload({ model: QWEN_IMAGE_GLOBAL_21_MODEL, prompt: 'x', seed: 9007199254740992, images: [IMAGE] }, 'k', { fetchImpl }), /安全整数/);
  await assert.rejects(provider.buildQwenImageGlobal21Payload({ model: QWEN_IMAGE_GLOBAL_21_MODEL, prompt: 'x', images: Array(11).fill(IMAGE) }, 'k', { fetchImpl }), /最多支持 10 张/);
  assert.equal(calls, 0);
});

test('Animate Motion Transfer emits the full documented metadata and no unrelated fields', async () => {
  provider.resetCachesForTests();
  let upload = 0;
  const fetchImpl = async () => {
    upload += 1;
    return new Response(JSON.stringify({ url: upload === 1 ? 'https://cdn.example.com/person.png' : 'https://cdn.example.com/motion.mp4' }), { status: 200 });
  };
  const built = await provider.buildAnimateMotionTransferPayload({
    model: ANIMATE_MOTION_TRANSFER_MODEL,
    images: [IMAGE],
    videos: [VIDEO],
    prompt: 'must not be forwarded',
    seed: 123,
    resolution: '1080p',
    ratio: '16:9',
    frameRate: 24,
    maxFrames: 240,
    skipFrames: 3,
    poseMethod: 'wuwupose',
    normalMode: false,
    neckCorrection: true,
    poseStrength: 1.2,
    cameraMotion: true,
    cameraStrength: 0.7,
    maskMode: true,
    expressionStrength: 0.9,
    chestMotionStrength: 0.3,
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(built.taskType, 'motion-transfer');
  assert.deepEqual(built.payload, {
    model: ANIMATE_MOTION_TRANSFER_MODEL,
    images: ['https://cdn.example.com/person.png'],
    metadata: {
      video_url: ['https://cdn.example.com/motion.mp4'],
      resolution: '1080p', ratio: '16:9', frame_rate: 24, skip_frames: 3, pose_method: 'wuwupose',
      normal_mode: false, neck_correction: true, pose_strength: 1.2, camera_motion: true,
      camera_strength: 0.7, mask_mode: true, expression_strength: 0.9, chest_motion_strength: 0.3,
      max_frames: 240,
    },
  });
});

test('Animate Motion Transfer preflight is fail-closed and max_frames zero is omitted', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ url: `https://cdn.example.com/${calls === 1 ? 'person.png' : 'motion.mp4'}` }), { status: 200 });
  };
  await assert.rejects(provider.buildAnimateMotionTransferPayload({ model: ANIMATE_MOTION_TRANSFER_MODEL, images: [], videos: [VIDEO] }, 'k', { fetchImpl }), /只能提供 1 张/);
  await assert.rejects(provider.buildAnimateMotionTransferPayload({ model: ANIMATE_MOTION_TRANSFER_MODEL, images: [IMAGE], videos: [VIDEO, VIDEO] }, 'k', { fetchImpl }), /只能提供 1 个动作视频/);
  await assert.rejects(provider.buildAnimateMotionTransferPayload({ model: ANIMATE_MOTION_TRANSFER_MODEL, images: [IMAGE], videos: [VIDEO], ratio: 'bad' }, 'k', { fetchImpl }), /比例必须/);
  await assert.rejects(provider.buildAnimateMotionTransferPayload({ model: ANIMATE_MOTION_TRANSFER_MODEL, images: [IMAGE], videos: [VIDEO], resolution: '1080p', frameRate: 24, maxFrames: 241 }, 'k', { fetchImpl }), /不能超过/);
  assert.equal(calls, 0);

  const built = await provider.buildAnimateMotionTransferPayload({ model: ANIMATE_MOTION_TRANSFER_MODEL, images: [IMAGE], videos: [VIDEO], maxFrames: 0 }, 'k', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(Object.hasOwn(built.payload.metadata, 'max_frames'), false);
});

test('Animate submission/query use fixed endpoints and accept video_urls output', async () => {
  provider.resetCachesForTests();
  const requests: Array<{ url: string; method: string; body: any }> = [];
  let upload = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = String(init?.method || 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });
    if (url.endsWith('/v1/files/upload')) {
      upload += 1;
      return new Response(JSON.stringify({ url: upload === 1 ? 'https://cdn.example.com/person.png' : 'https://cdn.example.com/motion.mp4' }), { status: 200 });
    }
    if (url.endsWith('/v1/video/generations') && method === 'POST') {
      return new Response(JSON.stringify({ data: { task_id: 'animate-task' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { status: 'SUCCESS', data: { content: { video_urls: ['https://cdn.example.com/result.mp4'] } } } }), { status: 200 });
  };
  const submitted = await provider.submitAnimateMotionTransferTask({ model: ANIMATE_MOTION_TRANSFER_MODEL, images: [IMAGE], videos: [VIDEO] }, 'k', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(submitted.taskId, 'animate-task');
  assert.equal(requests.filter((item) => item.url.endsWith('/v1/video/generations') && item.method === 'POST').length, 1);
  const queried = await provider.queryAnimateMotionTransferTask(submitted.taskId, 'k', { fetchImpl });
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.videoUrl, 'https://cdn.example.com/result.mp4');
});

test('routes, restart recovery and four credential-free workflows are complete', () => {
  const generation = readFileSync(join(root, 'src', 'services', 'generation.ts'), 'utf8');
  const routes = readFileSync(join(root, 'backend', 'src', 'routes', 'proxy.js'), 'utf8');
  const imageNode = readFileSync(join(root, 'src', 'components', 'nodes', 'ImageNode.tsx'), 'utf8');
  const videoNode = readFileSync(join(root, 'src', 'components', 'nodes', 'VideoNode.tsx'), 'utf8');
  const visibleCatalog = readFileSync(join(root, 'src', 'i18n', 'nodeVisibleCatalog.ts'), 'utf8');
  assert.match(generation, /\/api\/proxy\/video\/animate\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/animate\/status/);
  assert.match(routes, /\/video\/animate\/submit/);
  assert.match(routes, /\/video\/animate\/status\/:tid/);
  assert.match(imageNode, /isQwenImage21Tab/);
  assert.match(imageNode, /qwen21Resolution/);
  assert.match(imageNode, /QWEN_IMAGE_GLOBAL_21_MAX_REFERENCE_IMAGES/);
  assert.match(videoNode, /submitAnimateMotionTransfer/);
  assert.match(videoNode, /animatePoseMethod/);
  assert.match(videoNode, /animateChestMotionStrength/);
  assert.match(videoNode, /!isUpscaler && !isAnimate && <div>/);
  assert.match(videoNode, /isAnimate \? \['image', 'video'\]/);
  assert.match(videoNode, /payload\.kind === 'video'.*\(isAnimate \|\|/);
  assert.match(videoNode, /const cap = isAnimate\s+\? 1\s+: isWan/);
  assert.match(visibleCatalog, /Animate Motion Transfer · 必须恰好一图一视频/);
  assert.equal(inferRunRecoveryDescriptor({ provider: 'seedance-nz', model: ANIMATE_MOTION_TRANSFER_MODEL, taskId: 'task/id' })?.kind, 'animate');

  for (const file of [
    'qwen-image-global-2.1-t2i.json',
    'qwen-image-global-2.1-i2i.json',
    'animate-motion-transfer-local.json',
    'animate-motion-transfer-url.json',
  ]) {
    const text = readFileSync(join(root, 'docs', 'workflows', file), 'utf8');
    const workflow = JSON.parse(text);
    assert.equal(workflow.schema, 't8-workflow-fragment');
    assert.equal(workflow.nodeCount, workflow.nodes.length);
    assert.equal(workflow.edgeCount, workflow.edges.length);
    assert.doesNotMatch(text, /\bsk-[A-Za-z0-9_-]{12,}\b|api[_-]?key|task[_-]?id|X-Amz-Signature/i);
  }
});
