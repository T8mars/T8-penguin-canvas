import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const seedanceNz = require('../backend/src/providers/seedanceNz.js');

test('seedance.nz keeps TLS verification enabled with the pinned official root', () => {
  const source = readFileSync(new URL('../backend/src/providers/seedanceNz.js', import.meta.url), 'utf8');

  assert.match(source, /LETS_ENCRYPT_ROOT_YR/);
  assert.match(source, /rejectUnauthorized:\s*true/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
  assert.match(source, /return await fetch\(url,\s*request\)/);
  assert.ok(
    source.indexOf('return await fetch(url, request)')
      < source.indexOf('dispatcher: seedanceDispatcher'),
    'the active system network must run before the provider-specific TLS recovery connection',
  );
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TINY_PNG_A = 'data:image/png;base64,iVBORw0KGgo=';
const TINY_PNG_B = 'data:image/png;base64,iVBORw0KGgox';
const TINY_MP3 = 'data:audio/mpeg;base64,SUQzAwAAAAA=';
const TINY_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';

test('seedance.nz provider boundary forwards options.signal and aborts a hanging poll', async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const pending = seedanceNz.queryTask('task-abort', 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    signal: controller.signal,
    providerDeadlineMs: 5_000,
    allowShortProviderTimeoutsForTests: true,
    fetchImpl: (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      if (init?.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  });
  controller.abort(new Error('test-client-stop'));
  await assert.rejects(pending, (error: any) => error?.code === 'SEEDANCE_REQUEST_ABORTED' && error?.status === 499);
  assert.ok(observedSignal);
  assert.equal(observedSignal?.aborted, true);
});

test('seedance.nz Suno catalog is an explicit 34-action whitelist', () => {
  const operations = Object.keys(seedanceNz.SUNO_ACTION_SPECS);
  assert.equal(operations.length, 34);
  assert.equal(operations[0], 'suno-generation');
  assert.equal(operations.at(-1), 'suno-add-stem');
  assert.equal(seedanceNz.SUNO_ACTION_SPECS['suno-generation'].action, '');
  assert.equal(seedanceNz.SUNO_ACTION_SPECS['suno-generate-mp4'].action, 'generate-mp4');
  assert.equal(seedanceNz.SUNO_ACTION_SPECS['suno-create-model'].resultFamily, 'model');
  assert.deepEqual(seedanceNz.SUNO_V6_VERSIONS, ['v6', 'v6-wild', 'v6-mini']);
  assert.deepEqual(seedanceNz.SUNO_VERSIONS, ['v3.5', 'v4', 'v4.5', 'v4.5+', 'v4.5-all', 'v5', 'v5.5']);
});

test('seedance.nz builds every documented Suno action with model=suno and only its allowed fields', async () => {
  const common = {
    prompt: 'A cinematic electronic song about a rainy city',
    version: 'v5.5',
    custom: true,
    instrumental: false,
    title: 'Rain City',
    style: 'cinematic electronic',
    vocal_gender: 'f',
    tags: 'cinematic, electronic',
    custom_model_id: '',
    gpt_description: 'Turn the source into a cinematic instrumental',
    negative_tags: 'harsh vocals',
    style_weight: 0.5,
    weirdness: 0.5,
    audio_weight: 0.5,
    auto_lyrics: false,
    persona_id: '',
    variety: 'normal',
    max_mode: false,
    audio_format: 'mp3',
    audioFilePath: TINY_MP3,
    audio_url: TINY_MP3,
    audio_urls: [TINY_MP3],
    task_id: 'task_source_a',
    task_id_2: 'task_source_b',
    task_ids: ['task_source_a', 'task_source_b'],
    audio_index: 1,
    continue_at: 10,
    start_s: 2,
    end_s: 8,
    duration_s: 3,
    speed: 1.1,
    name: 'Rain Voice',
  };
  const fetchImpl = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    return jsonResponse({ url: 'https://cdn.example.com/reference.mp3' });
  };

  for (const operation of Object.keys(seedanceNz.SUNO_ACTION_SPECS)) {
    seedanceNz.resetCachesForTests();
    const request = { operation, ...common } as any;
    if (operation === 'suno-create-model') {
      request.audio_urls = Array.from({ length: 6 }, () => TINY_MP3);
      request.name = 'V6 Custom Model';
    }
    if (operation === 'suno-upload-cover' || operation === 'suno-upload-extend') {
      request.version = 'v6-mini';
      request.vocal_gender = 'Female';
      request.audio_urls = undefined;
      request.audioUrls = undefined;
      request.audioFilePath = undefined;
      request.duration_s = 10;
      request.continue_at = 2;
    }
    const built = await seedanceNz.buildSunoMusicPayload(
      request,
      'test-key',
      { fetchImpl, uploadIntervalMs: 0, sunoAudioDurationProbe: async () => 12 },
    );
    const spec = seedanceNz.SUNO_ACTION_SPECS[operation];
    assert.equal(built.operation, operation);
    assert.equal(built.action, operation === 'suno-generation' ? '' : operation.slice(5));
    assert.equal(built.payload.model, 'suno');
    for (const field of Object.keys(built.payload)) {
      assert.ok(field === 'model' || spec.allowedFields.includes(field), `${operation} leaked field ${field}`);
    }
    for (const field of spec.requiredFields) {
      assert.notEqual(built.payload[field], undefined, `${operation} missing ${field}`);
    }
  }
});

test('seedance.nz rejects unknown Suno routes and invalid action contracts before fetch', async () => {
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({ operation: 'suno-not-real' }, 'test-key'),
    /未知 Suno 操作/,
  );
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({
      operation: 'suno-mashup',
      task_ids: ['only-one'],
      prompt: 'mix them',
      version: 'v5.5',
    }, 'test-key'),
    /必须填写 2 个 task_id/,
  );
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({
      operation: 'suno-crop',
      task_id: 'task_a',
      start_s: 9,
      end_s: 2,
    }, 'test-key'),
    /end_s 必须大于 start_s/,
  );
});

test('seedance.nz builds create-model with 6-24 ordered uploads and extracts the completed model_id', async () => {
  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const fetchImpl = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/model-reference-${uploadIndex}.wav` });
  };
  const built = await seedanceNz.buildSunoMusicPayload({
    operation: 'suno-create-model',
    name: 'V6 Studio Voice',
    audio_urls: Array.from({ length: 6 }, (_, index) => `data:audio/wav;base64,${Buffer.from(`audio-${index}`).toString('base64')}`),
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0, uploadCacheTtlMs: 0 });
  assert.equal(built.action, 'create-model');
  assert.equal(built.resultFamily, 'model');
  assert.deepEqual(built.payload, {
    model: 'suno',
    name: 'V6 Studio Voice',
    audio_urls: Array.from({ length: 6 }, (_, index) => `https://cdn.example.com/model-reference-${index + 1}.wav`),
  });

  const queried = await seedanceNz.querySunoMusicTask('model_task_1', 'test-key', {
    resultFamily: 'model',
    fetchImpl: async () => jsonResponse({
      data: { task_id: 'model_task_1', status: 'completed', result: { model_id: '11111111-2222-4333-8444-555555555555' } },
    }),
  });
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.resultFamily, 'model');
  assert.equal(queried.text, '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(queried.artifacts, []);
});

test('seedance.nz enforces upload-cover modes and V6 custom-model exclusivity', async () => {
  const uploaded = async () => jsonResponse({ url: 'https://cdn.example.com/source.wav' });
  const descriptionMode = await seedanceNz.buildSunoMusicPayload({
    operation: 'suno-upload-cover',
    version: 'v6-mini',
    audio_url: TINY_MP3,
    custom: false,
    instrumental: false,
    gpt_description: 'Rewrite this as a calm cinematic instrumental',
    prompt: 'must be omitted',
    tags: 'must be omitted',
    title: 'must be omitted',
    negative_tags: 'must be omitted',
    style_weight: 0.9,
    weirdness: 0.8,
    audio_weight: 0.7,
    auto_lyrics: true,
    persona_id: 'must-be-omitted',
    duration_s: 120,
    variety: 'normal',
    max_mode: true,
    audio_format: 'mp3',
    vocal_gender: 'Female',
  }, 'test-key', { fetchImpl: uploaded, uploadIntervalMs: 0, uploadCacheTtlMs: 0 });
  assert.deepEqual(descriptionMode.payload, {
    model: 'suno',
    version: 'v6-mini',
    custom: false,
    instrumental: false,
    gpt_description: 'Rewrite this as a calm cinematic instrumental',
    vocal_gender: 'Female',
    variety: 'normal',
    audio_format: 'mp3',
    audio_url: 'https://cdn.example.com/source.wav',
  });

  const customMode = await seedanceNz.buildSunoMusicPayload({
    operation: 'suno-upload-cover',
    version: 'v6-wild',
    custom_model_id: '11111111-2222-4333-8444-555555555555',
    audio_url: TINY_MP3,
    custom: true,
    instrumental: false,
    gpt_description: 'must be omitted',
    prompt: '[Verse]\nFollow the light',
    tags: 'cinematic, electronic',
    title: 'Follow the Light',
    negative_tags: 'harsh vocals',
    style_weight: 0,
    weirdness: 0.25,
    audio_weight: 1,
    auto_lyrics: false,
    duration_s: 60,
    variety: 'high',
    max_mode: true,
    audio_format: 'wav',
    vocal_gender: 'Female',
  }, 'test-key', { fetchImpl: uploaded, uploadIntervalMs: 0, uploadCacheTtlMs: 0 });
  assert.equal(customMode.payload.version, undefined);
  assert.equal(customMode.payload.persona_id, undefined);
  assert.equal(customMode.payload.gpt_description, undefined);
  assert.equal(customMode.payload.custom_model_id, '11111111-2222-4333-8444-555555555555');
  assert.equal(customMode.payload.style_weight, 0);
  assert.equal(customMode.payload.audio_weight, 1);
  assert.equal(customMode.payload.duration_s, 60);
});

test('seedance.nz upload-extend omits cover mode fields and probes the real source duration', async () => {
  let durationProbes = 0;
  const built = await seedanceNz.buildSunoMusicPayload({
    operation: 'suno-upload-extend',
    version: 'v6-wild',
    audio_url: TINY_MP3,
    continue_at: 2,
    duration_s: 20,
    custom: true,
    instrumental: true,
    gpt_description: 'must never be sent',
    prompt: 'Continue with a restrained piano outro',
    tags: 'cinematic piano',
    title: 'Outro',
    style_weight: 0.4,
    weirdness: 0.2,
    audio_weight: 0.8,
    auto_lyrics: false,
    persona_id: 'persona-1',
    variety: 'extra',
    max_mode: true,
    audio_format: 'm4a',
  }, 'test-key', {
    fetchImpl: async () => jsonResponse({ url: 'https://cdn.example.com/source.wav' }),
    uploadIntervalMs: 0,
    uploadCacheTtlMs: 0,
    sunoAudioDurationProbe: async () => { durationProbes += 1; return 12; },
  });
  assert.equal(durationProbes, 1);
  assert.equal(built.payload.custom, undefined);
  assert.equal(built.payload.instrumental, undefined);
  assert.equal(built.payload.gpt_description, undefined);
  assert.equal(built.payload.continue_at, 2);
  assert.equal(built.payload.duration_s, 20);
  assert.equal(built.payload.audio_url, 'https://cdn.example.com/source.wav');

  let uploadCalls = 0;
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({
      operation: 'suno-upload-extend',
      version: 'v6',
      audio_url: TINY_MP3,
      continue_at: 12,
      duration_s: 10,
    }, 'test-key', {
      fetchImpl: async () => { uploadCalls += 1; return jsonResponse({ url: 'https://cdn.example.com/never.wav' }); },
      uploadIntervalMs: 0,
      uploadCacheTtlMs: 0,
      sunoAudioDurationProbe: async () => 12,
    }),
    /continue_at 必须小于源音频实际时长/,
  );
  assert.equal(uploadCalls, 0, 'invalid continue_at must fail before Provider upload');
});

