import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSingleSourceHandleData, selectSourceHandleData } from '../src/utils/sourceHandleData.ts';

test('subflow source handles isolate same-kind output payloads', () => {
  const data = {
    imageUrls: ['legacy-a.png', 'legacy-b.png'],
    subflowOutputs: {
      output_1: { imageUrls: ['one.png'], prompt: 'one' },
      output_2: { imageUrls: ['two.png'], prompt: 'two' },
    },
  };
  assert.deepEqual(selectSourceHandleData(data, new Set(['output_1'])), [{ imageUrls: ['one.png'], prompt: 'one' }]);
  assert.deepEqual(selectSourceHandleData(data, new Set(['output_2'])), [{ imageUrls: ['two.png'], prompt: 'two' }]);
  assert.deepEqual(selectSourceHandleData(data, new Set(['output_1', 'output_2'])), [
    { imageUrls: ['one.png'], prompt: 'one' },
    { imageUrls: ['two.png'], prompt: 'two' },
  ]);
});

test('legacy default and stale handles preserve compatible aggregate payloads', () => {
  const data = { imageUrls: ['legacy.png'], subflowOutputs: { output_1: { imageUrls: ['one.png'] } } };
  assert.deepEqual(selectSourceHandleData(data, new Set([null])), [data]);
  assert.deepEqual(selectSourceHandleData(data, new Set(['missing'])), [data]);
});

test('single source handles isolate first and last frame payloads', () => {
  const data = { firstFrameUrl: 'first.png', lastFrameUrl: 'last.png', imageUrls: ['first.png', 'last.png'] };
  assert.deepEqual(selectSingleSourceHandleData(data, 'first', 'image'), {
    imageUrl: 'first.png', imageUrls: ['first.png'], firstFrameUrl: 'first.png',
  });
  assert.deepEqual(selectSingleSourceHandleData(data, 'last', 'image'), {
    imageUrl: 'last.png', imageUrls: ['last.png'], lastFrameUrl: 'last.png',
  });
});

test('single source handles isolate dual audio tracks', () => {
  const data = { audioUrl: 'main.mp3', audioUrl_1: 'alternate.mp3', audioUrls: ['main.mp3', 'alternate.mp3'] };
  assert.deepEqual(selectSingleSourceHandleData(data, 'audio-0', 'audio'), {
    audioUrl: 'main.mp3', audioUrls: ['main.mp3'],
  });
  assert.deepEqual(selectSingleSourceHandleData(data, 'audio-1', 'audio'), {
    audioUrl: 'alternate.mp3', audioUrls: ['alternate.mp3'],
  });
});

test('typed handles do not leak sibling output kinds', () => {
  const data = {
    outputText: 'caption',
    imageUrl: 'result.png',
    videoUrl: 'result.mp4',
    metadata: { score: 0.9 },
  };
  assert.deepEqual(selectSingleSourceHandleData(data, 'text', 'text'), { outputText: 'caption' });
  assert.deepEqual(selectSingleSourceHandleData(data, 'image', 'image'), { imageUrl: 'result.png' });
  assert.deepEqual(selectSingleSourceHandleData(data, 'video', 'video'), { videoUrl: 'result.mp4' });
  assert.deepEqual(selectSingleSourceHandleData(data, 'metadata', 'metadata'), { metadata: { score: 0.9 } });
});

test('nested subflow output handle wins over aggregate fields', () => {
  const data = {
    imageUrl: 'aggregate.png',
    subflowOutputs: {
      portrait: { imageUrl: 'portrait.png' },
      mask: { imageUrl: 'mask.png' },
    },
  };
  assert.deepEqual(selectSingleSourceHandleData(data, 'mask', 'image'), { imageUrl: 'mask.png' });
});

test('multi-output core nodes route their explicit outputs map', () => {
  const data = {
    imageUrls: ['aggregate.png'],
    outputs: {
      image: { imageUrl: 'image.png', imageUrls: ['image.png'] },
      video: { videoUrl: 'video.mp4', videoUrls: ['video.mp4'] },
    },
  };
  assert.deepEqual(selectSourceHandleData(data, new Set(['image'])), [data.outputs.image]);
  assert.deepEqual(selectSourceHandleData(data, new Set(['video'])), [data.outputs.video]);
});
