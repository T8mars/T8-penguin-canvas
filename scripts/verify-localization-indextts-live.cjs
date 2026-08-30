'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'localization-master-live');
const DEFAULT_REFERENCE = path.join(ARTIFACT_DIR, 'reference-voice-qwen3-clean.wav');
const DEFAULT_TRANSLATIONS = path.join(ARTIFACT_DIR, 'translation-report.json');
const LICENSE_URL = 'https://github.com/index-tts/index-tts/blob/main/LICENSE_ZH.txt';
const LANGUAGES = Object.freeze(['ZH', 'EN', 'JA', 'ES', 'AR']);
const SPOKEN_REPLACEMENTS = Object.freeze({ ZH: '三', EN: 'three', JA: '3', ES: 'tres', AR: 'ثلاثة' });
const PRONUNCIATION_OVERRIDES = Object.freeze({
  ZH: 'T八将在二零二六年为三位创作者打开新世界。',
});
const LANGUAGE_SEEDS = Object.freeze({ ZH: 2026082901, EN: 2026082902, JA: 2026082903, ES: 2026082904, AR: 2026082905 });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(filename) {
  return sha256(await fsp.readFile(filename));
}

function sanitizeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/sk-[A-Za-z0-9_-]{12,}/gu, '[redacted-api-key]')
    .replace(/[A-Za-z]:\\[^\r\n]*/gu, '[redacted-local-path]')
    .replace(/\/(?:Users|home|private|tmp)\/[^\r\n]*/gu, '[redacted-local-path]')
    .slice(0, 2_000);
}

function resolveOutputUrl(outputUrl, outputDir) {
  const parsed = new URL(String(outputUrl || ''), 'http://t8.local');
  assert.equal(parsed.origin, 'http://t8.local', '输出必须是画布本地相对 URL');
  assert.match(parsed.pathname, /^\/files\/output\/[^/]+$/u, '输出 URL 不在受控 output 目录');
  const basename = decodeURIComponent(parsed.pathname.slice('/files/output/'.length));
  assert.equal(path.basename(basename), basename, '输出文件名不安全');
  assert.doesNotMatch(basename, /[\\/\0]/u, '输出文件名不安全');
  return path.join(path.resolve(outputDir), basename);
}

function inspectPcm16Wav(buffer) {
  assert.ok(Buffer.isBuffer(buffer) && buffer.length >= 44, 'WAV 文件过短');
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', '音频不是 RIFF WAV');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE', '音频不是 WAVE');
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(buffer.length, start + size);
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    }
    if (id === 'data') data = buffer.subarray(start, end);
    offset = start + size + (size % 2);
  }
  assert.ok(format, 'WAV 缺少 fmt 块');
  assert.ok(data && data.length >= 2, 'WAV 缺少有效 data 块');
  assert.equal(format.audioFormat, 1, '只接受 PCM WAV');
  assert.equal(format.bitsPerSample, 16, '只接受 16-bit PCM WAV');
  const samples = Math.floor(data.length / 2);
  let sumSquares = 0;
  let peak = 0;
  let active = 0;
  let clipped = 0;
  for (let index = 0; index < samples; index += 1) {
    const absolute = Math.abs(data.readInt16LE(index * 2));
    const normalized = absolute / 32768;
    sumSquares += normalized * normalized;
    peak = Math.max(peak, normalized);
    if (absolute >= 128) active += 1;
    if (absolute >= 32760) clipped += 1;
  }
  const rms = Math.sqrt(sumSquares / samples);
  return {
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    sampleCount: samples,
    durationSeconds: samples / Math.max(1, format.sampleRate * format.channels),
    rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
    peak,
    activeRatio: active / samples,
    clippedRatio: clipped / samples,
  };
}

function assertAudioQuality(metrics) {
  assert.equal(metrics.channels, 1, '配音必须是单声道');
  assert.ok(metrics.sampleRate >= 16_000, '配音采样率过低');
  assert.ok(metrics.durationSeconds > 0.25 && metrics.durationSeconds < 120, '配音时长异常');
  assert.ok(metrics.rmsDbfs > -50, '配音近似静音');
  assert.ok(metrics.activeRatio > 0.01, '配音有效信号不足');
  assert.ok(metrics.clippedRatio < 0.05, '配音严重削波');
}