test('seedance.nz rejects invalid Suno V6 action fields before Provider upload', async () => {
  const noFetch = async () => { throw new Error('fetch must not run'); };
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({ operation: 'suno-create-model', name: 'Too Few', audio_urls: Array(5).fill(TINY_MP3) }, 'test-key', { fetchImpl: noFetch }),
    /6-24/,
  );
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({ operation: 'suno-upload-cover', version: 'v6', custom_model_id: 'model-1', persona_id: 'persona-1', audio_url: TINY_MP3, custom: false, gpt_description: 'calm' }, 'test-key', { fetchImpl: noFetch }),
    /不能同时使用/,
  );
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({ operation: 'suno-upload-cover', version: 'v6', audio_url: TINY_MP3, custom: false, gpt_description: '字'.repeat(3001) }, 'test-key', { fetchImpl: noFetch }),
    /最多 3000/,
  );
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({ operation: 'suno-upload-cover', version: 'v6', audio_url: TINY_MP3, custom: true, instrumental: false, prompt: 'ok', style_weight: 1.01 }, 'test-key', { fetchImpl: noFetch }),
    /0-1/,
  );
  await assert.rejects(
    seedanceNz.buildSunoMusicPayload({ operation: 'suno-upload-extend', version: 'v6', audio_url: TINY_MP3, continue_at: 0 }, 'test-key', { fetchImpl: noFetch }),
    /大于等于 1/,
  );
});

test('seedance.nz submits and queries Suno through the official music endpoints', async () => {
  const seen: Array<{ url: string; body?: any }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    if (url.endsWith('/v1/music/generations')) {
      return jsonResponse({ data: { task_id: 'music_task_1', status: 'pending' } });
    }
    if (url.endsWith('/v1/music/tasks/music_task_1')) {
      return jsonResponse({
        data: {
          task_id: 'music_task_1',
          status: 'completed',
          progress: 100,
          result: {
            music: [{
              id: 'track_1',
              title: 'Rain City',
              audio_url: 'https://cdn.example.com/rain.mp3',
              image_url: 'https://cdn.example.com/rain.png',
            }],
          },
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const submitted = await seedanceNz.submitSunoMusicTask({
    operation: 'suno-generation',
    prompt: 'A cinematic electronic song about a rainy city',
    version: 'v5.5',
  }, 'test-key', { fetchImpl });
  assert.equal(submitted.taskId, 'music_task_1');
  assert.equal(submitted.status, 'pending');
  assert.equal(seen[0].url, `${seedanceNz.BASE_URL}/v1/music/generations`);
  assert.deepEqual(seen[0].body, {
    model: 'suno',
    version: 'v5.5',
    prompt: 'A cinematic electronic song about a rainy city',
  });

  const queried = await seedanceNz.querySunoMusicTask('music_task_1', 'test-key', {
    fetchImpl,
    resultFamily: 'audio',
  });
  assert.equal(queried.status, 'succeeded');
  assert.deepEqual(queried.artifacts, [
    { url: 'https://cdn.example.com/rain.mp3', kind: 'audio' },
    { url: 'https://cdn.example.com/rain.png', kind: 'image' },
  ]);
  assert.equal(queried.music[0].title, 'Rain City');
});

async function listen(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  server.on('connection', (socket) => socket.on('error', () => {}));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function closeServer(server: Awaited<ReturnType<typeof listen>>) {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test('seedance.nz derives all 18 official model IDs from family and task type', () => {
  const families = [
    'standard', 'fast', 'mini',
    'global-standard', 'global-fast', 'global-mini',
  ];
  const taskTypes = ['t2v', 'i2v', 'multi'];
  const models = families.flatMap((family) => taskTypes.map((taskType) => (
    seedanceNz.resolveModel(family, taskType)
  )));

  assert.equal(new Set(models).size, 18);
  assert.ok(models.includes('seedance-2.0-standard-t2v'));
  assert.ok(models.includes('seedance-2.0-global-mini-multi'));
});

test('seedance.nz builds i2v payload with official images field and normalized native4k', async () => {
  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const fetchImpl = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/frame-${uploadIndex}.png` });
  };
  const built = await seedanceNz.buildPayload({
    model: 'standard',
    prompt: 'A calm camera move',
    duration: 5,
    ratio: '16:9',
    resolution: 'native4K',
    firstFrame: TINY_PNG_A,
    lastFrame: TINY_PNG_B,
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });

  assert.equal(built.taskType, 'i2v');
  assert.equal(built.model, 'seedance-2.0-standard-i2v');
  assert.deepEqual(built.payload.images, [
    'https://cdn.example.com/frame-1.png',
    'https://cdn.example.com/frame-2.png',
  ]);
  assert.equal(built.payload.metadata.resolution, 'native4k');
  assert.equal(built.payload.seconds, '5');
  assert.equal('content' in built.payload.metadata, false);
});

test('seedance.nz uploads one image, one video and one audio then builds multi content', async () => {
  seedanceNz.resetCachesForTests();
  const uploads: Array<{ url: string; body: FormData }> = [];
  let uploadIndex = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    assert.match(url, /\/v1\/files\/upload$/);
    assert.ok(init?.body instanceof FormData);
    uploads.push({ url, body: init.body as FormData });
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/ref-${uploadIndex}` });
  };

  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const tinyMp4 = 'data:video/mp4;base64,AAAAHGZ0eXBpc29t';
  const tinyMp3 = 'data:audio/mpeg;base64,SUQzAwAAAAA=';
  const built = await seedanceNz.buildPayload({
    model: 'global-mini',
    prompt: 'Use @image_1, @VIDEO-1 and @audio1 together',
    duration: 4,
    ratio: 'adaptive',
    resolution: '480p',
    generate_audio: false,
    refImages: [tinyPng],
    videos: [tinyMp4],
    audios: [tinyMp3],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });

  assert.equal(uploads.length, 3);
  assert.equal(built.taskType, 'multi');
  assert.equal(built.model, 'seedance-2.0-global-mini-multi');
  assert.equal(built.payload.prompt, 'Use @Image 1, @Video 1 and @Audio 1 together');
  assert.deepEqual(built.payload.metadata.content, [
    { type: 'image_url', image_url: { url: 'https://cdn.example.com/ref-1' } },
    { type: 'video_url', video_url: { url: 'https://cdn.example.com/ref-2' } },
    { type: 'audio_url', audio_url: { url: 'https://cdn.example.com/ref-3' } },
  ]);
});

test('seedance.nz rejects mixed first-frame and multi-reference payloads', async () => {
  await assert.rejects(
    seedanceNz.buildPayload({
      model: 'mini',
      prompt: 'invalid mixed mode',
      firstFrame: 'https://assets.example.com/first.png',
      audios: ['https://assets.example.com/audio.mp3'],
    }, 'test-key'),
    /不能同时混入参考图、视频或音频/,
  );
});

test('seedance.nz submit and query use official endpoints and normalize completed output', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/videos')) return jsonResponse({ id: 'task-123', status: 'queued' });
    return jsonResponse({ status: 'completed', progress: 100, metadata: { url: 'https://cdn.example.com/result.mp4' } });
  };

  const submitted = await seedanceNz.submitTask({
    model: 'mini',
    prompt: 'minimal test',
    duration: 4,
    ratio: '16:9',
    resolution: '480p',
  }, 'test-key', { baseUrl: 'https://api.seedance.nz', fetchImpl });
  const queried = await seedanceNz.queryTask('task-123', 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl,
  });

  assert.equal(submitted.taskId, 'task-123');
  assert.equal(submitted.model, 'seedance-2.0-mini-t2v');
  assert.equal(calls[0].url, 'https://api.seedance.nz/v1/videos');
  assert.equal(calls[1].url, 'https://api.seedance.nz/v1/videos/task-123');
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.videoUrl, 'https://cdn.example.com/result.mp4');
});

test('seedance.nz builds official Seedream t2i and i2i payloads without mixing video fields', async () => {
  seedanceNz.resetCachesForTests();
  const t2i = await seedanceNz.buildImagePayload({
    prompt: 'a blue ceramic cup on a white table',
    resolution: '2k',
    output_format: 'png',
  }, 'test-key');

  assert.equal(t2i.model, 'seedream-v5-pro-t2i');
  assert.equal(t2i.taskType, 't2i');
  assert.deepEqual(t2i.payload, {
    model: 'seedream-v5-pro-t2i',
    prompt: 'a blue ceramic cup on a white table',
    metadata: { resolution: '2k', output_format: 'png' },
  });

  const fetchImpl = async (url: string, init?: RequestInit) => {
    assert.match(url, /\/v1\/files\/upload$/);
    assert.ok(init?.body instanceof FormData);
    return jsonResponse({ url: 'https://cdn.example.com/reference.png' });
  };
  const i2i = await seedanceNz.buildImagePayload({
    prompt: 'change the cup to glossy red',
    images: ['data:image/png;base64,iVBORw0KGgo='],
    size: '1280x960',
    output_format: 'jpeg',
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });

  assert.equal(i2i.model, 'seedream-v5-pro-i2i');
  assert.equal(i2i.taskType, 'i2i');
  assert.deepEqual(i2i.payload, {
    model: 'seedream-v5-pro-i2i',
    prompt: 'change the cup to glossy red',
    images: ['https://cdn.example.com/reference.png'],
    metadata: { width: 1280, height: 960, output_format: 'jpeg' },
  });
  assert.equal('seconds' in i2i.payload, false);
});

test('seedance.nz APIMart image models follow the documented low-price and Grok payloads', async () => {
  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const fetchImpl = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/apimart-image-${uploadIndex}.png` });
  };

  const lowPrice = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-g-v2-lowprice',
    prompt: 'A product photograph',
    size: '16:9',
    resolution: '4k',
    n: 3,
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.deepEqual(lowPrice, {
    model: 'zhenzhen-image-g-v2-lowprice',
    taskType: 'i2i',
    payload: {
      model: 'zhenzhen-image-g-v2-lowprice',
      prompt: 'A product photograph',
      n: 3,
      size: '16:9',
      metadata: { resolution: '4k' },
      images: [
        'https://cdn.example.com/apimart-image-1.png',
        'https://cdn.example.com/apimart-image-2.png',
      ],
    },
  });

  const grokText = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-gk-v15',
    prompt: 'A cinematic skyline',
    size: '3:2',
    n: 2,
  }, 'test-key');
  assert.deepEqual(grokText.payload, {
    model: 'zhenzhen-image-gk-v15',
    prompt: 'A cinematic skyline',
    n: 2,
    size: '3:2',
  });

  const grokEdit = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-gk-v15-edit',
    prompt: 'Replace the sky',
    size: '16:9',
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(grokEdit.taskType, 'i2i');
  assert.deepEqual(grokEdit.payload.images, ['https://cdn.example.com/apimart-image-1.png']);

  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-gk-v15',
      prompt: 'Must stay text-to-image',
      images: [TINY_PNG_A],
    }, 'test-key', { fetchImpl, uploadIntervalMs: 0 }),
    /文生图模型，不接受参考图/,
  );
});

test('seedance.nz Image G v2.5 models keep the documented Lowprice and Official payloads distinct', async () => {
  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const fetchImpl = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/image-g25-reference-${uploadIndex}.png` });
  };

  const lowprice = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-g-v2.5-lowprice',
    prompt: 'A clean product photograph',
    resolution: '2k',
    size: '16:9',
    n: 1,
    nsfw_check: true,
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.deepEqual(lowprice, {
    model: 'zhenzhen-image-g-v2.5-lowprice',
    taskType: 'i2i',
    payload: {
      model: 'zhenzhen-image-g-v2.5-lowprice',
      prompt: 'A clean product photograph',
      n: 1,
      size: '16:9',
      resolution: '2k',
      nsfw_check: true,
      images: [
        'https://cdn.example.com/image-g25-reference-1.png',
        'https://cdn.example.com/image-g25-reference-2.png',
      ],
    },
  });
  assert.equal('quality' in lowprice.payload, false);
  assert.equal('metadata' in lowprice.payload, false);

  const flare = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-g-v2.5-flare',
    prompt: 'A precise editorial illustration',
    resolution: '4k',
    size: 'custom',
    custom_size: '1536x864',
    quality: 'high',
    n: 4,
    output_format: 'webp',
    output_compression: 82,
    background: 'transparent',
    moderation: 'auto',
    images: [TINY_PNG_A],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.deepEqual(flare.payload, {
    model: 'zhenzhen-image-g-v2.5-flare',
    prompt: 'A precise editorial illustration',
    n: 4,
    quality: 'high',
    output_format: 'webp',
    output_compression: 82,
    background: 'transparent',
    moderation: 'auto',
    size: '1536x864',
    images: ['https://cdn.example.com/image-g25-reference-1.png'],
  });
  assert.equal('resolution' in flare.payload, false);
  assert.equal(flare.taskType, 'i2i');

  const sunburst = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-g-v2.5-sunburst',
    prompt: 'Preserve the source composition',
    resolution: '1k',
    size: 'preserve_reference',
    quality: 'auto',
    n: 1,
    output_format: 'png',
    output_compression: 10,
    background: 'auto',
    moderation: 'low',
  }, 'test-key');
  assert.deepEqual(sunburst.payload, {
    model: 'zhenzhen-image-g-v2.5-sunburst',
    prompt: 'Preserve the source composition',
    n: 1,
    quality: 'auto',
    output_format: 'png',
    background: 'auto',
    moderation: 'low',
    resolution: '1k',
  });
  assert.equal('size' in sunburst.payload, false);
  assert.equal('output_compression' in sunburst.payload, false);
});

