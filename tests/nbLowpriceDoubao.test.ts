import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { NB_LOWPRICE_MODELS, SEED_AUDIO_MODELS, ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS, ZHENZHEN_BUDGET_BANANA_PRO_MODEL_OPTIONS, isZhenzhenBudgetImageModel } from '../src/providers/models';
import { buildDoubaoVoiceClientRequest, isSpeakerMaterial } from '../src/utils/doubaoVoiceInputs';
import { isConnectionValid } from '../src/config/portTypes';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { collectRunOutputAssets } from '../src/utils/runProviderTrace';
import { createDoubaoParameterEditor } from '../src/utils/doubaoVoiceParameters';
import { selectSourceHandleData, selectSingleSourceHandleData } from '../src/utils/sourceHandleData';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { zhCN, enUS } from '../src/i18n/resources';
const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const voice = require('../backend/src/providers/doubaoVoiceContract.js');
const contract = require('../backend/src/shared/nbLowpriceDoubaoContract.json');
const templates = require('../scripts/generate-nb-lowprice-doubao-workflows.cjs');
const authority = require('../backend/src/collaboration/runIntentAuthority.js');
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const prompt = 'Good morning.';
const clone = contract.audio.cloneModel, icl = contract.audio.iclModel;

test('catalog places both NB Lowprice variants in Banana 2 only and keeps legacy defaults', () => {
  for (const model of NB_LOWPRICE_MODELS) {
    assert.ok(ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS.some(item => item.value === model));
    assert.ok(isZhenzhenBudgetImageModel(model));
    assert.ok(!ZHENZHEN_BUDGET_BANANA_PRO_MODEL_OPTIONS.some(item => String(item.value) === model));
  }
  assert.equal(ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS[0].value, 'zhenzhen-image-nb-2');
  assert.deepEqual(SEED_AUDIO_MODELS, ['doubao-seed-audio-1.0', clone, icl]);
});
for (const [index, model] of NB_LOWPRICE_MODELS.entries()) {
  test(`${model}: exact whitelist, auto and model-specific ratios/resolutions`, async () => {
    for (const ratio of index === 0 ? contract.banana.proRatios : contract.banana.nb21Ratios) {
      for (const resolution of contract.banana.resolutions) {
        const built = await provider.buildImagePayload({ model, prompt: '字', n: 1, size: ratio, resolution,
          seed: 42, output_format: 'webp', quality: 'max' }, 'fixture-key');
        assert.deepEqual(built.payload, { model, prompt: '字', n: 1, size: ratio, metadata: { resolution } });
      }
    }
    await assert.rejects(provider.buildImagePayload({ model, prompt, size: '9:21' }, 'fixture-key'), /比例/);
    await assert.rejects(provider.buildImagePayload({ model, prompt, resolution: '0.5k' }, 'fixture-key'), /分辨率/);
    await assert.rejects(provider.buildImagePayload({ model, prompt, n: 2 }, 'fixture-key'), /固定为 1/);
    await assert.rejects(provider.buildImagePayload({ model, prompt: 'x'.repeat(5001) }, 'fixture-key'), /5000/);
    if (index === 0) await assert.rejects(provider.buildImagePayload({ model, prompt, size: '1:8' }, 'fixture-key'), /比例/);
  });
  test(`${model}: all 14 ordered references including duplicate slots survive uploads`, async () => {
    let uploads = 0;
    const refs = Array.from({ length: 14 }, (_, i) => `data:image/png;base64,${Buffer.from([i % 2 + 1]).toString('base64')}`);
    const built = await provider.buildImagePayload({ model, prompt, n: 1, size: 'auto', images: refs }, 'fixture-key', {
      uploadIntervalMs: 0, uploadCacheTtlMs: 0, fetchImpl: async (url: string, init: any) => {
        assert.match(url, /\/v1\/files\/upload$/);
        const bytes = Buffer.from(await init.body.get('file').arrayBuffer());
        assert.equal(bytes[0], uploads % 2 + 1);
        return json({ url: `https://cdn.example.test/${++uploads}.png` });
      },
    });
    assert.equal(uploads, 14);
    assert.deepEqual(built.payload.images, Array.from({ length: 14 }, (_, i) => `https://cdn.example.test/${i + 1}.png`));
    await assert.rejects(provider.buildImagePayload({ model, prompt, images: [...refs, refs[0]] }, 'fixture-key', { fetchImpl: () => { throw new Error('must not upload'); } }), /14/);
  });
}
test('clone preflight isolates metadata, preserves Boolean false and separates provider/custom speaker IDs', () => {
  const result = voice.buildDoubaoVoicePayload({ model: clone, prompt, audioUrls: ['https://cdn.example.test/sample.wav'],
    speaker: 'unused', outputFormat: 'unused', doubaoVoice: { custom_speaker_id: 'TestVoice01', speaker_id: 'provider-id', language: '1',
      reference_text: 'Good morning.', enable_audio_denoise: false, disable_volume_normalization: 'api_default', format: 'wav', seed: 123 } });
  assert.deepEqual(result.payload, { model: clone, prompt, metadata: { custom_speaker_id: 'TestVoice01', speaker_id: 'provider-id', language: '1', reference_text: prompt, enable_audio_denoise: false } });
  assert.equal(result.source, 'https://cdn.example.test/sample.wav');
});
test('clone validates every applicable field and count before any network', async () => {
  for (const patch of [{ prompt: 'abc' }, { prompt: 'x'.repeat(301) }, { audioUrls: [] }, { audioUrls: ['a', 'b'] },
    { doubaoVoice: { custom_speaker_id: '1badvoice' } }, { doubaoVoice: { custom_speaker_id: 'short' } },
    { doubaoVoice: { reference_text: 'x'.repeat(2001) } }, { doubaoVoice: { language: '18' } },
    { doubaoVoice: { enable_audio_denoise: 'false' } }, { doubaoVoice: [] }]) {
    await assert.rejects(provider.buildAudioPayload({ model: clone, prompt, audioUrls: ['https://cdn.example.test/a.wav'], ...patch }, 'fixture-key', {
      fetchImpl: () => { throw new Error('Unexpected network'); },
    }));
  }
});
test('actual clone upload encodes local audio to WAV at 24 kHz mono rather than renaming bytes', async () => {
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(Math.round(Math.sin(offset * 0.03) * 6000), offset);
  let uploads = 0;
  const built = await provider.buildAudioPayload({ model: clone, prompt, audioUrls: [`data:audio/wav;base64,${bytes.toString('base64')}`] }, 'fixture-key', {
    uploadIntervalMs: 0, uploadCacheTtlMs: 0, fetchImpl: async (url: string, init: any) => {
      assert.match(url, /\/v1\/files\/upload$/); uploads++;
      const file = init.body.get('file'); assert.equal(file.type, 'audio/wav'); assert.match(file.name, /\.wav$/);
      const encoded = Buffer.from(await file.arrayBuffer()); assert.equal(encoded.toString('ascii', 0, 4), 'RIFF');
      const fmt = encoded.indexOf(Buffer.from('fmt ')); assert.ok(fmt >= 0);
      assert.equal(encoded.readUInt16LE(fmt + 10), 1); assert.equal(encoded.readUInt32LE(fmt + 12), 24000);
      assert.ok(encoded.length > bytes.length);
      return json({ url: 'https://cdn.example.test/converted.wav' });
    },
  });
  assert.equal(uploads, 1); assert.equal(built.payload.metadata.audio_url, 'https://cdn.example.test/converted.wav');
});
test('ICL exact types and dependent omission, LaTeX and MP3 bit-rate gates', async () => {
  const built = await provider.buildAudioPayload({ model: icl, prompt: '字', speaker: 'ReturnedVoice', audioUrls: ['unused'],
    doubaoVoice: { voice_model: 'seed-tts-2.0-standard', context_texts: 'x'.repeat(900), sample_rate: '48000',
      speech_rate: 0.5, loudness_rate: -50, pitch: -12, bit_rate: 32000, disable_default_bit_rate: true,
      max_length_to_filter_parenthesis: '100', latex_parser: 'v2', enable_subtitle: false } }, 'fixture-key');
  assert.deepEqual(built.payload.metadata, { voice_model: 'seed-tts-2.0-standard', format: 'mp3', sample_rate: '48000', speech_rate: 0.5,
    loudness_rate: -50, pitch: -12, bit_rate: 32000, disable_default_bit_rate: true, max_length_to_filter_parenthesis: 100,
    silence_duration: 0, enable_subtitle: false, latex_parser: 'v2', disable_markdown_filter: false, speaker: 'ReturnedVoice' });
  const defaultVoice = voice.buildDoubaoVoicePayload({ model: icl, prompt, speaker: 'ReturnedVoice', doubaoVoice: { voice_model: 'api_default', context_texts: 'Soft and clear' } });
  assert.equal(defaultVoice.payload.metadata.context_texts, 'Soft and clear');
  assert.equal(Object.hasOwn(defaultVoice.payload.metadata, 'voice_model'), false);
  for (const params of [{ speech_rate: true }, { pitch: 13 }, { sample_rate: '96000' }, { speech_rate: NaN }, { bit_rate: 32000 },
    { disable_default_bit_rate: true, bit_rate: 48000 }, { latex_parser: 'v2', disable_markdown_filter: true },
    { voice_model: 'api_default', context_texts: 'x'.repeat(501) }, { section_id: 'x'.repeat(129) }]) {
    assert.throws(() => voice.buildDoubaoVoicePayload({ model: icl, prompt, speaker: 'ReturnedVoice', doubaoVoice: params }));
  }
  for (const sample_rate of contract.audio.iclFields.sample_rate.options) {
    assert.equal(voice.buildDoubaoVoicePayload({ model: icl, prompt, speaker: 'ReturnedVoice', doubaoVoice: { sample_rate } }).payload.metadata.sample_rate, sample_rate);
  }
});
test('speaker port is text-only, bounded and separate from synthesis prompt; no synthetic ID fallback', () => {
  const text = { url: 'ReturnedVoice', targetHandles: ['speaker'] };
  assert.equal(isSpeakerMaterial(text), true);
  assert.equal(isSpeakerMaterial({ targetHandles: [''] }), false);
  assert.equal(buildDoubaoVoiceClientRequest({ model: icl, prompt, params: {}, texts: [text], audioUrls: [] }).speaker, 'ReturnedVoice');
  assert.throws(() => buildDoubaoVoiceClientRequest({ model: icl, prompt, params: {}, texts: [], audioUrls: [] }));
  assert.throws(() => buildDoubaoVoiceClientRequest({ model: icl, prompt, params: {}, speaker: 'Conflicting', texts: [text], audioUrls: [] }));
  const source: any = { id: 'a', type: 'audio', data: {} }, target: any = { id: 'b', type: 'audio', data: {} };
  assert.equal(isConnectionValid(source, target, { sourceHandle: 'text', targetHandle: 'speaker' }), true);
  assert.equal(isConnectionValid(source, target, { sourceHandle: 'audio-0', targetHandle: 'speaker' }), false);
});
test('query preserves every ordered preview and uses only authoritative result_text for Doubao', async () => {
  const previews = ['https://cdn.example.test/1.wav', 'https://cdn.example.test/2.wav', 'https://cdn.example.test/1.wav'];
  const result = await provider.queryAudioTask('fixture-task', 'fixture-key', { model: clone, fetchImpl: async () => json({ data: {
    status: 'SUCCESS', result_text: 'ReturnedVoice', result_url: previews[0], data: { content: { audio_urls: previews, voice_id: 'WrongEcho' } },
  } }) });
  assert.deepEqual(result.audioUrls, previews); assert.equal(result.resultText, 'ReturnedVoice');
  const missing = await provider.queryAudioTask('fixture-task', 'fixture-key', { model: clone, fetchImpl: async () => json({ data: {
    status: 'SUCCESS', custom_voice_id: 'RequestedButNotReturned', data: { content: { audio_urls: previews } },
  } }) });
  assert.equal(missing.status, 'failed'); assert.equal(missing.resultText, '');
});
test('training speaker output never routes its preview prompt or requested ID; hot/cold shells keep the same new ports', () => {
  const pending = { seedAudioModel: clone, prompt, doubaoVoiceParams: { custom_speaker_id: 'UnconfirmedRequest' } };
  assert.deepEqual(selectSourceHandleData(pending, new Set(['text'])), [{ outputText: '', text: '', texts: [] }]);
  const completed = { ...pending, seedanceNzAudioResultText: 'ReturnedVoice', texts: ['ReturnedVoice'], audioUrl: '/files/output/preview.wav' };
  assert.deepEqual(selectSingleSourceHandleData(completed, 'text'), { outputText: 'ReturnedVoice', text: 'ReturnedVoice', texts: ['ReturnedVoice'] });
  assert.deepEqual(selectSingleSourceHandleData(completed, 'audio-0'), { audioUrl: '/files/output/preview.wav', audioUrls: ['/files/output/preview.wav'] });
  const source = fs.readFileSync(new URL('../src/components/nodes/AudioNode.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/isDoubaoIcl && <Handle type="target" id="speaker"/g) || []).length, 2);
  assert.equal((source.match(/isDoubaoClone && <Handle type="source" id="text"/g) || []).length, 2);
});
test('all nine safe workflows import, route correct models and connect an actual speaker handle', () => {
  const all = [...templates.CASES.map(templates.imageWorkflow), ...templates.audioCases.map(templates.audioWorkflow)];
  assert.equal(all.length, 9);
  for (const item of all) {
    const text = JSON.stringify(item);
    assert.doesNotMatch(text, /sk-|https?:|taskId|result_text|ReturnedVoice|TestVoice/);
    const fragment = workflowManifestToFragment(item);
    assert.equal(fragment.nodes.length, item.nodes.length);
    for (const node of fragment.nodes.filter(node => node.type === 'image' || node.type === 'audio')) {
      assert.deepEqual(authority.providerDeclarationForNode(node, fragment), {
        provider: 'seedance-nz', model: node.type === 'image' ? node.data.apiModel : node.data.seedAudioModel,
      });
    }
    for (const edge of fragment.edges) {
      const source = fragment.nodes.find(node => node.id === edge.source)!;
      const target = fragment.nodes.find(node => node.id === edge.target)!;
      assert.equal(isConnectionValid(source, target, edge), true);
    }
  }
  const combined = templates.audioWorkflow('doubao-training-to-synthesis');
  assert.ok(combined.edges.some((edge: any) => edge.sourceHandle === 'text' && edge.targetHandle === 'speaker'));
});
test('every new model recovers only the original GET with a shared minimum 15-minute media window', () => {
  const { recoveryRequest } = require('../backend/src/services/runRecovery');
  for (const model of [...NB_LOWPRICE_MODELS, clone, icl]) {
    const result = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model, taskId: 'fixture-task' })!;
    assert.equal(result.kind, NB_LOWPRICE_MODELS.includes(model) ? 'seedream-nz' : 'seed-audio');
    assert.equal(result.model, model);
    assert.ok(result.maxPolls! * result.pollIntervalMs! >= 900000);
    const request = recoveryRequest('http://127.0.0.1', result);
    assert.equal(request.options.method, 'GET');
    assert.match(request.url, /fixture-task/);
  }
});
test('clone recovery commits all ordered previews plus authoritative inline speaker text', () => {
  const { normalizeRecoveryPayload, recoveryRequest } = require('../backend/src/services/runRecovery');
  const descriptor = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model: clone, taskId: 'fixture-task' })!;
  assert.match(recoveryRequest('http://127.0.0.1', descriptor).url, /model=doubao-voice-clone/);
  const audioUrls = ['/files/output/one.wav', '/files/output/two.wav', '/files/output/one.wav'];
  const result = normalizeRecoveryPayload({ data: { status: 'succeeded', audioUrls, resultText: 'ReturnedVoice' } }, descriptor);
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(result.outputs.slice(0, 3).map((item: any) => item.sourceUrl), audioUrls);
  assert.deepEqual(result.outputs[3], { kind: 'text', text: 'ReturnedVoice', filename: 'recovered-doubao-speaker.txt' });
  assert.equal(normalizeRecoveryPayload({ data: { status: 'succeeded', audioUrls } }, descriptor).state, 'failed');
  const normal = collectRunOutputAssets({ model: clone, audioUrls, audioUrl: audioUrls[0], outputText: 'ReturnedVoice' });
  assert.deepEqual(normal.slice(0, 3).map(item => item.sourceUrl), audioUrls);
  assert.equal(normal[3].text, 'ReturnedVoice');
});
test('localized controls cover the exact metadata contract and UI keeps prompt/speaker inputs distinct', () => {
  for (const key of new Set([...Object.keys(contract.audio.cloneFields), ...Object.keys(contract.audio.iclFields)])) {
    assert.ok(Object.hasOwn(zhCN.nodes.audio.doubaoVoice.fields, key));
    assert.ok(Object.hasOwn(enUS.nodes.audio.doubaoVoice.fields, key));
  }
  const source = fs.readFileSync(new URL('../src/components/nodes/AudioNode.tsx', import.meta.url), 'utf8');
  assert.match(source, /orderedTexts\.filter\(item => !isSpeakerMaterial\(item\)\)/);
  assert.match(source, /buildDoubaoVoiceClientRequest/);
  assert.match(source, /isLegacySeedAudio/);
});
test('production parameter editor retains consecutive edits, identical replays and canonical reload', () => {
  const original = { format: 'mp3' };
  const editor = createDoubaoParameterEditor(original);
  assert.deepEqual(editor.change('speech_rate', 0.5).value, { format: 'mp3', speech_rate: 0.5 });
  editor.sync(original); // unchanged props during React batching must not discard an edit
  const second = editor.change('pitch', -3);
  assert.deepEqual(second.value, { format: 'mp3', speech_rate: 0.5, pitch: -3 });
  assert.deepEqual(original, { format: 'mp3' });
  assert.equal(editor.change('pitch', -3).changed, false);
  editor.sync({ format: 'wav' });
  assert.deepEqual(editor.change('sample_rate', '48000').value, { format: 'wav', sample_rate: '48000' });
});
test('documented raw PCM gets a lossless 16-bit mono WAV header and persists its submitted recovery rate', async () => {
  const { wrapPcm16MonoWav } = require('../backend/src/utils/pcmAudio');
  const raw = Buffer.alloc(9600);
  for (let offset = 0; offset < raw.length; offset += 2) raw.writeInt16LE(Math.round(Math.sin(offset * .03) * 6000), offset);
  const wav = wrapPcm16MonoWav(raw, 48000);
  assert.equal(wav.readUInt32LE(24), 48000); assert.deepEqual(wav.subarray(44), raw);
  assert.throws(() => wrapPcm16MonoWav(Buffer.alloc(3), 24000), /帧/);
  assert.throws(() => wrapPcm16MonoWav(raw, 12345), /采样率/);
  assert.throws(() => wrapPcm16MonoWav(raw, 24000, 100), /大小/);
  const descriptor = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model: icl, taskId: 'fixture-pcm', outputFormat: 'pcm', sampleRate: '48000' })!;
  const recovery = require('../backend/src/services/runRecovery');
  assert.equal(recovery.normalizeRunRecoveryDescriptor(descriptor).sampleRate, '48000');
  const request = recovery.recoveryRequest('http://127.0.0.1', descriptor);
  assert.equal(request.options.method, 'GET'); assert.match(request.url, /outputFormat=pcm&sampleRate=48000/);
  const result = await provider.queryAudioTask('fixture-pcm', 'fixture-key', { model: icl, outputFormat: 'pcm', sampleRate: '48000', fetchImpl: async () => json({ data: {
    status: 'SUCCESS', result_url: 'https://cdn.example.test/result.pcm',
  } }) });
  assert.equal(result.pcmSampleRate, 48000);
  await provider.buildAudioPayload({ model: clone, prompt, audioUrls: [`data:audio/pcm;base64,${raw.toString('base64')}`] }, 'fixture-key', {
    uploadIntervalMs: 0, uploadCacheTtlMs: 0, fetchImpl: async (_url: string, init: any) => {
      const file = init.body.get('file'), encoded = Buffer.from(await file.arrayBuffer());
      assert.equal(file.type, 'audio/wav'); assert.equal(encoded.toString('ascii', 0, 4), 'RIFF');
      const fmt = encoded.indexOf(Buffer.from('fmt ')); assert.equal(encoded.readUInt32LE(fmt + 12), 24000);
      return json({ url: 'https://cdn.example.test/raw-converted.wav' });
    },
  });
});
