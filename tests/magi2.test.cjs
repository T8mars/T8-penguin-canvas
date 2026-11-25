'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const spec = require('../backend/src/shared/magi2Contract.json');
const provider = require('../backend/src/providers/seedanceNz');
const { normalizeRunRecoveryDescriptor, recoveryRequest } = require('../backend/src/services/runRecovery');

const request = { model: spec.models[0], prompt: ' A blue cube turns. ' };
const baseUrl = 'https://fixture.example';
const mediaUrl = (buffer, mime) => 'data:' + mime + ';base64,' + buffer.toString('base64');

test('Magi selects the documented modes and preserves ordered duplicate slots', async () => {
  const { buildMagi2Payload } = await import('../backend/src/shared/magi2Contract.mjs');
  for (const model of spec.models) {
    const build = (patch) => buildMagi2Payload(spec, { ...request, model, ...patch });
    assert.deepEqual(build({}).payload, {
      model, prompt: request.prompt.trim(), seconds: '5', metadata: { resolution: '1080p', generate_audio: true },
    });
    const images = ['first', 'last'];
    assert.equal(build({ images }).taskType, 'frame');
    assert.equal(build({ images: ['same', 'same'] }).references.images.length, 2);
    assert.equal(build({ images: ['first', 'last', 'third'] }).taskType, 'reference');
    assert.equal(build({ audios: ['clip'] }).taskType, 'reference');
    assert.equal(build({ mode: 'reference', images: ['character'] }).taskType, 'reference');
    assert.deepEqual(build({ mode: 'frame', images, seed: 0, generateAudio: false, duration: 4 }).payload.metadata,
      { resolution: '1080p', generate_audio: false, generation_type: 'frame', seed: 0 });
    for (const patch of [
      { mode: 'frame', images: [] }, { mode: 'frame', images, audios: ['clip'] },
      { mode: 'text', videos: ['clip'] }, { mode: 'reference' },
      { duration: 31 }, { duration: 4.5 }, { ratio: 'adaptive' },
      { images: Array(11).fill('x') }, { videos: Array(6).fill('x') },
      { audios: Array(6).fill('x') }, { prompt: '' }, { prompt: 'x'.repeat(15001) },
    ]) assert.throws(() => build(patch), { status: 400 });
  }
});

test('production Magi submit uploads ordered frames and routes mixed references under the verified wire fields', async () => {
  const sharp = require('sharp');
  const picture = color => sharp({ create: { width: 4, height: 4, channels: 3, background: color } }).png().toBuffer();
  const red = await picture('red');
  const blue = await picture('blue');
  const wave = require('../backend/src/utils/pcmAudio').wrapPcm16Wav(Buffer.alloc(96000), 24000, 1);
  const video = Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex');
  const images = [mediaUrl(red, 'image/png'), mediaUrl(blue, 'image/png')];
  const videos = [mediaUrl(video, 'video/mp4')];
  const audios = [mediaUrl(wave, 'audio/wav')];
  const posts = [], uploads = [];
  const options = {
    baseUrl, uploadIntervalMs: 0, uploadCacheTtlMs: 0,
    seedance25DurationProbe: () => 16,
    async fetchImpl(url, init) {
      assert.equal(init.method, 'POST');
      if (url.endsWith('/v1/files/upload')) {
        const file = init.body.get('file');
        const url = baseUrl + '/upload/' + uploads.length;
        uploads.push({ url, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
        return Response.json({ url });
      }
      assert.equal(url, baseUrl + '/v1/video/generations');
      posts.push(JSON.parse(init.body));
      return Response.json({ data: { task_id: 'original-task' } });
    },
  };
  const frames = await provider.submitMagi2VideoTask({ ...request, mode: 'frame', images }, 'fixture', options);
  assert.equal(frames.taskType, 'frame');
  assert.equal(frames.taskId, 'original-task');
  assert.deepEqual(posts[0].images, uploads.slice(0, 2).map(file => file.url));
  assert.deepEqual(await sharp(uploads[0].bytes).raw().toBuffer(), await sharp(red).raw().toBuffer());
  assert.deepEqual(await sharp(uploads[1].bytes).raw().toBuffer(), await sharp(blue).raw().toBuffer());
  assert.equal(posts[0].metadata.ratio, undefined);

  const model = spec.models[1];
  await provider.submitMagi2VideoTask({ ...request, model, images: [images[0]], videos, audios }, 'fixture', options);
  assert.equal(posts[1].model, model);
  assert.deepEqual(posts[1].images, [uploads[2].url]);
  assert.deepEqual(posts[1].metadata.video_url, [uploads[3].url]);
  assert.deepEqual(posts[1].metadata.audio_urls, [uploads[4].url]);
  assert.deepEqual(uploads.slice(2).map(file => file.type), ['image/png', 'video/mp4', 'audio/wav']);

  await assert.rejects(provider.submitMagi2VideoTask({ ...request, videos: [...videos, ...videos] }, 'fixture', options), /total video duration/);
  await assert.rejects(provider.submitMagi2VideoTask({ ...request, audios }, 'fixture', {
    ...options, seedance25DurationProbe: () => 1,
  }), /2–30 seconds/);
  assert.equal(posts.length, 2);
});

test('Magi recovery queries only the original task and rejects a mismatched returned model', async () => {
  for (const model of spec.models) {
    const d = normalizeRunRecoveryDescriptor({ kind: 'magi', model, taskId: 'original/task' });
    const query = recoveryRequest(baseUrl, d);
    assert.equal(query.options.method, 'GET');
    assert.equal(query.url, baseUrl + '/api/proxy/video/magi/status/original%2Ftask?model=' + model);
    const result = await provider.queryMagi2VideoTask(d.taskId, 'fixture', {
      model, baseUrl, async fetchImpl(url, init) {
        assert.equal(url, baseUrl + '/v1/video/generations/original%2Ftask');
        assert.equal(init.method, 'GET');
        return Response.json({ data: { model, status: 'SUCCESS', result_url: baseUrl + '/output.mp4' } });
      },
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.videoUrl, baseUrl + '/output.mp4');
    await assert.rejects(provider.queryMagi2VideoTask(d.taskId, 'fixture', {
      model, baseUrl, fetchImpl: async () => Response.json({
        data: { model: spec.models.find(other => other !== model), status: 'SUCCESS' },
      }),
    }), /mismatch/);
  }
});