test('seedance.nz Image G v2.5 rejects undocumented counts, reference limits, and format combinations', async () => {
  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-g-v2.5-lowprice',
      prompt: 'One image only',
      n: 2,
    }, 'test-key'),
    /图片数量 n 必须是 1-1 的整数/,
  );
  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-g-v2.5-lowprice',
      prompt: 'Too many references',
      images: Array.from({ length: 16 }, () => TINY_PNG_A),
    }, 'test-key'),
    /最多支持 15 张参考图/,
  );
  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-g-v2.5-lowprice',
      prompt: 'x'.repeat(5001),
    }, 'test-key'),
    /提示词最多 5000 字符/,
  );
  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-g-v2.5-flare',
      prompt: 'Invalid custom pixels',
      size: 'custom',
      custom_size: '1025x1024',
    }, 'test-key'),
    /16 的倍数/,
  );
  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-g-v2.5-sunburst',
      prompt: 'Invalid transparency',
      output_format: 'jpeg',
      background: 'transparent',
    }, 'test-key'),
    /透明背景必须使用 png 或 webp/,
  );
});

test('seedance.nz Nano Banana models enforce their documented resolution, ratio, count, and reference contracts', async () => {
  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const fetchImpl = async () => {
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/nb-reference-${uploadIndex}.png` });
  };

  const lite = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-nb-2-lite',
    prompt: 'Four clean product variations',
    resolution: '1k',
    size: '1:8',
    n: 4,
    images: [TINY_PNG_A],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.deepEqual(lite.payload, {
    model: 'zhenzhen-image-nb-2-lite',
    prompt: 'Four clean product variations',
    n: 4,
    size: '1:8',
    metadata: { resolution: '1k' },
    images: ['https://cdn.example.com/nb-reference-1.png'],
  });

  const banana2 = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-nb-2',
    prompt: 'A wide landscape',
    resolution: '0.5k',
    size: '8:1',
  }, 'test-key');
  assert.deepEqual(banana2.payload.metadata, { resolution: '0.5k' });
  assert.equal(banana2.payload.size, '8:1');

  const pro = await seedanceNz.buildApimartImagePayload({
    model: 'zhenzhen-image-nb-pro',
    prompt: 'A premium editorial portrait',
    resolution: '4k',
    size: '4:5',
  }, 'test-key');
  assert.deepEqual(pro.payload.metadata, { resolution: '4k' });
  assert.equal(pro.payload.n, 1);

  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-nb-2-lite',
      prompt: 'Wrong resolution',
      resolution: '2k',
      size: '1:1',
    }, 'test-key'),
    /不支持分辨率 2k/,
  );
  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-nb-pro',
      prompt: 'Wrong extreme ratio',
      resolution: '1k',
      size: '1:8',
    }, 'test-key'),
    /不支持比例 1:8/,
  );
  await assert.rejects(
    seedanceNz.buildApimartImagePayload({
      model: 'zhenzhen-image-nb-2',
      prompt: 'Wrong count',
      resolution: '1k',
      size: '1:1',
      n: 2,
    }, 'test-key'),
    /图片数量 n 固定为 1/,
  );
});

test('seedance.nz APIMart video models preserve each documented duration and reference constraint', async () => {
  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const fetchImpl = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/apimart-video-ref-${uploadIndex}` });
  };

  const omni = await seedanceNz.buildApimartVideoPayload({
    model: 'zhenzhen-video-g-omni-flash',
    prompt: '',
    ratio: '9:16',
    images: [TINY_PNG_A],
    videos: [TINY_MP4],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(omni.payload.model, 'zhenzhen-video-g-omni-flash');
  assert.deepEqual(omni.payload.metadata, {
    resolution: '720p',
    ratio: '9:16',
    video_url: 'https://cdn.example.com/apimart-video-ref-2',
  });
  assert.deepEqual(omni.payload.images, ['https://cdn.example.com/apimart-video-ref-1']);
  assert.equal('seconds' in omni.payload, false);

  const grok = await seedanceNz.buildApimartVideoPayload({
    model: 'zhenzhen-video-gk-v15',
    prompt: 'A slow dolly shot',
    duration: 30,
    ratio: '2:3',
    resolution: '480p',
    images: [TINY_PNG_A],
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(grok.payload.seconds, '30');
  assert.deepEqual(grok.payload.metadata, { resolution: '480p', ratio: '2:3' });

  const veoFast = await seedanceNz.buildApimartVideoPayload({
    model: 'zhenzhen-video-v31-fast',
    prompt: 'Fast camera move',
    duration: 15,
    ratio: '16:9',
    resolution: '4K',
  }, 'test-key');
  assert.equal(veoFast.payload.seconds, '8');
  assert.deepEqual(veoFast.payload.metadata, { resolution: '4k', ratio: '16:9' });

  const veoLite = await seedanceNz.buildApimartVideoPayload({
    model: 'zhenzhen-video-v31-lite',
    prompt: 'A calm camera move through a gallery',
    duration: 30,
    ratio: '9:16',
    resolution: '1080p',
  }, 'test-key');
  assert.deepEqual(veoLite, {
    model: 'zhenzhen-video-v31-lite',
    taskType: 't2v',
    payload: {
      model: 'zhenzhen-video-v31-lite',
      prompt: 'A calm camera move through a gallery',
      seconds: '8',
      metadata: { resolution: '1080p', ratio: '9:16' },
    },
  });

  await assert.rejects(
    seedanceNz.buildApimartVideoPayload({
      model: 'zhenzhen-video-v31-quality',
      prompt: 'Quality render',
      images: [TINY_PNG_A, TINY_PNG_A, TINY_PNG_A],
    }, 'test-key', { fetchImpl, uploadIntervalMs: 0 }),
    /最多支持 2 张参考图/,
  );
  await assert.rejects(
    seedanceNz.buildApimartVideoPayload({
      model: 'zhenzhen-video-v31-lite',
      prompt: 'Text-only means no reference image',
      images: [TINY_PNG_A],
    }, 'test-key', { fetchImpl, uploadIntervalMs: 0 }),
    /仅支持文生视频，不接受参考图或参考视频/,
  );
});

test('seedance.nz Whisper uses the documented synchronous multipart transcription endpoint', async () => {
  let calledUrl = '';
  let submittedForm: FormData | null = null;
  const result = await seedanceNz.transcribeAudio({
    audioUrl: TINY_MP3,
    model: 'whisper-1',
    responseFormat: 'verbose_json',
  }, 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl: async (url: string, init?: RequestInit) => {
      calledUrl = url;
      assert.equal(init?.method, 'POST');
      assert.equal((init?.headers as Record<string, string>)?.Authorization, 'Bearer test-key');
      assert.ok(init?.body instanceof FormData);
      submittedForm = init.body as FormData;
      return jsonResponse({
        text: 'documented transcript',
        segments: [
          { start: 1.2344, end: 3.4567, text: ' first line ' },
          { start: 4, end: 3, text: 'invalid backwards segment' },
          { start: 7, end: 8.5, text: 'second\nline' },
        ],
      });
    },
  });

  assert.equal(calledUrl, 'https://api.seedance.nz/v1/audio/transcriptions');
  assert.equal(submittedForm?.get('model'), 'whisper-1');
  assert.equal(submittedForm?.get('response_format'), 'verbose_json');
  assert.equal((submittedForm?.get('file') as File)?.name, 'seedance-audio.mp3');
  assert.equal(result.text, 'documented transcript');
  assert.deepEqual(result.segments, [
    { start: 1.234, end: 3.457, text: 'first line' },
    { start: 7, end: 8.5, text: 'second line' },
  ]);

  let submittedVideoForm: FormData | null = null;
  const videoResult = await seedanceNz.transcribeAudio({
    audioUrl: TINY_MP4,
    model: 'whisper-1',
    responseFormat: 'json',
  }, 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl: async (_url: string, init?: RequestInit) => {
      submittedVideoForm = init?.body as FormData;
      return jsonResponse({ text: 'mp4 transcript' });
    },
  });
  assert.equal(
    (submittedVideoForm?.get('file') as File)?.type,
    'video/mp4',
  );
  assert.equal(
    (submittedVideoForm?.get('file') as File)?.name,
    'seedance-audio.mp4',
  );
  assert.equal(videoResult.text, 'mp4 transcript');
  assert.deepEqual(videoResult.segments, []);

  await assert.rejects(
    seedanceNz.transcribeAudio({
      audioUrl: 'data:audio/webm;base64,GkXfo0AgQoaBAULygQFC8oEE',
      model: 'whisper-1',
    }, 'test-key', { fetchImpl: async () => jsonResponse({ text: 'must not submit' }) }),
    /不支持该文件格式/,
  );
});

test('seedance.nz builds documented Zhenzhen Image G-2 t2i and i2i payloads', async () => {
  seedanceNz.resetCachesForTests();
  const t2i = await seedanceNz.buildImagePayload({
    model: 'zhenzhen-image-g2-t2i',
    prompt: 'clean product photo on a white background',
    images: ['https://assets.example.com/ignored.png'],
    resolution: '1k',
    ratio: 'adaptive',
  }, 'test-key');
  assert.deepEqual(t2i, {
    model: 'zhenzhen-image-g2-t2i',
    taskType: 't2i',
    payload: {
      model: 'zhenzhen-image-g2-t2i',
      prompt: 'clean product photo on a white background',
      metadata: { resolution: '1k' },
    },
  });

  const uploads: string[] = [];
  const i2i = await seedanceNz.buildImagePayload({
    model: 'zhenzhen-image-g2-i2i',
    prompt: 'turn this into a glossy blue app icon',
    images: [TINY_PNG_A, TINY_PNG_B],
    resolution: '1k',
    ratio: '1:1',
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async (url: string) => {
      assert.match(url, /\/v1\/files\/upload$/);
      uploads.push(url);
      return jsonResponse({ url: `https://cdn.example.com/g2-ref-${uploads.length}.png` });
    },
  });
  assert.deepEqual(i2i.payload, {
    model: 'zhenzhen-image-g2-i2i',
    prompt: 'turn this into a glossy blue app icon',
    images: [
      'https://cdn.example.com/g2-ref-1.png',
      'https://cdn.example.com/g2-ref-2.png',
    ],
    metadata: { resolution: '1k', ratio: '1:1' },
  });
  assert.equal(i2i.taskType, 'i2i');
  assert.equal(uploads.length, 2);
});

test('seedance.nz rejects undocumented Zhenzhen Image G-2 combinations before upstream submission', async () => {
  await assert.rejects(
    seedanceNz.buildImagePayload({
      model: 'zhenzhen-image-g2-i2i', prompt: 'valid prompt', resolution: '1k', images: [],
    }, 'test-key'),
    /至少需要 1 张参考图/,
  );
  await assert.rejects(
    seedanceNz.buildImagePayload({
      model: 'zhenzhen-image-g2-t2i', prompt: 'x'.repeat(20001), resolution: '1k',
    }, 'test-key'),
    /不能超过 20000 字符/,
  );
  await assert.rejects(
    seedanceNz.buildImagePayload({
      model: 'zhenzhen-image-g2-t2i', prompt: 'valid prompt', resolution: '2k',
    }, 'test-key'),
    /分辨率只能是 1k/,
  );
  await assert.rejects(
    seedanceNz.buildImagePayload({
      model: 'zhenzhen-image-g2-t2i', prompt: 'valid prompt', resolution: '1k', ratio: 'bad-ratio',
    }, 'test-key'),
    /不支持比例/,
  );
  await assert.rejects(
    seedanceNz.buildImagePayload({
      model: 'zhenzhen-image-g2-t2i', prompt: 'valid prompt', resolution: '1k', output_format: 'png',
    }, 'test-key'),
    /不支持 output_format/,
  );
});

