'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCreatorAudioObservation,
  groundCreatorAudioAttachments,
  normalizeCreatorAudioObservation,
} = require('../backend/src/services/creatorAgentMediaGrounding.js');
const {
  mediaGroundingRequirement,
  mediaObservationQuality,
} = require('../backend/src/services/creatorAgentLlmRuntime.js');

function audioAttachment() {
  return {
    id: 'attachment-audio-1',
    assetId: 'asset-audio-1',
    kind: 'audio',
    name: 'dialogue.wav',
    ref: 'http://127.0.0.1:18766/api/project-assets/asset-audio-1/media',
    mimeType: 'audio/wav',
    size: 12_345,
    contentRevision: 4,
    contentHash: 'a'.repeat(64),
    duration: 8.4,
  };
}

test('audio observation is content-addressed and bound to the exact asset revision', () => {
  const attachment = audioAttachment();
  const observation = createCreatorAudioObservation({
    attachment,
    result: {
      text: '今晚十点，我们在旧车站见。',
      model: 'whisper-1',
      responseFormat: 'verbose_json',
      requestId: 'whisper-request-1',
      segments: [{ start: 0.2, end: 3.8, text: '今晚十点，我们在旧车站见。' }],
    },
    observedAt: '2026-08-29T01:00:00.000Z',
  });
  assert.ok(observation);
  assert.deepEqual(normalizeCreatorAudioObservation(observation, attachment), observation);
  assert.equal(normalizeCreatorAudioObservation(observation, {
    ...attachment,
    contentRevision: 5,
  }), null);
  assert.equal(normalizeCreatorAudioObservation({
    ...observation,
    transcript: '被篡改的转写',
  }, attachment), null);
});

test('audio grounding calls the transcriber once and becomes verified model context', async () => {
  const attachment = audioAttachment();
  let calls = 0;
  const result = await groundCreatorAudioAttachments([attachment], {
    transcribeAudio: async (received) => {
      calls += 1;
      assert.equal(received.assetId, attachment.assetId);
      return {
        text: '今晚十点，我们在旧车站见。',
        model: 'whisper-1',
        responseFormat: 'verbose_json',
        requestId: 'whisper-request-1',
        segments: [{ start: 0.2, end: 3.8, text: '今晚十点，我们在旧车站见。' }],
      };
    },
    now: () => '2026-08-29T01:00:00.000Z',
  });
  assert.equal(calls, 1);
  assert.equal(result.providerCalls, 1);
  assert.equal(result.attachments[0].audioObservation.transcript, '今晚十点，我们在旧车站见。');
  const requirement = mediaGroundingRequirement({ attachments: result.attachments });
  assert.equal(requirement.audioObserved, true);
  assert.equal(requirement.unsupportedAudio, false);
  const quality = mediaObservationQuality('## 声音方案\n\n按转写对白形成镜头。', {
    attachments: result.attachments,
  });
  assert.equal(quality.ok, true);
  assert.equal(quality.status, 'confirmed');
  assert.match(quality.observationDigest, /^[a-f0-9]{64}$/);

  const reused = await groundCreatorAudioAttachments(result.attachments, {
    transcribeAudio: async () => {
      calls += 1;
      throw new Error('不应再次调用');
    },
  });
  assert.equal(calls, 1);
  assert.equal(reused.providerCalls, 0);
});

test('audio without stable asset hash fails before any formal creation', async () => {
  await assert.rejects(
    groundCreatorAudioAttachments([{ ...audioAttachment(), contentHash: '' }], {
      transcribeAudio: async () => ({ text: '不应使用' }),
    }),
    (error) => error?.code === 'CREATOR_AUDIO_EVIDENCE_REQUIRED',
  );
});
