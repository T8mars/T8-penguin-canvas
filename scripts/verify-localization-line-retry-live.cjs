'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'localization-master-live');
const REFERENCE = path.join(ARTIFACT_DIR, 'reference-voice-qwen3-clean.wav');

function run(command, args, { binary = false, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || `${path.basename(command)} exited ${code}`));
      else {
        const bytes = Buffer.concat(stdout);
        resolve(binary ? bytes : bytes.toString('utf8'));
      }
    });
  });
}

async function segmentRms(filename, startSeconds, durationSeconds) {
  const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
  const pcm = await run(ffmpeg, [
    '-v', 'error', '-ss', String(startSeconds), '-t', String(durationSeconds),
    '-i', filename, '-map', '0:a:0', '-ac', '1', '-ar', '24000', '-f', 'f32le', '-',
  ], { binary: true });
  assert.ok(pcm.length >= 4, 'RMS probe returned no samples');
  let sumSquares = 0;
  const samples = Math.floor(pcm.length / 4);
  for (let offset = 0; offset + 4 <= pcm.length; offset += 4) {
    const sample = pcm.readFloatLE(offset);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples);
}

function dbDifference(left, right) {
  return Math.abs(20 * Math.log10(Math.max(left, 1e-12) / Math.max(right, 1e-12)));
}

async function main() {
  if (process.env.T8_INDEXTTS25_LICENSE_ACCEPTED !== '1') {
    throw new Error('Set T8_INDEXTTS25_LICENSE_ACCEPTED=1 only after explicit license acceptance.');
  }
  const config = require('../backend/src/config.js');
  const service = require('../backend/src/services/localizationMaster.js');
  const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 't8-localization-line-retry-'));
  try {
    await service.acceptIndexTtsModelLicense({ accepted: true });
    const runtime = await service.inspectIndexTtsRuntime();
    assert.equal(runtime.ready, true, runtime.message || 'IndexTTS runtime is not ready');
    const baseAudio = path.join(temporaryRoot, 'base-tone.wav');
    await run(ffmpeg, [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=8',
      '-af', 'volume=0.1', '-ac', '1', '-c:a', 'pcm_s16le', baseAudio,
    ]);
    const runId = String(process.env.T8_INDEXTTS25_LINE_RETRY_RUN_ID || Date.now())
      .replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 80);
    const result = await service.retryIndexTtsDialogueLine({
      baseAudioUrl: baseAudio,
      language: 'EN',
      unit: {
        index: 2,
        role: 'Narrator',
        translatedText: 'Welcome to T8.',
        pronunciation: 'Welcome to T eight.',
        emotion: 'calm and clear',
        startMs: 2_000,
        endMs: 6_000,
      },
      roles: [{ role: 'Narrator', referenceUrl: REFERENCE, consentConfirmed: true }],
      timelinePolicy: 'shift',
      timingMode: 'exact',
      asrEnabled: false,
      asrRetryCount: 0,
      asrThreshold: 0.6,
      subtitleTimingMode: 'original',
      subtitleTextMode: 'original',
      subtitleIncludeRole: false,
      postprocessPreset: 'voice_clarity',
      postprocessStrength: 0.35,
      seed: 2026083001,
      jobKey: `localization-line-retry-live/${runId}`,
    });
    assert.equal(result.schema, 't8-localization-tts-line-retry-result-v1');
    const outputName = decodeURIComponent(new URL(result.audioUrl, 'http://t8.local').pathname.split('/').pop());
    const outputAudio = path.join(config.OUTPUT_DIR, outputName);
    const [baseBefore, outputBefore, baseAfter, outputAfter] = await Promise.all([
      segmentRms(baseAudio, 0.25, 1.5),
      segmentRms(outputAudio, 0.25, 1.5),
      segmentRms(baseAudio, 6.25, 1.5),
      segmentRms(outputAudio, 6.25, 1.5),
    ]);
    const beforeDifferenceDb = dbDifference(baseBefore, outputBefore);
    const afterDifferenceDb = dbDifference(baseAfter, outputAfter);
    assert.ok(beforeDifferenceDb < 0.1, `audio before replacement changed by ${beforeDifferenceDb.toFixed(3)} dB`);
    assert.ok(afterDifferenceDb < 0.1, `audio after replacement changed by ${afterDifferenceDb.toFixed(3)} dB`);
    const report = {
      schema: 't8-localization-line-retry-live-report-v1',
      createdAt: new Date().toISOString(),
      passed: true,
      runtime: { device: runtime.device, modelRevision: runtime.modelRevision },
      replacement: {
        lineIndex: result.index,
        outputFilename: path.basename(outputAudio),
        byteLength: result.byteLength,
        sha256: result.sha256,
        requestId: result.lineResult.requestId || null,
      },
      unchangedProgrammeGain: {
        beforeDifferenceDb: Number(beforeDifferenceDb.toFixed(6)),
        afterDifferenceDb: Number(afterDifferenceDb.toFixed(6)),
        toleranceDb: 0.1,
      },
      apiKeyPersisted: false,
      rawWorkerResponsePersisted: false,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{12,}/gu);
    await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
    await fsp.writeFile(path.join(ARTIFACT_DIR, 'line-retry-report.json'), serialized, 'utf8');
    process.stdout.write(`${JSON.stringify({ ok: true, report: 'artifacts/localization-master-live/line-retry-report.json', beforeDifferenceDb, afterDifferenceDb })}\n`);
  } finally {
    service.stopWorker();
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error).replace(/[A-Za-z]:\\[^\r\n]*/gu, '[redacted-local-path]').slice(0, 2_000)}\n`);
  process.exitCode = 1;
});