test('seedance.nz selects the documented Dola Seedream overseas t2i and i2i models', async () => {
  seedanceNz.resetCachesForTests();
  const t2i = await seedanceNz.buildImagePayload({
    modelFamily: 'overseas',
    prompt: 'a cinematic lighthouse above a stormy sea',
    resolution: '1k',
    output_format: 'png',
  }, 'test-key');
  assert.equal(t2i.model, 'dola-seedream-5.0-pro-t2i');
  assert.equal(t2i.payload.model, 'dola-seedream-5.0-pro-t2i');

  const i2i = await seedanceNz.buildImagePayload({
    model: 'dola-seedream-5.0-pro-t2i',
    prompt: 'change the weather to a warm sunset',
    images: [TINY_PNG_A],
    resolution: '2k',
    output_format: 'jpeg',
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ url: 'https://cdn.example.com/lighthouse.png' }),
  });
  assert.equal(i2i.model, 'dola-seedream-5.0-pro-i2i');
  assert.equal(i2i.payload.model, 'dola-seedream-5.0-pro-i2i');
  assert.deepEqual(i2i.payload.images, ['https://cdn.example.com/lighthouse.png']);
});

test('seedance.nz Seedream submit and query use the documented image endpoints', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/image/generations')) {
      return jsonResponse({ id: 'image-task-123', task_id: 'image-task-123', status: 'queued' });
    }
    return jsonResponse({
      code: 'success',
      data: {
        task_id: 'image-task-123',
        status: 'SUCCESS',
        progress: '100%',
        result_url: 'https://cdn.example.com/result.png',
      },
    });
  };

  const submitted = await seedanceNz.submitImageTask({
    prompt: 'a minimal product photograph',
    resolution: '1k',
  }, 'test-key', { baseUrl: 'https://api.seedance.nz', fetchImpl });
  const queried = await seedanceNz.queryImageTask(submitted.taskId, 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl,
  });

  assert.equal(calls[0].url, 'https://api.seedance.nz/v1/image/generations');
  assert.equal(calls[1].url, 'https://api.seedance.nz/v1/image/generations/image-task-123');
  assert.equal(submitted.model, 'seedream-v5-pro-t2i');
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.imageUrl, 'https://cdn.example.com/result.png');
  assert.deepEqual(queried.imageUrls, ['https://cdn.example.com/result.png']);
});

test('seedance.nz image query preserves every returned image URL for multi-output workflows', async () => {
  const queried = await seedanceNz.queryImageTask('image-task-many', 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl: async () => jsonResponse({
      data: {
        status: 'SUCCESS',
        progress: '100%',
        result_urls: [
          'https://cdn.example.com/result-a.png',
          { image_url: 'https://cdn.example.com/result-b.png' },
        ],
      },
    }),
  });
  assert.equal(queried.imageUrl, 'https://cdn.example.com/result-a.png');
  assert.deepEqual(queried.imageUrls, [
    'https://cdn.example.com/result-a.png',
    'https://cdn.example.com/result-b.png',
  ]);
});

test('seedance.nz builds the exact Seedream layer-decomposition payload from one source image', async () => {
  seedanceNz.resetCachesForTests();
  const uploads: Array<{ url: string; init?: RequestInit }> = [];
  const built = await seedanceNz.buildSeedreamLayerDecompositionPayload({
    model: 'seedream-v5-pro-layer-decomposition',
    images: [TINY_PNG_A],
    prompt: '',
    resolution: '1.5k',
    output_format: 'png',
    n: 99,
    ratio: '16:9',
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async (url: string, init?: RequestInit) => {
      uploads.push({ url, init });
      return jsonResponse({ url: 'https://cdn.example.com/seedream-layer-source.png' });
    },
  });

  assert.equal(uploads.length, 1);
  assert.deepEqual(built, {
    model: 'seedream-v5-pro-layer-decomposition',
    taskType: 'layer-decomposition',
    payload: {
      model: 'seedream-v5-pro-layer-decomposition',
      images: ['https://cdn.example.com/seedream-layer-source.png'],
      metadata: { resolution: '1.5k', output_format: 'png' },
    },
  });
  const dolaBuilt = await seedanceNz.buildSeedreamLayerDecompositionPayload({
    model: 'dola-seedream-5.0-pro-layer-decomposition',
    images: [TINY_PNG_A],
    prompt: '',
    resolution: 'auto',
    output_format: 'png',
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ url: 'https://cdn.example.com/dola-layer-source.png' }),
  });
  assert.deepEqual(dolaBuilt, {
    model: 'dola-seedream-5.0-pro-layer-decomposition',
    taskType: 'layer-decomposition',
    payload: {
      model: 'dola-seedream-5.0-pro-layer-decomposition',
      images: ['https://cdn.example.com/dola-layer-source.png'],
      metadata: { resolution: 'auto', output_format: 'png' },
    },
  });
  await assert.rejects(
    seedanceNz.buildSeedreamLayerDecompositionPayload({
      model: 'not-a-layer-model', images: [TINY_PNG_A],
    }, 'test-key'),
    /未知 Seedream 分层模型/,
  );
  await assert.rejects(
    seedanceNz.buildSeedreamLayerDecompositionPayload({
      model: 'seedream-v5-pro-layer-decomposition', images: [],
    }, 'test-key'),
    /必须且只能提供 1 张源图/,
  );
  await assert.rejects(
    seedanceNz.buildSeedreamLayerDecompositionPayload({
      model: 'seedream-v5-pro-layer-decomposition', images: [TINY_PNG_A, TINY_PNG_B],
    }, 'test-key'),
    /必须且只能提供 1 张源图/,
  );
});

test('seedance.nz preserves the documented Seedream layer array order and duplicate entries', async () => {
  const queried = await seedanceNz.queryImageTask('seedream-layer-task', 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl: async () => jsonResponse({
      data: {
        status: 'SUCCESS',
        result_url: 'https://cdn.example.com/scalar-must-not-replace-array.png',
        data: {
          content: {
            image_url: 'https://cdn.example.com/base.png',
            image_urls: [
              'https://cdn.example.com/base.png',
              'https://cdn.example.com/layer-1.png',
              'https://cdn.example.com/layer-1.png',
              'https://cdn.example.com/layer-2.png',
            ],
          },
        },
      },
    }),
  });
  assert.deepEqual(queried.imageUrls, [
    'https://cdn.example.com/base.png',
    'https://cdn.example.com/layer-1.png',
    'https://cdn.example.com/layer-1.png',
    'https://cdn.example.com/layer-2.png',
  ]);
  assert.equal(queried.imageUrl, 'https://cdn.example.com/base.png');
});

test('seedance.nz preserves every layer from the live Provider upstream.results response shape', async () => {
  const queried = await seedanceNz.queryImageTask('seedream-layer-live-shape', 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl: async () => jsonResponse({
      data: {
        status: 'SUCCESS',
        result_url: 'https://cdn.example.com/compatibility-result.png',
        data: {
          content: { video_url: 'https://cdn.example.com/compatibility-result.png' },
          upstream: {
            response: {
              results: [
                { outputType: 'url', url: 'https://cdn.example.com/base.png' },
                { outputType: 'url', url: 'https://cdn.example.com/layer-1.png' },
                { outputType: 'url', url: 'https://cdn.example.com/layer-1.png' },
                { outputType: 'url', url: 'https://cdn.example.com/layer-2.png' },
              ],
            },
          },
        },
      },
    }),
  });
  assert.deepEqual(queried.imageUrls, [
    'https://cdn.example.com/base.png',
    'https://cdn.example.com/layer-1.png',
    'https://cdn.example.com/layer-1.png',
    'https://cdn.example.com/layer-2.png',
  ]);
});