function assertGenerationReport(report, language, asrThreshold) {
  assert.equal(report?.schema, 't8-localization-indextts25-execution-report-v1');
  assert.equal(report.language, language);
  assert.equal(report.lineCount, 1);
  assert.equal(report.asrEnabled, true);
  assert.ok(['cpu', 'cuda'].includes(report.asrDevice), 'ASR 设备证据无效');
  assert.ok(report.durationMs > 250);
  assert.equal(Array.isArray(report.lines), true);
  assert.equal(report.lines.length, 1);
  const review = report.lines[0]?.asr;
  assert.equal(review?.enabled, true);
  assert.ok(String(review?.recognizedText || '').trim(), `${language} ASR 没有识别到文字`);
  assert.ok(Number(review?.similarity) >= asrThreshold, `${language} ASR 相似度 ${review?.similarity} 低于 ${asrThreshold}`);
  assert.equal(review?.passed, true);
}

function assertSafeSerializedReport(serialized) {
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{12,}/gu, '报告不得包含 API Key');
  assert.doesNotMatch(serialized, /[A-Za-z]:\\/gu, '报告不得包含 Windows 绝对路径');
  assert.doesNotMatch(serialized, /\/(?:Users|home|private|tmp)\//gu, '报告不得包含用户绝对路径');
}

