'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  archivePriorFailedReport,
  assertAudioQuality,
  assertGenerationReport,
  assertSafeSerializedReport,
  inspectPcm16Wav,
  resolveOutputUrl,
  sanitizeError,
} = require('../scripts/verify-localization-indextts-live.cjs');

function pcm16Wav(samples, sampleRate = 24_000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const output = Buffer.alloc(44 + data.length);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + data.length, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(data.length, 40);
  data.copy(output, 44);
  return output;
}

test('live verifier accepts a decodable non-silent mono PCM fixture and rejects silence', () => {
  const samples = Array.from({ length: 24_000 }, (_, index) => Math.round(Math.sin(index / 12) * 8_000));
  const metrics = inspectPcm16Wav(pcm16Wav(samples));
  assertAudioQuality(metrics);
  assert.equal(metrics.channels, 1);
  assert.equal(Math.round(metrics.durationSeconds), 1);
  assert.throws(() => assertAudioQuality(inspectPcm16Wav(pcm16Wav(new Array(24_000).fill(0)))), /静音/);
});

test('live verifier resolves only controlled output URLs', () => {
  const root = path.join(os.tmpdir(), 't8-output');
  assert.equal(resolveOutputUrl('/files/output/localization.wav', root), path.join(root, 'localization.wav'));
  assert.throws(() => resolveOutputUrl('/files/output/..%2Fsecret.wav', root), /不安全/);
  assert.throws(() => resolveOutputUrl('https://example.com/files/output/a.wav', root), /本地相对/);
});

test('live verifier fails closed on ASR quality and report secrets', () => {
  const report = {
    schema: 't8-localization-indextts25-execution-report-v1',
    language: 'EN', lineCount: 1, durationMs: 1_000, asrEnabled: true, asrDevice: 'cpu',
    lines: [{ asr: { enabled: true, recognizedText: 'hello', similarity: 0.91, passed: true } }],
  };
  assert.doesNotThrow(() => assertGenerationReport(report, 'EN', 0.6));
  report.lines[0].asr.similarity = 0.2;
  assert.throws(() => assertGenerationReport(report, 'EN', 0.6), /相似度/);
  assert.throws(() => assertSafeSerializedReport('{"key":"sk-abcdefghijklmnopqrstuvwxyz"}'), /API Key/);
  assert.doesNotMatch(sanitizeError(new Error('failed sk-abcdefghijklmnopqrstuvwxyz at C:\\Users\\tester\\voice.wav')), /sk-|C:\\/u);
});

test('preflight helper never reads or mutates project databases', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'verify-localization-indextts-live.cjs'), 'utf8');
  assert.doesNotMatch(source, /t8-projects\.sqlite3|projectDb|better-sqlite3/iu);
  assert.match(source, /T8_INDEXTTS25_LICENSE_ACCEPTED/);
  assert.match(source, /inferenceExecuted:\s*false/);
  assert.match(source, /service\.stopWorker\([^)]*\);\s*for \(const job of completedJobs\)/su);
  assert.match(source, /language-failed/);
});

test('a failed live report is archived before a later acceptance run overwrites it', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 't8-indextts-report-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const report = path.join(root, 'indextts-five-language-report.json');
  await fs.promises.writeFile(report, '{"passed":false,"reason":"torch-abi"}\n', 'utf8');
  const archived = await archivePriorFailedReport(report);
  assert.match(archived, /^indextts-five-language-failure-[a-f0-9]{12}\.json$/u);
  assert.equal(await fs.promises.readFile(path.join(root, archived), 'utf8'), '{"passed":false,"reason":"torch-abi"}\n');
});