test('seedance.nz builds all three Happy Horse payload modes without mixing Seedance fields', async () => {
  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const options = {
    uploadIntervalMs: 0,
    fetchImpl: async () => {
      uploadIndex += 1;
      return jsonResponse({ url: `https://cdn.example.com/happy-ref-${uploadIndex}.png` });
    },
  };
  const t2v = await seedanceNz.buildHappyHorsePayload({
    model: 'happyhorse-1.1-t2v',
    prompt: 'A paper horse runs through a miniature city',
    duration: 3,
    resolution: '720p',
    ratio: '16:9',
    images: ['https://assets.example.com/ignored.png'],
  }, 'test-key', options);
  assert.deepEqual(t2v.payload, {
    model: 'happyhorse-1.1-t2v',
    prompt: 'A paper horse runs through a miniature city',
    seconds: '3',
    metadata: { resolution: '720p', ratio: '16:9' },
  });

  const i2v = await seedanceNz.buildHappyHorsePayload({
    model: 'happyhorse-1.1-i2v',
    duration: 4,
    resolution: '1080p',
    ratio: 'adaptive',
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', options);
  assert.equal(i2v.taskType, 'i2v');
  assert.deepEqual(i2v.payload.images, ['https://cdn.example.com/happy-ref-1.png']);

  const r2v = await seedanceNz.buildHappyHorsePayload({
    model: 'happyhorse-1.1-r2v',
    prompt: '图1 的角色采用图2 的服装',
    duration: 15,
    resolution: '720p',
    ratio: '9:16',
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', options);
  assert.equal(r2v.taskType, 'r2v');
  assert.equal(r2v.payload.images.length, 2);
  assert.equal(r2v.payload.seconds, '15');
});

test('seedance.nz Happy Horse submit uses /v1/videos and rejects invalid limits', async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return jsonResponse({ id: 'happy-task-1', status: 'queued' });
  };
  const result = await seedanceNz.submitHappyHorseTask({
    model: 'happyhorse-1.1-t2v',
    prompt: 'A minimal live test animation',
    duration: 3,
    resolution: '720p',
    ratio: '16:9',
  }, 'test-key', { baseUrl: 'https://api.seedance.nz', fetchImpl });
  assert.equal(result.taskId, 'happy-task-1');
  assert.equal(calls[0], 'https://api.seedance.nz/v1/videos');
  await assert.rejects(
    seedanceNz.buildHappyHorsePayload({
      model: 'happyhorse-1.1-r2v', duration: 2, resolution: '4k', images: [],
    }, 'test-key'),
    /分辨率只支持 720p 或 1080p|时长只支持 3-15 秒|至少需要 1 张参考图/,
  );
});

test('seedance.nz builds documented Kling t2v, i2v and r2v payloads', async () => {
  seedanceNz.resetCachesForTests();
  const t2v = await seedanceNz.buildKlingPayload({
    model: 'kling-v3.0-std-t2v',
    prompt: 'A compact product reveal shot',
    duration: 5,
    ratio: '16:9',
    negativePrompt: '',
    images: [TINY_PNG_A],
  }, 'test-key');
  assert.deepEqual(t2v, {
    model: 'kling-v3.0-std-t2v',
    taskType: 't2v',
    payload: {
      model: 'kling-v3.0-std-t2v',
      prompt: 'A compact product reveal shot',
      seconds: '5',
      metadata: { ratio: '16:9' },
    },
  });

  let uploadIndex = 0;
  const upload = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/kling-${uploadIndex}.png` });
  };
  const i2v = await seedanceNz.buildKlingPayload({
    model: 'kling-v3.0-pro-i2v',
    prompt: 'Move from the first frame to the second',
    duration: 10,
    ratio: 'adaptive',
    negativePrompt: 'blur',
    images: [TINY_PNG_A, TINY_PNG_B, TINY_PNG_A],
  }, 'test-key', { fetchImpl: upload, uploadIntervalMs: 0 });
  assert.deepEqual(i2v.payload, {
    model: 'kling-v3.0-pro-i2v',
    prompt: 'Move from the first frame to the second',
    seconds: '10',
    metadata: { negative_prompt: 'blur' },
    images: ['https://cdn.example.com/kling-1.png', 'https://cdn.example.com/kling-2.png'],
  });

  seedanceNz.resetCachesForTests();
  uploadIndex = 0;
  const r2v = await seedanceNz.buildKlingPayload({
    model: 'kling-o3-4k-r2v',
    prompt: 'Use image1 as the product and image2 as the environment',
    duration: 5,
    ratio: '9:16',
    images: [TINY_PNG_A, TINY_PNG_B, TINY_PNG_A, TINY_PNG_B, TINY_PNG_A],
  }, 'test-key', { fetchImpl: upload, uploadIntervalMs: 0 });
  assert.equal(r2v.taskType, 'r2v');
  assert.equal(r2v.payload.images.length, 4);
  assert.deepEqual(r2v.payload.metadata, { ratio: '9:16' });
});

test('seedance.nz builds documented Kling edit payload and validates mode limits', async () => {
  seedanceNz.resetCachesForTests();
  const built = await seedanceNz.buildKlingPayload({
    model: 'kling-o3-std-edit',
    prompt: 'Turn the product red',
    duration: 5,
    videos: [TINY_MP4],
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async (url: string) => {
      assert.match(url, /\/v1\/files\/upload$/);
      return jsonResponse({ url: 'https://cdn.example.com/kling-source.mp4' });
    },
  });
  assert.deepEqual(built, {
    model: 'kling-o3-std-edit',
    taskType: 'edit',
    payload: {
      model: 'kling-o3-std-edit',
      prompt: 'Turn the product red',
      seconds: '5',
      metadata: {
        content: [{
          type: 'video_url',
          video_url: { url: 'https://cdn.example.com/kling-source.mp4' },
        }],
      },
    },
  });

  await assert.rejects(
    seedanceNz.buildKlingPayload({
      model: 'kling-v3.0-std-t2v', prompt: 'valid', duration: 6, ratio: '16:9',
    }, 'test-key'),
    /时长只支持 5 或 10 秒/,
  );
  await assert.rejects(
    seedanceNz.buildKlingPayload({
      model: 'kling-o3-std-r2v', prompt: 'valid', duration: 5, ratio: '16:9', images: [],
    }, 'test-key'),
    /至少需要 1 张参考图/,
  );
  await assert.rejects(
    seedanceNz.buildKlingPayload({
      model: 'kling-o3-pro-edit', prompt: '', duration: 5, videos: [TINY_MP4],
    }, 'test-key'),
    /视频编辑必须填写提示词/,
  );
});

test('seedance.nz submits Kling through /v1/videos', async () => {
  const calls: string[] = [];
  const submitted = await seedanceNz.submitKlingTask({
    model: 'kling-v3-turbo-std-t2v',
    prompt: 'A minimal Kling submission test',
    duration: 5,
    ratio: '16:9',
  }, 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl: async (url: string) => {
      calls.push(url);
      return jsonResponse({ id: 'kling-task-1', status: 'queued' });
    },
  });
  assert.equal(submitted.taskId, 'kling-task-1');
  assert.equal(submitted.taskType, 't2v');
  assert.deepEqual(calls, ['https://api.seedance.nz/v1/videos']);
});

test('seedance.nz builds the documented Zhenzhen Upscaler payload from exactly one MP4', async () => {
  seedanceNz.resetCachesForTests();
  const built = await seedanceNz.buildUpscalerPayload({
    model: 'zhenzhen-upscaler',
    resolution: '2k',
    videos: [TINY_MP4],
    prompt: 'must not be forwarded',
    duration: 15,
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async (url: string) => {
      assert.match(url, /\/v1\/files\/upload$/);
      return jsonResponse({ url: 'https://cdn.example.com/upscaler-source.mp4' });
    },
  });
  assert.deepEqual(built, {
    model: 'zhenzhen-upscaler',
    taskType: 'upscale',
    payload: {
      model: 'zhenzhen-upscaler',
      prompt: 'upscale',
      metadata: {
        resolution: '2k',
        content: [{
          type: 'video_url',
          video_url: { url: 'https://cdn.example.com/upscaler-source.mp4' },
        }],
      },
    },
  });

  await assert.rejects(
    seedanceNz.buildUpscalerPayload({ model: 'zhenzhen-upscaler', resolution: '8k', videos: [TINY_MP4] }, 'test-key'),
    /分辨率只支持 720p、1080p、2k 或 4k/,
  );
  await assert.rejects(
    seedanceNz.buildUpscalerPayload({ model: 'zhenzhen-upscaler', resolution: '1080p', videos: [] }, 'test-key'),
    /必须提供且只能提供 1 个 MP4/,
  );
  await assert.rejects(
    seedanceNz.buildUpscalerPayload({ model: 'zhenzhen-upscaler', resolution: '1080p', videos: [TINY_MP4, TINY_MP4] }, 'test-key'),
    /必须提供且只能提供 1 个 MP4/,
  );
});

test('seedance.nz submits Zhenzhen Upscaler through /v1/videos without seconds', async () => {
  seedanceNz.resetCachesForTests();
  const calls: Array<{ url: string; body: any }> = [];
  const submitted = await seedanceNz.submitUpscalerTask({
    model: 'zhenzhen-upscaler',
    resolution: '720p',
    videos: [TINY_MP4],
  }, 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    uploadIntervalMs: 0,
    fetchImpl: async (url: string, init: any = {}) => {
      if (url.endsWith('/v1/files/upload')) return jsonResponse({ url: 'https://cdn.example.com/source.mp4' });
      calls.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ id: 'upscaler-task-1', status: 'queued' });
    },
  });
  assert.equal(submitted.taskId, 'upscaler-task-1');
  assert.equal(submitted.taskType, 'upscale');
  assert.equal(calls[0].url, 'https://api.seedance.nz/v1/videos');
  assert.equal(Object.hasOwn(calls[0].body, 'seconds'), false);
});

test('seedance.nz builds the documented Hailuo 2.3 t2v and i2v payloads', async () => {
  seedanceNz.resetCachesForTests();
  const t2v = await seedanceNz.buildHailuoPayload({
    model: 'hailuo-2.3-t2v-standard',
    prompt: 'A compact product reveal shot',
    duration: 6,
    resolution: '768p',
    ratio: '16:9',
    images: [TINY_PNG_A],
  }, 'test-key');
  assert.deepEqual(t2v, {
    model: 'hailuo-2.3-t2v-standard',
    taskType: 't2v',
    payload: {
      model: 'hailuo-2.3-t2v-standard',
      prompt: 'A compact product reveal shot',
      seconds: '6',
      metadata: { resolution: '768p', ratio: '16:9' },
    },
  });

  const validFirstFrame = `data:image/png;base64,${(
    await sharp({ create: { width: 512, height: 512, channels: 3, background: '#65a30d' } }).png().toBuffer()
  ).toString('base64')}`;
  const i2v = await seedanceNz.buildHailuoPayload({
    model: 'hailuo-2.3-fast-pro-i2v',
    prompt: 'Gentle product motion',
    duration: 10,
    resolution: '768p',
    ratio: '9:16',
    images: [validFirstFrame, TINY_PNG_B],
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async (url: string) => {
      assert.match(url, /\/v1\/files\/upload$/);
      return jsonResponse({ url: 'https://cdn.example.com/hailuo-first.png' });
    },
  });
  assert.deepEqual(i2v, {
    model: 'hailuo-2.3-fast-pro-i2v',
    taskType: 'i2v',
    payload: {
      model: 'hailuo-2.3-fast-pro-i2v',
      prompt: 'Gentle product motion',
      seconds: '10',
      metadata: { resolution: '768p' },
      images: ['https://cdn.example.com/hailuo-first.png'],
    },
  });
});

test('seedance.nz Hailuo 2.3 validates model limits and submits through /v1/videos', async () => {
  const validFirstFrame = `data:image/png;base64,${(
    await sharp({ create: { width: 512, height: 512, channels: 3, background: '#0891b2' } }).png().toBuffer()
  ).toString('base64')}`;
  const tooSmallFrame = `data:image/png;base64,${(
    await sharp({ create: { width: 512, height: 300, channels: 3, background: '#dc2626' } }).png().toBuffer()
  ).toString('base64')}`;

  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-2.3-t2v-standard', prompt: 'Valid prompt', duration: 10, resolution: '1080p', ratio: '16:9',
    }, 'test-key'),
    /1080p 只支持 6 秒/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-2.3-i2v-standard', duration: 6, resolution: '768p', images: [tooSmallFrame],
    }, 'test-key', { uploadIntervalMs: 0, fetchImpl: async () => jsonResponse({ url: 'must-not-upload' }) }),
    /短边必须大于 300px/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-2.3-t2v-pro', prompt: 'x'.repeat(2001), duration: 6, resolution: '768p', ratio: '16:9',
    }, 'test-key'),
    /不能超过 2000 字符/,
  );

  seedanceNz.resetCachesForTests();
  const calls: string[] = [];
  const submitted = await seedanceNz.submitHailuoTask({
    model: 'hailuo-2.3-i2v-pro',
    duration: 6,
    resolution: '1080p',
    images: [validFirstFrame],
  }, 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    uploadIntervalMs: 0,
    fetchImpl: async (url: string) => {
      calls.push(url);
      return url.endsWith('/v1/files/upload')
        ? jsonResponse({ url: 'https://cdn.example.com/hailuo-submit-first.png' })
        : jsonResponse({ id: 'hailuo-task-1', status: 'queued' });
    },
  });
  assert.equal(submitted.taskId, 'hailuo-task-1');
  assert.deepEqual(calls, [
    'https://api.seedance.nz/v1/files/upload',
    'https://api.seedance.nz/v1/videos',
  ]);
});

test('seedance.nz builds the documented Hailuo H3 t2v, first/last-frame i2v and multimodal payloads', async () => {
  seedanceNz.resetCachesForTests();
  const default768p = await seedanceNz.buildHailuoPayload({
    model: 'hailuo-h3-t2v',
    prompt: 'A paper kite crosses a clear sky',
    duration: 5,
    ratio: '16:9',
  }, 'test-key');
  assert.equal(default768p.payload.metadata.resolution, '768P');

  const t2v = await seedanceNz.buildHailuoPayload({
    model: 'hailuo-h3-t2v',
    prompt: 'A warm paper lantern floats through a quiet night market',
    duration: 5,
    resolution: '2K',
    ratio: 'adaptive',
    images: [TINY_PNG_A],
  }, 'test-key');
  assert.deepEqual(t2v, {
    model: 'hailuo-h3-t2v',
    taskType: 't2v',
    payload: {
      model: 'hailuo-h3-t2v',
      prompt: 'A warm paper lantern floats through a quiet night market',
      seconds: '5',
      metadata: { resolution: '2K', ratio: 'adaptive' },
    },
  });

  let uploadIndex = 0;
  const uploadFetch = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/hailuo-h3-ref-${uploadIndex}` });
  };
  const i2v = await seedanceNz.buildHailuoPayload({
    model: 'hailuo-h3-i2v',
    prompt: 'The lantern slowly brightens',
    duration: 15,
    resolution: '2k',
    ratio: '9:16',
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', { uploadIntervalMs: 0, fetchImpl: uploadFetch });
  assert.deepEqual(i2v, {
    model: 'hailuo-h3-i2v',
    taskType: 'i2v',
    payload: {
      model: 'hailuo-h3-i2v',
      prompt: 'The lantern slowly brightens',
      seconds: '15',
      metadata: { resolution: '2K' },
      images: [
        'https://cdn.example.com/hailuo-h3-ref-1',
        'https://cdn.example.com/hailuo-h3-ref-2',
      ],
    },
  });

  seedanceNz.resetCachesForTests();
  const multi = await seedanceNz.buildHailuoPayload({
    model: 'hailuo-h3-multi',
    prompt: '@Image 1 follows the rhythm of @Audio 1 while matching @Video 1',
    duration: 9,
    resolution: '2K',
    ratio: '16:9',
    images: [TINY_PNG_A],
    videos: ['data:video/mp4;base64,AAAA'],
    audios: ['data:audio/wav;base64,AAAA'],
  }, 'test-key', { uploadIntervalMs: 0, fetchImpl: uploadFetch });
  assert.deepEqual(multi, {
    model: 'hailuo-h3-multi',
    taskType: 'multi',
    payload: {
      model: 'hailuo-h3-multi',
      prompt: '@Image 1 follows the rhythm of @Audio 1 while matching @Video 1',
      seconds: '9',
      metadata: {
        resolution: '2K',
        ratio: '16:9',
        video_url: ['https://cdn.example.com/hailuo-h3-ref-4'],
        audio_url: ['https://cdn.example.com/hailuo-h3-ref-5'],
      },
      images: ['https://cdn.example.com/hailuo-h3-ref-3'],
    },
  });
});

test('seedance.nz Hailuo H3 rejects invalid duration, resolution and missing or excessive references', async () => {
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-h3-t2v', prompt: 'Valid prompt', duration: 4, resolution: '2K', ratio: '16:9',
    }, 'test-key'),
    /5-15 秒/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-h3-t2v', prompt: 'Valid prompt', duration: 5, resolution: '1080p', ratio: '16:9',
    }, 'test-key'),
    /只支持 768P 或 2K/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-h3-i2v', duration: 5, resolution: '2K', images: [],
    }, 'test-key'),
    /必须提供第 1 张首帧图/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-h3-i2v',
      duration: 5,
      resolution: '2K',
      images: [TINY_PNG_A, TINY_PNG_B, `${TINY_PNG_A}A`],
    }, 'test-key'),
    /最多支持 2 张/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'hailuo-h3-multi', prompt: 'Valid prompt', duration: 5, resolution: '2K',
    }, 'test-key'),
    /至少需要 1 个图片、视频或音频素材/,
  );
});