function runProcess(executable, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(executable)} 超时`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-256 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-256 * 1024); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout).trim().slice(-2_000) || `${path.basename(executable)} 退出码 ${code}`));
    });
  });
}

async function probeAudio(filename) {
  const ffprobe = require('@ffprobe-installer/ffprobe').path;
  const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
  const probed = await runProcess(ffprobe, [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=codec_name,sample_rate,channels,duration:format=duration', '-of', 'json', filename,
  ]);
  const payload = JSON.parse(probed.stdout);
  const stream = payload.streams?.[0];
  assert.ok(stream, '输出缺少音频流');
  await runProcess(ffmpeg, ['-v', 'error', '-i', filename, '-map', '0:a:0', '-f', 'null', '-']);
  return {
    codec: String(stream.codec_name || ''),
    sampleRate: Number(stream.sample_rate || 0),
    channels: Number(stream.channels || 0),
    durationSeconds: Number(stream.duration || payload.format?.duration || 0),
    fullDecodePassed: true,
  };
}

function loadTranslationFixture(filename) {
  const payload = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const byLanguage = new Map((payload.languages || []).map((item) => [String(item.language), item]));
  return LANGUAGES.map((language) => {
    const item = byLanguage.get(language);
    assert.ok(item, `缺少 ${language} 翻译证据`);
    assert.ok(['passed', 'source-identity'].includes(item.status), `${language} 翻译未通过`);
    const translatedText = String(item.translation || '').trim();
    assert.match(translatedText, /T8/u);
    assert.match(translatedText, /2026/u);
    assert.match(translatedText, /\{count\}/u);
    return {
      language,
      translatedText,
      spokenText: translatedText.replaceAll('{count}', SPOKEN_REPLACEMENTS[language]),
    };
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureRuntimeReady(service, installRequested) {
  let receipt = await service.inspectIndexTtsRuntime();
  if (receipt.ready) return receipt;
  if (!installRequested) {
    throw new Error(`IndexTTS 2.5 运行时未就绪：${receipt.message} 如需安装，在明确接受许可证后设置 T8_INDEXTTS25_INSTALL=1。`);
  }
  service.startIndexTtsRuntimeInstall({
    modelLicenseConfirmed: true,
    source: process.env.T8_INDEXTTS25_SOURCE === 'modelscope' ? 'modelscope' : 'huggingface',
  });
  const deadline = Date.now() + 8 * 60 * 60 * 1_000;
  while (Date.now() < deadline) {
    await sleep(30_000);
    receipt = await service.inspectIndexTtsRuntime();
    process.stdout.write(`${JSON.stringify({ event: 'runtime-install', stage: receipt.install?.stage, progress: receipt.install?.progress, ready: receipt.ready })}\n`);
    if (receipt.ready) return receipt;
    if (!receipt.install?.running && receipt.install?.stage === 'error') {
      throw new Error(receipt.install?.error || receipt.message || 'IndexTTS 2.5 安装失败');
    }
  }
  throw new Error('IndexTTS 2.5 安装超过 8 小时安全上限');
}

async function buildReferenceEvidence(referenceFile) {
  const stat = await fsp.stat(referenceFile);
  assert.ok(stat.isFile() && stat.size > 44, '参考音色文件不可用');
  const pcm = inspectPcm16Wav(await fsp.readFile(referenceFile));
  assertAudioQuality(pcm);
  return {
    filename: path.basename(referenceFile),
    byteLength: stat.size,
    sha256: await sha256File(referenceFile),
    probe: await probeAudio(referenceFile),
    pcm: {
      channels: pcm.channels,
      sampleRate: pcm.sampleRate,
      bitsPerSample: pcm.bitsPerSample,
      durationSeconds: Number(pcm.durationSeconds.toFixed(3)),
      rmsDbfs: Number(pcm.rmsDbfs.toFixed(3)),
      peak: Number(pcm.peak.toFixed(6)),
      activeRatio: Number(pcm.activeRatio.toFixed(6)),
      clippedRatio: Number(pcm.clippedRatio.toFixed(8)),
    },
  };
}

async function writeReport(filename, report) {
  const serialized = JSON.stringify(report, null, 2);
  assertSafeSerializedReport(serialized);
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  await fsp.writeFile(filename, `${serialized}\n`, 'utf8');
}

async function archivePriorFailedReport(filename) {
  try {
    const source = await fsp.readFile(filename, 'utf8');
    const parsed = JSON.parse(source);
    if (parsed?.passed !== false) return '';
    const archived = path.join(path.dirname(filename), `indextts-five-language-failure-${sha256(source).slice(0, 12)}.json`);
    await fsp.writeFile(archived, source, { encoding: 'utf8', flag: 'wx' }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
    return path.basename(archived);
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return '';
    throw error;
  }
}

async function main() {
  const preflightOnly = process.argv.includes('--preflight') || process.env.T8_INDEXTTS25_PREFLIGHT === '1';
  const referenceFile = path.resolve(process.env.T8_INDEXTTS25_REFERENCE || DEFAULT_REFERENCE);
  const translationsFile = path.resolve(process.env.T8_INDEXTTS25_TRANSLATIONS || DEFAULT_TRANSLATIONS);
  const translations = loadTranslationFixture(translationsFile);
  const reference = await buildReferenceEvidence(referenceFile);
  if (preflightOnly) {
    const output = path.join(ARTIFACT_DIR, 'indextts-five-language-preflight.json');
    await writeReport(output, {
      schema: 't8-localization-indextts25-five-language-preflight-v1',
      createdAt: new Date().toISOString(),
      inferenceExecuted: false,
      licenseAcceptedForInference: false,
      licenseUrl: LICENSE_URL,
      languages: translations.map((item) => ({ language: item.language, spokenTextDigest: sha256(item.spokenText) })),
      reference,
      gates: { translationEvidence: 'passed', referenceDecode: 'passed', liveInference: 'pending-license-acceptance' },
    });
    process.stdout.write(`${JSON.stringify({ ok: true, mode: 'preflight', inferenceExecuted: false, report: path.relative(ROOT, output) })}\n`);
    return;
  }
  if (process.env.T8_INDEXTTS25_LICENSE_ACCEPTED !== '1') {
    throw new Error(`未获得明确许可，已停止下载和推理。请阅读 ${LICENSE_URL} 后设置 T8_INDEXTTS25_LICENSE_ACCEPTED=1。`);
  }

  const config = require('../backend/src/config.js');
  const service = require('../backend/src/services/localizationMaster.js');
  const runId = String(process.env.T8_INDEXTTS25_RUN_ID || 'five-language-live-20260829-v1').replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 80);
  const asrThreshold = Math.max(0.4, Math.min(0.95, Number(process.env.T8_INDEXTTS25_ASR_THRESHOLD || 0.6)));
  const runtime = await ensureRuntimeReady(service, process.env.T8_INDEXTTS25_INSTALL === '1');
  const results = [];
  const completedJobs = [];
  try {
    for (const item of translations) {
      process.stdout.write(`${JSON.stringify({ event: 'language-start', language: item.language })}\n`);
      const input = {
        modelLicenseConfirmed: true,
        jobKey: `localization-master-live/${runId}/${item.language}/${reference.sha256}/${sha256(item.spokenText)}`,
        language: item.language,
        units: [{
          index: 1,
          role: 'Narrator',
          translatedText: item.spokenText,
          pronunciation: PRONUNCIATION_OVERRIDES[item.language] || '',
          startMs: 0,
          endMs: 12_000,
        }],
        roles: [{ role: 'Narrator', referenceUrl: referenceFile, consentConfirmed: true }],
        timelinePolicy: 'shift', timingMode: 'natural', asrEnabled: true, asrRetryCount: 1,
        asrThreshold, subtitleTimingMode: 'actual', subtitleTextMode: 'original', subtitleIncludeRole: true,
        postprocessPreset: 'voice_clarity', postprocessStrength: 0.5, seed: LANGUAGE_SEEDS[item.language],
      };
      try {
        const generated = await service.runIndexTtsDialogue(input);
        assert.equal(generated.schema, 't8-localization-tts-result-v2');
        assert.equal(generated.requiresComfyUI, false);
        assertGenerationReport(generated.generationReport, item.language, asrThreshold);
        const audioFile = resolveOutputUrl(generated.audioUrl, config.OUTPUT_DIR);
        const subtitleFile = resolveOutputUrl(generated.subtitleUrl, config.OUTPUT_DIR);
        const [audioStat, subtitleStat, audioHash, subtitleHash, audioBuffer, subtitleText, decode] = await Promise.all([
          fsp.stat(audioFile), fsp.stat(subtitleFile), sha256File(audioFile), sha256File(subtitleFile),
          fsp.readFile(audioFile), fsp.readFile(subtitleFile, 'utf8'), probeAudio(audioFile),
        ]);
        assert.equal(audioStat.size, generated.byteLength);
        assert.equal(subtitleStat.size, generated.subtitleByteLength);
        assert.equal(audioHash, generated.sha256);
        assert.equal(subtitleHash, generated.subtitleSha256);
        assert.match(subtitleText, /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/u);
        assert.match(subtitleText, /\[Narrator\]/u);
        const pcm = inspectPcm16Wav(audioBuffer);
        assertAudioQuality(pcm);
        assert.equal(decode.channels, 1);
        assert.ok(decode.sampleRate >= 16_000 && decode.durationSeconds > 0.25);
        const review = generated.generationReport.lines[0].asr;
        const result = {
          language: item.language,
          status: 'generated-verified',
          jobId: generated.jobId,
          initialCallReused: generated.reused === true,
          sourceTranslationDigest: sha256(item.translatedText),
          spokenTextDigest: sha256(item.spokenText),
          audio: {
            filename: path.basename(audioFile), byteLength: audioStat.size, sha256: audioHash,
            codec: decode.codec, sampleRate: decode.sampleRate, channels: decode.channels,
            durationSeconds: Number(decode.durationSeconds.toFixed(3)), fullDecodePassed: true,
            rmsDbfs: Number(pcm.rmsDbfs.toFixed(3)), peak: Number(pcm.peak.toFixed(6)),
            activeRatio: Number(pcm.activeRatio.toFixed(6)), clippedRatio: Number(pcm.clippedRatio.toFixed(8)),
          },
          subtitle: { filename: path.basename(subtitleFile), byteLength: subtitleStat.size, sha256: subtitleHash, timingVerified: true },
          asr: {
            recognizedText: String(review.recognizedText), similarity: Number(review.similarity),
            passed: review.passed === true, attemptCount: Number(generated.generationReport.lines[0].attemptCount || 0),
            device: generated.generationReport.asrDevice,
          },
          recovery: { workerStoppedBeforeReuse: false, secondCallReused: false, sameHashes: false, inspectedComplete: false, outputVerified: false },
        };
        results.push(result);
        completedJobs.push({ input, generated, result });
        process.stdout.write(`${JSON.stringify({ event: 'language-generated', language: item.language, jobId: generated.jobId, initiallyReused: generated.reused === true, asrSimilarity: review.similarity })}\n`);
      } catch (error) {
        results.push({
          language: item.language,
          status: 'failed',
          sourceTranslationDigest: sha256(item.translatedText),
          spokenTextDigest: sha256(item.spokenText),
          error: sanitizeError(error),
        });
        process.stdout.write(`${JSON.stringify({ event: 'language-failed', language: item.language, error: sanitizeError(error) })}\n`);
      }
    }
    service.stopWorker('五语生成阶段已完成，正在验证重启后的物理结果复用。');
    for (const job of completedJobs) {
      try {
        const reused = await service.runIndexTtsDialogue(job.input);
        assert.equal(reused.reused, true, `${job.result.language} 重启后未复用已校验结果`);
        assert.equal(reused.jobId, job.generated.jobId);
        assert.equal(reused.sha256, job.generated.sha256);
        assert.equal(reused.subtitleSha256, job.generated.subtitleSha256);
        const inspected = await service.inspectIndexTtsJob(job.generated.jobId);
        assert.equal(inspected.status, 'complete');
        assert.equal(inspected.outputVerified, true);
        job.result.status = 'passed';
        job.result.recovery = {
          workerStoppedBeforeReuse: true,
          secondCallReused: true,
          sameHashes: true,
          inspectedComplete: true,
          outputVerified: true,
        };
        process.stdout.write(`${JSON.stringify({ event: 'language-recovery-complete', language: job.result.language, jobId: job.generated.jobId })}\n`);
      } catch (error) {
        job.result.status = 'failed';
        job.result.recoveryError = sanitizeError(error);
        process.stdout.write(`${JSON.stringify({ event: 'language-recovery-failed', language: job.result.language, error: sanitizeError(error) })}\n`);
      }
    }
    const passed = results.length === LANGUAGES.length && results.every((item) => item.status === 'passed');
    const inferenceExecutedThisRun = results.some((item) => item.status === 'passed' && item.initialCallReused === false);
    const output = path.join(ARTIFACT_DIR, 'indextts-five-language-report.json');
    const priorFailureEvidence = await archivePriorFailedReport(output);
    await writeReport(output, {
      schema: 't8-localization-indextts25-five-language-live-report-v1',
      createdAt: new Date().toISOString(), runId, passed, inferenceExecutedThisRun,
      verifiedPersistedInference: results.some((item) => item.status === 'passed' && item.initialCallReused === true),
      languageCount: results.length,
      license: { acceptedForThisRun: true, url: LICENSE_URL },
      runtime: {
        engine: 'embedded-index-tts-2.5', requiresComfyUI: false, modelRepository: runtime.modelRepository,
        modelRevision: runtime.modelRevision, modelFingerprint: runtime.modelFingerprint,
        device: runtime.device, deviceName: runtime.deviceName, torchVersion: runtime.torchVersion,
      },
      reference,
      ...(priorFailureEvidence ? { priorFailureEvidence } : {}),
      languages: results,
      gates: {
        realInference: passed ? 'passed' : 'failed', fiveLanguages: passed ? 'passed' : 'failed',
        asr: passed ? 'passed' : 'failed', fullDecode: passed ? 'passed' : 'failed',
        pcmSignal: passed ? 'passed' : 'failed', subtitles: passed ? 'passed' : 'failed',
        physicalHashes: passed ? 'passed' : 'failed', restartSafeReuse: passed ? 'passed' : 'failed',
      },
      apiKeyPersisted: false, rawWorkerResponsePersisted: false, localAbsolutePathsPersisted: false,
    });
    assert.equal(passed, true, `五语验收未全部通过，失败证据已写入 ${path.basename(output)}`);
    process.stdout.write(`${JSON.stringify({ ok: true, report: path.relative(ROOT, output), languages: LANGUAGES })}\n`);
  } finally {
    service.stopWorker();
  }
}

module.exports = {
  LANGUAGES,
  assertAudioQuality,
  assertGenerationReport,
  assertSafeSerializedReport,
  archivePriorFailedReport,
  inspectPcm16Wav,
  loadTranslationFixture,
  resolveOutputUrl,
  sanitizeError,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${sanitizeError(error)}\n`);
    process.exitCode = 1;
  });
}