test('seedance.nz builds all documented Qwen Image 3.0 payload modes without cross-contaminating size fields', async () => {
  assert.deepEqual([...seedanceNz.QWEN_IMAGE_30_MODELS], [
    'qwen-image-3.0-t2i',
    'qwen-image-3.0-i2i',
    'qwen-image-3.0-pro-t2i',
    'qwen-image-3.0-pro-i2i',
    'qwen-image-3.0-global-t2i',
    'qwen-image-3.0-global-i2i',
    'qwen-image-3.0-global-pro-t2i',
    'qwen-image-3.0-global-pro-i2i',
  ]);

  const common = {
    model: 'qwen-image-3.0-t2i',
    prompt: 'a clean product photograph in a daylight studio',
    negative_prompt: 'blur',
    prompt_extend: true,
    n: 2,
    seed: 9,
  };
  const auto = await seedanceNz.buildQwenImage30Payload({ ...common, sizing_mode: 'auto' }, 'test-key');
  assert.deepEqual(auto.payload, {
    model: 'qwen-image-3.0-t2i',
    prompt: common.prompt,
    negative_prompt: 'blur',
    prompt_extend: true,
    n: 2,
    metadata: { seed: 9 },
  });

  const ratio = await seedanceNz.buildQwenImage30Payload({
    ...common, sizing_mode: 'ratio', ratio: '16:9', resolution: '2k',
  }, 'test-key');
  assert.deepEqual(ratio.payload.metadata, { seed: 9, ratio: '16:9', resolution: '2k' });
  assert.equal('size' in ratio.payload, false);

  const custom = await seedanceNz.buildQwenImage30Payload({
    ...common, sizing_mode: 'custom_size', size: '1024x1536', seed: -1,
  }, 'test-key');
  assert.equal(custom.payload.size, '1024*1536');
  assert.equal('metadata' in custom.payload, false);

  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const i2i = await seedanceNz.buildQwenImage30Payload({
    model: 'qwen-image-3.0-global-pro-i2i',
    prompt: 'edit these references into a coherent cinematic key visual',
    sizing_mode: 'auto',
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ url: `https://cdn.example.com/qwen-${++uploadIndex}.png` }),
  });
  assert.equal(i2i.taskType, 'i2i');
  assert.deepEqual(i2i.payload.images, [
    'https://cdn.example.com/qwen-1.png',
    'https://cdn.example.com/qwen-2.png',
  ]);
});

test('seedance.nz rejects undocumented Qwen Image 3.0 combinations before submission', async () => {
  await assert.rejects(
    seedanceNz.buildQwenImage30Payload({ model: 'qwen-image-3.0-t2i', prompt: 'tiny' }, 'test-key'),
    /5-2000/,
  );
  await assert.rejects(
    seedanceNz.buildQwenImage30Payload({
      model: 'qwen-image-3.0-i2i', prompt: 'valid edit prompt', sizing_mode: 'auto', images: [],
    }, 'test-key'),
    /需要 1-3 张参考图/,
  );
  await assert.rejects(
    seedanceNz.buildQwenImage30Payload({
      model: 'qwen-image-3.0-t2i', prompt: 'valid image prompt', sizing_mode: 'custom_size', size: 'bad-size',
    }, 'test-key'),
    /W\*H/,
  );
});

test('seedance.nz image query preserves the documented upstream failure reason without exposing result URLs', async () => {
  const result = await seedanceNz.queryImageTask('qwen-failed-task', 'test-key', {
    fetchImpl: async () => jsonResponse({
      code: 'success',
      data: {
        status: 'FAILURE',
        progress: '100%',
        fail_reason: 'Model is currently busy, please retry later',
        result_url: 'Model is currently busy, please retry later',
      },
    }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.failReason, 'Model is currently busy, please retry later');
  assert.equal(result.imageUrl, null);
  assert.deepEqual(result.imageUrls, []);
});

test('seedance.nz builds all documented MiniMax H3 OW standard and Fast payloads', async () => {
  assert.deepEqual([...seedanceNz.MINIMAX_H3_OW_MODELS], [
    'minimax-h3-ow-t2v',
    'minimax-h3-ow-r2v',
    'minimax-h3-ow-i2v',
    'minimax-h3-ow-i2v-fast',
    'minimax-h3-ow-r2v-fast',
    'minimax-h3-ow-ref2va-audio-drive-fast',
    'minimax-h3-ow-fl2va-audio-drive-fast',
    'minimax-h3-ow-t2v-fast',
  ]);
  const t2v = await seedanceNz.buildHailuoPayload({
    model: 'minimax-h3-ow-t2v',
    prompt: 'a slow cinematic dolly through a quiet white gallery',
    duration: 5,
    resolution: '480p',
    ratio: '16:9',
  }, 'test-key');
  assert.deepEqual(t2v, {
    model: 'minimax-h3-ow-t2v',
    taskType: 't2v',
    payload: {
      model: 'minimax-h3-ow-t2v',
      prompt: 'a slow cinematic dolly through a quiet white gallery',
      seconds: '5',
      metadata: { resolution: '480p', ratio: '16:9' },
    },
  });

  for (const model of ['minimax-h3-ow-r2v', 'minimax-h3-ow-i2v']) {
    seedanceNz.resetCachesForTests();
    const built = await seedanceNz.buildHailuoPayload({
      model,
      prompt: model.endsWith('i2v') ? '' : 'preserve the reference character identity',
      duration: 15,
      resolution: '720p',
      ratio: '9:16',
      images: [TINY_PNG_A],
    }, 'test-key', {
      uploadIntervalMs: 0,
      fetchImpl: async () => jsonResponse({ url: 'https://cdn.example.com/minimax-reference.png' }),
    });
    assert.equal(built.taskType, model.endsWith('r2v') ? 'r2v' : 'i2v');
    assert.deepEqual(built.payload.images, ['https://cdn.example.com/minimax-reference.png']);
    assert.deepEqual(built.payload.metadata, { resolution: '720p', ratio: '9:16' });
  }

  seedanceNz.resetCachesForTests();
  let uploadIndex = 0;
  const fastR2v = await seedanceNz.buildHailuoPayload({
    model: 'minimax-h3-ow-r2v-fast',
    prompt: 'preserve all ordered reference identities',
    duration: 10,
    resolution: '480p',
    ratio: '21:9',
    images: [TINY_PNG_A, TINY_PNG_B, `${TINY_PNG_A}A`],
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async () => {
      uploadIndex += 1;
      return jsonResponse({ url: `https://cdn.example.com/minimax-fast-${uploadIndex}.png` });
    },
  });
  assert.deepEqual(fastR2v, {
    model: 'minimax-h3-ow-r2v-fast',
    taskType: 'r2v',
    payload: {
      model: 'minimax-h3-ow-r2v-fast',
      prompt: 'preserve all ordered reference identities',
      seconds: '10',
      metadata: { resolution: '480p', ratio: '21:9' },
      images: [
        'https://cdn.example.com/minimax-fast-1.png',
        'https://cdn.example.com/minimax-fast-2.png',
        'https://cdn.example.com/minimax-fast-3.png',
      ],
    },
  });

  seedanceNz.resetCachesForTests();
  const fastI2v = await seedanceNz.buildHailuoPayload({
    model: 'minimax-h3-ow-i2v-fast',
    duration: 5,
    resolution: '720p',
    ratio: '16:9',
    images: [TINY_PNG_A],
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ url: 'https://cdn.example.com/minimax-fast-first.png' }),
  });
  assert.equal(fastI2v.taskType, 'i2v');
  assert.equal(Object.hasOwn(fastI2v.payload, 'prompt'), false);
  assert.deepEqual(fastI2v.payload.images, ['https://cdn.example.com/minimax-fast-first.png']);

  const fastT2v = await seedanceNz.buildHailuoPayload({
    model: 'minimax-h3-ow-t2v-fast',
    prompt: 'a paper kite floats through warm sunset light',
    duration: 5,
    resolution: '480p',
    ratio: '16:9',
  }, 'test-key');
  assert.equal(fastT2v.taskType, 't2v');
  assert.equal(Object.hasOwn(fastT2v.payload, 'images'), false);

  for (const model of [
    'minimax-h3-ow-ref2va-audio-drive-fast',
    'minimax-h3-ow-fl2va-audio-drive-fast',
  ]) {
    seedanceNz.resetCachesForTests();
    let mediaUpload = 0;
    const built = await seedanceNz.buildHailuoPayload({
      model,
      prompt: '',
      duration: 10,
      resolution: '720p',
      ratio: '9:16',
      images: [TINY_PNG_A],
      audios: [TINY_MP3],
    }, 'test-key', {
      uploadIntervalMs: 0,
      fetchImpl: async () => {
        mediaUpload += 1;
        return jsonResponse({ url: `https://cdn.example.com/audio-drive-${mediaUpload}` });
      },
    });
    assert.equal(built.taskType, 'multi');
    assert.equal(Object.hasOwn(built.payload, 'prompt'), false);
    assert.deepEqual(built.payload.images, ['https://cdn.example.com/audio-drive-1']);
    assert.deepEqual(built.payload.metadata, {
      resolution: '720p',
      ratio: '9:16',
      audio_urls: ['https://cdn.example.com/audio-drive-2'],
    });
  }
});

test('seedance.nz validates MiniMax H3 OW prompt, image, seconds, resolution and ratio', async () => {
  await assert.rejects(
    seedanceNz.buildHailuoPayload({ model: 'minimax-h3-ow-r2v', duration: 5, resolution: '480p', ratio: '16:9' }, 'test-key'),
    /必须填写提示词/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'minimax-h3-ow-i2v', duration: 5, resolution: '480p', ratio: '16:9', images: [],
    }, 'test-key'),
    /必须且只能提供 1 张首帧图/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'minimax-h3-ow-i2v-fast', duration: 5, resolution: '480p', ratio: '16:9', images: [TINY_PNG_A, TINY_PNG_B],
    }, 'test-key'),
    /必须且只能提供 1 张首帧图/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'minimax-h3-ow-r2v-fast', prompt: 'valid prompt', duration: 5, resolution: '480p', ratio: '16:9',
      images: Array.from({ length: 10 }, () => TINY_PNG_A),
    }, 'test-key'),
    /必须提供 1-9 张参考图/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'minimax-h3-ow-r2v-fast', prompt: 'valid prompt', duration: 5, resolution: '480p', ratio: '16:9',
      images: [TINY_PNG_A], videos: ['data:video/mp4;base64,AAAA'],
    }, 'test-key'),
    /不接受视频或音频素材/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'minimax-h3-ow-ref2va-audio-drive-fast', duration: 5, resolution: '480p', ratio: '16:9',
      images: [TINY_PNG_A], audios: [],
    }, 'test-key'),
    /必须且只能提供 1 段音频/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'minimax-h3-ow-t2v-fast', prompt: 'valid prompt', duration: 5, resolution: '480p', ratio: '16:9',
      images: [TINY_PNG_A],
    }, 'test-key'),
    /文生视频不接受图片、视频或音频素材/,
  );
  await assert.rejects(
    seedanceNz.buildHailuoPayload({
      model: 'minimax-h3-ow-t2v', prompt: 'valid prompt', duration: 6, resolution: '1080p', ratio: 'adaptive',
    }, 'test-key'),
    /时长只支持 5、10 或 15 秒/,
  );
});

test('seedance.nz builds documented Vidu Q3 t2v, i2v, start-end and r2v payloads', async () => {
  seedanceNz.resetCachesForTests();
  const t2v = await seedanceNz.buildViduPayload({
    model: 'vidu-q3-turbo-t2v',
    prompt: 'A paper bird takes flight in a clean studio',
    duration: 4,
    ratio: '16:9',
    resolution: 'default',
    seed: -1,
    images: [TINY_PNG_A],
  }, 'test-key');
  assert.deepEqual(t2v, {
    model: 'vidu-q3-turbo-t2v',
    taskType: 't2v',
    payload: {
      model: 'vidu-q3-turbo-t2v',
      prompt: 'A paper bird takes flight in a clean studio',
      seconds: '4',
      metadata: { ratio: '16:9' },
    },
  });

  let uploadIndex = 0;
  const upload = async (url: string) => {
    assert.match(url, /\/v1\/files\/upload$/);
    uploadIndex += 1;
    return jsonResponse({ url: `https://cdn.example.com/vidu-${uploadIndex}.png` });
  };
  const i2v = await seedanceNz.buildViduPayload({
    model: 'vidu-q3-pro-i2v',
    duration: 5,
    ratio: 'adaptive',
    resolution: '720p',
    seed: 7,
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', { fetchImpl: upload, uploadIntervalMs: 0 });
  assert.deepEqual(i2v.payload, {
    model: 'vidu-q3-pro-i2v',
    seconds: '5',
    metadata: { resolution: '720p', seed: 7 },
    images: ['https://cdn.example.com/vidu-1.png'],
  });

  seedanceNz.resetCachesForTests();
  uploadIndex = 0;
  const startEnd = await seedanceNz.buildViduPayload({
    model: 'vidu-q3-pro-fast-start-end',
    prompt: 'Move smoothly from the first composition to the second',
    duration: 6,
    ratio: '9:16',
    resolution: '1080p',
    images: [TINY_PNG_A, TINY_PNG_B],
  }, 'test-key', { fetchImpl: upload, uploadIntervalMs: 0 });
  assert.equal(startEnd.taskType, 'start-end');
  assert.deepEqual(startEnd.payload.images, [
    'https://cdn.example.com/vidu-1.png',
    'https://cdn.example.com/vidu-2.png',
  ]);
  assert.deepEqual(startEnd.payload.metadata, { ratio: '9:16', resolution: '1080p' });

  seedanceNz.resetCachesForTests();
  uploadIndex = 0;
  const r2v = await seedanceNz.buildViduPayload({
    model: 'vidu-q3-drama-r2v',
    duration: 4,
    ratio: 'adaptive',
    resolution: 'default',
    images: Array.from({ length: 10 }, (_, index) => index % 2 ? TINY_PNG_A : TINY_PNG_B),
  }, 'test-key', { fetchImpl: upload, uploadIntervalMs: 0 });
  assert.equal(r2v.taskType, 'r2v');
  assert.equal(r2v.payload.images.length, 9);
  assert.deepEqual(r2v.payload.metadata, {});
});

test('seedance.nz builds the documented Vidu Q3 short-play payload', async () => {
  seedanceNz.resetCachesForTests();
  const built = await seedanceNz.buildViduPayload({
    model: 'vidu-q3-drama-short-play',
    prompt: 'Scene one: a designer presents a small ceramic bird in a quiet studio.',
    scriptName: 'Studio intro',
    duration: 8,
    ratio: '9:16',
    resolution: '1080p',
    style: 'realistic',
    assetType: 'character',
    assetNamePrefix: 'Hero',
    assetDescription: 'Designer in a clean studio',
    images: [TINY_PNG_A],
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ url: 'https://cdn.example.com/vidu-asset.png' }),
  });
  assert.deepEqual(built, {
    model: 'vidu-q3-drama-short-play',
    taskType: 'short-play',
    payload: {
      model: 'vidu-q3-drama-short-play',
      prompt: 'Scene one: a designer presents a small ceramic bird in a quiet studio.',
      metadata: {
        script_name: 'Studio intro',
        resolution: '1080p',
        duration: 8,
        aspect_ratio: '9:16',
        style: 'realistic',
        assets: [{
          id: '1',
          type: 'character',
          name: 'Hero 1',
          image_uri: 'https://cdn.example.com/vidu-asset.png',
          description: 'Designer in a clean studio',
        }],
      },
    },
  });
});

test('seedance.nz Vidu Q3 validates mode limits and submits through /v1/videos', async () => {
  await assert.rejects(
    seedanceNz.buildViduPayload({
      model: 'vidu-q3-pro-t2v', prompt: 'valid', duration: 3, ratio: '16:9', resolution: '720p',
    }, 'test-key'),
    /时长只支持 4-15 秒/,
  );
  await assert.rejects(
    seedanceNz.buildViduPayload({
      model: 'vidu-q3-turbo-start-end', duration: 4, ratio: '16:9', resolution: 'default', images: [TINY_PNG_A],
    }, 'test-key'),
    /必须提供第 1 张和第 2 张图片/,
  );
  await assert.rejects(
    seedanceNz.buildViduPayload({
      model: 'vidu-q3-ad-short-play', prompt: 'valid script', scriptName: '', duration: 8, ratio: '9:16', resolution: '1080p', images: [TINY_PNG_A],
    }, 'test-key'),
    /必须填写脚本名称/,
  );

  const calls: string[] = [];
  const submitted = await seedanceNz.submitViduTask({
    model: 'vidu-q3-pro-fast-t2v',
    prompt: 'A minimal Vidu submission test',
    duration: 4,
    ratio: '16:9',
    resolution: 'default',
  }, 'test-key', {
    baseUrl: 'https://api.seedance.nz',
    fetchImpl: async (url: string) => {
      calls.push(url);
      return jsonResponse({ id: 'vidu-task-1', status: 'queued' });
    },
  });
  assert.equal(submitted.taskId, 'vidu-task-1');
  assert.deepEqual(calls, ['https://api.seedance.nz/v1/videos']);
});

test('seedance.nz builds and submits the documented Wan 2.7 Spicy i2v payload', async () => {
  seedanceNz.resetCachesForTests();
  let buildUploadIndex = 0;
  const built = await seedanceNz.buildWanPayload({
    model: 'wan-2.7-spicy-i2v',
    prompt: 'the character turns toward the camera',
    duration: 2,
    resolution: '1080p',
    images: [TINY_PNG_A, TINY_PNG_B],
    negativePrompt: 'blurry, distorted hands',
    audioUrl: TINY_MP3,
    promptExtend: true,
    seed: 42,
  }, 'test-key', {
    uploadIntervalMs: 0,
    fetchImpl: async () => {
      buildUploadIndex += 1;
      return jsonResponse({
        url: buildUploadIndex === 1
          ? 'https://cdn.example.com/music.mp3'
          : 'https://cdn.example.com/first.png',
      });
    },
  });
  assert.deepEqual(built.payload, {
    model: 'wan-2.7-spicy-i2v',
    prompt: 'the character turns toward the camera',
    seconds: '2',
    images: ['https://cdn.example.com/first.png'],
    metadata: {
      resolution: '1080p',
      negative_prompt: 'blurry, distorted hands',
      audio_url: 'https://cdn.example.com/music.mp3',
      prompt_extend: true,
      seed: 42,
    },
  });

  seedanceNz.resetCachesForTests();
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (url.endsWith('/v1/files/upload')) {
      return jsonResponse({ url: 'https://cdn.example.com/submitted-first.png' });
    }
    return jsonResponse({ id: 'wan-task-1', status: 'queued' });
  };
  const submitted = await seedanceNz.submitWanTask({
    model: 'wan-2.7-spicy-i2v',
    duration: 15,
    resolution: '720p',
    images: [TINY_PNG_A],
  }, 'test-key', { baseUrl: 'https://api.seedance.nz', fetchImpl, uploadIntervalMs: 0 });
  assert.equal(submitted.taskId, 'wan-task-1');
  assert.deepEqual(calls, [
    'https://api.seedance.nz/v1/files/upload',
    'https://api.seedance.nz/v1/videos',
  ]);

  await assert.rejects(
    seedanceNz.buildWanPayload({
      model: 'wan-2.7-spicy-i2v', duration: 1, resolution: '4k', images: [],
    }, 'test-key'),
    /必须提供 1 张首帧图|时长只支持 2-15 秒|分辨率只支持 720p 或 1080p/,
  );
});

test('seedance.nz builds Seed Audio payload and enforces mutually exclusive references', async () => {
  const built = await seedanceNz.buildAudioPayload({
    model: 'doubao-seed-audio-1.0',
    prompt: 'gentle rain falling on a quiet city street at night',
    speaker: 'zh_male_shaonianzixin_uranus_bigtts',
    outputFormat: 'mp3',
    sampleRate: '24000',
    speechRate: 10,
    loudnessRate: -5,
    pitchRate: 2,
  }, 'test-key');
  assert.deepEqual(built.payload, {
    model: 'doubao-seed-audio-1.0',
    prompt: 'gentle rain falling on a quiet city street at night',
    metadata: {
      format: 'mp3', sample_rate: '24000', speech_rate: 10, loudness_rate: -5, pitch_rate: 2,
      speaker: 'zh_male_shaonianzixin_uranus_bigtts',
    },
  });
  await assert.rejects(
    seedanceNz.buildAudioPayload({
      prompt: 'valid audio prompt',
      speaker: 'voice-id',
      images: ['https://assets.example.com/ref.png'],
    }, 'test-key'),
    /只能选择一种/,
  );
});

test('seedance.nz Seed Audio submit and query use documented async audio endpoints', async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (url.endsWith('/v1/audio/generations')) {
      return jsonResponse({ id: 'audio-task-1', task_id: 'audio-task-1', status: 'queued' });
    }
    return jsonResponse({
      code: 'success',
      data: {
        task_id: 'audio-task-1', status: 'SUCCESS', progress: '100%',
        result_url: 'https://cdn.example.com/output.wav',
      },
    });
  };
  const submitted = await seedanceNz.submitAudioTask({
    prompt: 'soft analog synth pads with no vocals',
    outputFormat: 'wav',
    sampleRate: '24000',
  }, 'test-key', { baseUrl: 'https://api.seedance.nz', fetchImpl });
  const queried = await seedanceNz.queryAudioTask(submitted.taskId, 'test-key', {
    baseUrl: 'https://api.seedance.nz', fetchImpl,
  });
  assert.deepEqual(calls, [
    'https://api.seedance.nz/v1/audio/generations',
    'https://api.seedance.nz/v1/audio/generations/audio-task-1',
  ]);
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.audioUrl, 'https://cdn.example.com/output.wav');
});

function minimalVideoRequest() {
  return {
    model: 'mini',
    prompt: 'bounded provider response test',
    duration: 4,
    ratio: '16:9',
    resolution: '480p',
  };
}

async function capturedRejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
  assert.fail('expected promise to reject');
}

test('seedance.nz never reflects plain-text or JSON upstream secrets in errors', async () => {
  const apiKey = 'provider-json-key-should-never-leak';
  const plainSecret = 'provider-plain-secret-should-never-leak';
  const plainError = await capturedRejection(seedanceNz.submitTask(
    minimalVideoRequest(),
    apiKey,
    {
      fetchImpl: async () => new Response(plainSecret, {
        status: 502,
        headers: { 'x-request-id': 'req-plain-safe' },
      }),
    },
  ));

  assert.equal(plainError.code, 'SEEDANCE_UPSTREAM_ERROR');
  assert.equal(plainError.status, 502);
  assert.equal(plainError.requestId, 'req-plain-safe');
  assert.match(String(plainError.bodyDigest), /^sha256:[a-f0-9]{16}$/);
  assert.doesNotMatch(`${plainError.message} ${JSON.stringify(plainError)}`, new RegExp(plainSecret));

  const jsonError = await capturedRejection(seedanceNz.submitTask(
    minimalVideoRequest(),
    apiKey,
    {
      fetchImpl: async () => jsonResponse({
        code: 'RATE_LIMITED',
        request_id: 'req-json-safe',
        error: { message: `Invalid API key: ${apiKey}` },
      }, 429),
    },
  ));

  assert.equal(jsonError.code, 'SEEDANCE_UPSTREAM_ERROR');
  assert.equal(jsonError.upstreamCode, 'RATE_LIMITED');
  assert.equal(jsonError.status, 429);
  assert.equal(jsonError.requestId, 'req-json-safe');
  assert.doesNotMatch(`${jsonError.message} ${JSON.stringify(jsonError)}`, new RegExp(apiKey));
});

test('seedance.nz failed task normalization omits raw provider messages and secrets', async () => {
  const secret = 'failed-task-provider-secret';
  const result = await seedanceNz.queryTask('task-safe', 'test-key', {
    fetchImpl: async () => jsonResponse({
      status: 'failed',
      progress: `50% ${secret}`,
      error: { message: `generation failed with ${secret}` },
      request_id: 'req-failed-safe',
    }),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.failReason, 'Seedance 任务失败');
  assert.equal(result.progress, '');
  assert.equal(result.requestId, 'req-failed-safe');
  assert.equal('raw' in result, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test('seedance.nz rejects oversized provider bodies before accumulation and cancels the stream', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":"task-that-is-too-large"}'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const error = await capturedRejection(seedanceNz.submitTask(
    minimalVideoRequest(),
    'test-key',
    {
      providerMaxResponseBytes: 16,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'Content-Length': '31' },
      }),
    },
  ));

  assert.equal(error.code, 'SEEDANCE_RESPONSE_TOO_LARGE');
  assert.equal(error.status, 502);
  assert.equal(error.maxBytes, 16);
  assert.equal(cancelled, true);
});

test('seedance.nz accepts transparently decoded compressed JSON but bounds decoded bytes', async () => {
  const decoded = JSON.stringify({ id: 'compressed-task' });
  const submitted = await seedanceNz.submitTask(minimalVideoRequest(), 'test-key', {
    providerMaxResponseBytes: 64,
    fetchImpl: async () => new Response(decoded, {
      status: 200,
      headers: {
        'Content-Encoding': 'gzip',
        'Content-Length': '9',
      },
    }),
  });
  assert.equal(submitted.taskId, 'compressed-task');

  const oversized = await capturedRejection(seedanceNz.submitTask(minimalVideoRequest(), 'test-key', {
    providerMaxResponseBytes: 16,
    fetchImpl: async () => new Response(decoded, {
      status: 200,
      headers: {
        'Content-Encoding': 'br',
        'Content-Length': '5',
      },
    }),
  }));
  assert.equal(oversized.code, 'SEEDANCE_RESPONSE_TOO_LARGE');
  assert.equal(oversized.maxBytes, 16);
});

test('seedance.nz enforces idle timeout while streaming and cancels the provider body', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const startedAt = Date.now();
  const error = await capturedRejection(seedanceNz.submitTask(
    minimalVideoRequest(),
    'test-key',
    {
      providerDeadlineMs: 250,
      providerIdleTimeoutMs: 25,
      allowShortProviderTimeoutsForTests: true,
      fetchImpl: async () => new Response(body, { status: 200 }),
    },
  ));

  assert.equal(error.code, 'SEEDANCE_UPSTREAM_TIMEOUT');
  assert.equal(error.status, 504);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - startedAt < 500);
});

test('seedance.nz bounds response-header wait even when fetch ignores AbortSignal', async () => {
  let signal: AbortSignal | undefined;
  const startedAt = Date.now();
  const error = await capturedRejection(seedanceNz.submitTask(
    minimalVideoRequest(),
    'test-key',
    {
      providerDeadlineMs: 30,
      allowShortProviderTimeoutsForTests: true,
      fetchImpl: async (_url: string, init?: RequestInit) => {
        signal = init?.signal || undefined;
        return await new Promise<Response>(() => {});
      },
    },
  ));

  assert.equal(error.code, 'SEEDANCE_UPSTREAM_TIMEOUT');
  assert.equal(error.status, 504);
  assert.equal(signal?.aborted, true);
  assert.ok(Date.now() - startedAt < 500);
});

test('seedance.nz gives Provider calls and media uploads the shared 15-minute floor by default', () => {
  const source = readFileSync(
    new URL('../backend/src/providers/seedanceNz.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /DEFAULT_PROVIDER_DEADLINE_MS\s*=\s*MIN_PROVIDER_MEDIA_TIMEOUT_MS/);
  assert.match(source, /DEFAULT_PROVIDER_UPLOAD_DEADLINE_MS\s*=\s*MIN_PROVIDER_MEDIA_TIMEOUT_MS/);
  assert.match(source, /DEFAULT_PROVIDER_UPLOAD_IDLE_TIMEOUT_MS\s*=\s*MIN_PROVIDER_MEDIA_TIMEOUT_MS/);
  assert.match(source, /providerUploadDeadlineMs\s*\?\?\s*options\.providerDeadlineMs/);
  assert.match(source, /providerUploadIdleTimeoutMs\s*\?\?\s*options\.providerIdleTimeoutMs/);
});

test('seedance.nz never replays an upload whose timeout leaves acceptance ambiguous', async () => {
  seedanceNz.resetCachesForTests();
  let providerCalls = 0;
  let signal: AbortSignal | undefined;
  const startedAt = Date.now();
  const error = await capturedRejection(seedanceNz.uploadMedia(
    TINY_PNG_A,
    'image',
    'test-key',
    {
      uploadIntervalMs: 0,
      providerDeadlineMs: 10,
      providerUploadDeadlineMs: 45,
      allowShortProviderTimeoutsForTests: true,
      fetchImpl: async (_url: string, init?: RequestInit) => {
        providerCalls += 1;
        signal = init?.signal || undefined;
        return await new Promise<Response>(() => {});
      },
    },
  ));

  assert.equal(error.code, 'SEEDANCE_UPSTREAM_TIMEOUT');
  assert.equal(error.status, 504);
  assert.equal(providerCalls, 1, 'ambiguous media uploads must not be replayed');
  assert.equal(signal?.aborted, true);
  assert.ok(Date.now() - startedAt >= 35, 'the upload-specific boundary must override the generic Provider value');
  assert.ok(Date.now() - startedAt < 500);
});

test('seedance.nz localizes remote media before Provider upload', async (t) => {
  seedanceNz.resetCachesForTests();
  let originCalls = 0;
  let providerCalls = 0;
  const server = await listen((_req, res) => {
    originCalls += 1;
    const body = Buffer.from('tiny-png');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(body.length) });
    res.end(body);
  });
  t.after(() => closeServer(server));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const source = `http://127.0.0.1:${address.port}/reference.png`;
  const result = await seedanceNz.uploadMedia(source, 'image', 'test-key', {
    maxBytes: 64,
    uploadIntervalMs: 0,
    allowPrivateForTests: (hostname: string) => hostname === '127.0.0.1',
    fetchImpl: async (url: string, init?: RequestInit) => {
      providerCalls += 1;
      assert.match(url, /\/v1\/files\/upload$/);
      assert.ok(init?.body instanceof FormData);
      return jsonResponse({ url: 'https://cdn.example.com/localized-reference.png' });
    },
  });

  assert.equal(result, 'https://cdn.example.com/localized-reference.png');
  assert.equal(originCalls, 1);
  assert.equal(providerCalls, 1);
  assert.notEqual(result, source);
});

test('seedance.nz rejects metadata, special-range IPv4, IPv6 local and credentialed media URLs before Provider upload', async () => {
  seedanceNz.resetCachesForTests();
  let providerCalls = 0;
  const blocked = [
    'http://169.254.169.254/latest/meta-data',
    'http://0.1.2.3/private.png',
    'http://100.64.0.1/private.png',
    'http://[fc00::1]/private.png',
    'http://[fe80::1]/private.png',
    'http://user:credential-secret@8.8.8.8/private.png',
  ];
  for (const source of blocked) {
    const error = await capturedRejection(seedanceNz.uploadMedia(source, 'image', 'test-key', {
      uploadIntervalMs: 0,
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({ url: 'https://cdn.example.com/must-not-upload.png' });
      },
    }));
    assert.equal(error.code, 'SEEDANCE_REMOTE_MEDIA_BLOCKED', source);
    assert.equal(error.status, 400, source);
    if (source.includes('credential-secret')) {
      assert.match(error.message, /包含账号或密码/);
    } else {
      assert.match(error.message, /本机、局域网或受保护网络/);
    }
    assert.match(error.message, /重新上传原图片/);
    assert.match(error.message, /SEEDANCE_REMOTE_MEDIA_BLOCKED/);
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /credential-secret/);
  }
  const invalidSecret = 'invalid-media-reference-provider-secret';
  const invalidError = await capturedRejection(seedanceNz.uploadMedia(
    invalidSecret,
    'image',
    'test-key',
    {
      uploadIntervalMs: 0,
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({ url: 'https://cdn.example.com/must-not-upload.png' });
      },
    },
  ));
  assert.equal(invalidError.code, 'SEEDANCE_MEDIA_REFERENCE_INVALID');
  assert.doesNotMatch(`${invalidError.message} ${JSON.stringify(invalidError)}`, new RegExp(invalidSecret));
  assert.equal(providerCalls, 0);
});

test('seedance.nz treats absolute loopback URLs on controlled T8 mounts as local uploaded media', async () => {
  seedanceNz.resetCachesForTests();
  const config = require('../backend/src/config.js');
  const fileName = `seedance-local-ref-${process.pid}-${Date.now()}.png`;
  const filePath = join(config.INPUT_DIR, fileName);
  mkdirSync(config.INPUT_DIR, { recursive: true });
  writeFileSync(filePath, Buffer.from('local-reference'));
  let providerCalls = 0;

  try {
    const result = await seedanceNz.uploadMedia(
      `http://127.0.0.1:11422/files/input/${fileName}?legacy=1`,
      'image',
      'test-key',
      {
        uploadIntervalMs: 0,
        fetchImpl: async (url: string, init?: RequestInit) => {
          providerCalls += 1;
          assert.match(url, /\/v1\/files\/upload$/);
          assert.ok(init?.body instanceof FormData);
          return jsonResponse({ url: 'https://cdn.example.com/local-ref.png' });
        },
      },
    );

    assert.equal(result, 'https://cdn.example.com/local-ref.png');
    assert.equal(providerCalls, 1);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test('seedance.nz reports a missing controlled local file without attempting an SSRF fetch or Provider upload', async () => {
  seedanceNz.resetCachesForTests();
  let providerCalls = 0;
  const missing = `/files/output/seedance-missing-${process.pid}-${Date.now()}.png`;
  const error = await capturedRejection(seedanceNz.uploadMedia(
    `http://127.0.0.1:18766${missing}?cache=1`,
    'image',
    'test-key',
    {
      uploadIntervalMs: 0,
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({ url: 'https://cdn.example.com/must-not-upload.png' });
      },
    },
  ));

  assert.equal(error.code, 'SEEDANCE_MEDIA_REFERENCE_UNAVAILABLE');
  assert.equal(error.status, 400);
  assert.match(error.message, /本地文件不存在或无法读取/);
  assert.match(error.message, /重新上传原图片/);
  assert.doesNotMatch(error.message, /127\.0\.0\.1|seedance-missing/);
  assert.equal(providerCalls, 0);
});

test('seedance.nz media download enforces byte limit during streaming and cancels before upload', async (t) => {
  seedanceNz.resetCachesForTests();
  let originCalls = 0;
  let providerCalls = 0;
  const server = await listen((_req, res) => {
    originCalls += 1;
    res.writeHead(200, { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' });
    res.write(Buffer.alloc(12, 1));
    setImmediate(() => {
      if (!res.destroyed) res.end(Buffer.alloc(12, 2));
    });
  });
  t.after(() => closeServer(server));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const error = await capturedRejection(seedanceNz.uploadMedia(
    `http://127.0.0.1:${address.port}/oversized.png`,
    'image',
    'test-key',
    {
      maxBytes: 16,
      uploadIntervalMs: 0,
      allowPrivateForTests: (hostname: string) => hostname === '127.0.0.1',
      fetchImpl: async () => {
        providerCalls += 1;
        return jsonResponse({ url: 'https://cdn.example.com/must-not-upload.png' });
      },
    },
  ));

  assert.equal(error.code, 'SEEDANCE_MEDIA_TOO_LARGE');
  assert.equal(error.status, 413);
  assert.equal(originCalls, 1);
  assert.equal(providerCalls, 0);
});
