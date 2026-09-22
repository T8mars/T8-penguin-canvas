'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { Writable } = require('node:stream');
const sharp = require('sharp');
const provider = require('../backend/src/providers/seedanceNz');
const { safeRemoteMediaFetch } = require('../backend/src/utils/safeRemoteMediaFetch');

const BASE_URL = 'https://api.seedance.nz';
const REQUEST_DEADLINE_MS = 15 * 60_000;
const TASK_DEADLINE_MS = 45 * 60_000;
const POLL_INTERVAL_MS = 10_000;
let runtimeApiKey = '';
let activeReport = null;
let activeReportPath = '';

function readSecretLine() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      const input = readline.createInterface({ input: process.stdin, output, terminal: true });
      input.question('', (line) => { input.close(); process.stdout.write('\n'); resolve(String(line || '').trim()); });
      return;
    }
    const input = readline.createInterface({ input: process.stdin, terminal: false });
    input.once('line', (line) => { input.close(); resolve(String(line || '').trim()); });
  });
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sanitizeError(error, apiKey) {
  let text = String(error?.message || error || 'unknown error');
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  return text
    .replace(/https?:\/\/[^\s"']+/g, '[remote-url]')
    .slice(0, 1200);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcessBuffer(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve(Buffer.concat(stdout))
      : reject(new Error(`media tool exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-800)}`)));
  });
}

async function runProcess(executable, args) {
  return (await runProcessBuffer(executable, args)).toString('utf8');
}

async function createFixtures(directory) {
  const imagePath = path.join(directory, 'reference.png');
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <rect width="512" height="512" fill="#10273d"/>
      <circle cx="256" cy="205" r="104" fill="#f2f6f7"/>
      <ellipse cx="220" cy="194" rx="12" ry="16" fill="#16202a"/>
      <ellipse cx="292" cy="194" rx="12" ry="16" fill="#16202a"/>
      <path d="M226 245 Q256 268 286 245" fill="none" stroke="#f6a623" stroke-width="16" stroke-linecap="round"/>
      <rect x="126" y="346" width="260" height="74" rx="18" fill="#19b7ad"/>
      <text x="256" y="394" text-anchor="middle" font-family="Arial" font-size="32" fill="#07151d">T8 LIVE</text>
    </svg>`);
  await sharp(svg).png().toFile(imagePath);

  const videoPath = path.join(directory, 'motion.mp4');
  const ffmpeg = path.resolve('tools', 'ffmpeg-runtime', 'ffmpeg.exe');
  await runProcess(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=512x512:rate=24:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
  ]);
  return { imagePath, videoPath };
}

async function download(url) {
  try {
    const response = await safeRemoteMediaFetch(url, {
      trustedProviderOutput: true,
      maxBytes: 256 * 1024 * 1024,
      connectTimeoutMs: REQUEST_DEADLINE_MS,
      deadlineMs: REQUEST_DEADLINE_MS,
      idleTimeoutMs: REQUEST_DEADLINE_MS,
      maxRedirects: 5,
      accept: 'image/*,video/*,application/octet-stream;q=0.5',
      userAgent: 'T8-Qwen21-Animate-Live/1.0',
    });
    return response.buffer;
  } catch (safeFetchError) {
    try {
      return await runProcessBuffer('curl.exe', [
        '--fail', '--location', '--silent', '--show-error',
        '--connect-timeout', '60', '--max-time', String(REQUEST_DEADLINE_MS / 1000),
        '--max-filesize', String(256 * 1024 * 1024), url,
      ]);
    } catch (systemFetchError) {
      systemFetchError.cause = safeFetchError;
      throw systemFetchError;
    }
  }
}

async function attachOutputEvidence(result, downloader, url) {
  try {
    result.output = await downloader(await download(url));
    result.outputValidated = true;
  } catch (error) {
    result.outputValidated = false;
    result.outputValidationError = sanitizeError(error, runtimeApiKey);
  }
  persistReport();
}

function selectedPhases() {
  const allowed = new Set(['t2i', 'i2i', 'animate']);
  const raw = String(process.env.QWEN21_ANIMATE_LIVE_PHASES || 't2i,i2i,animate');
  const phases = raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!phases.length || phases.some((phase) => !allowed.has(phase))) {
    throw new Error('QWEN21_ANIMATE_LIVE_PHASES must contain only t2i,i2i,animate');
  }
  return new Set(phases);
}

function persistReport() {
  if (!activeReport || !activeReportPath) return;
  fs.writeFileSync(activeReportPath, `${JSON.stringify(activeReport, null, 2)}\n`);
}

async function pollImage(taskId, apiKey, label) {
  const started = Date.now();
  let polls = 0;
  while (Date.now() - started < TASK_DEADLINE_MS) {
    polls += 1;
    const result = await provider.queryImageTask(taskId, apiKey, { baseUrl: BASE_URL });
    process.stdout.write(`${JSON.stringify({ phase: label, poll: polls, status: result.status })}\n`);
    if (result.status === 'failed') throw new Error(`${label} failed: ${result.failReason || 'provider failure'}`);
    if (result.status === 'succeeded') {
      if (!result.imageUrl) throw new Error(`${label} succeeded without image URL`);
      return { url: result.imageUrl, polls, durationMs: Date.now() - started, usagePresent: Boolean(result.usage) };
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} exceeded task deadline`);
}

async function pollAnimate(taskId, apiKey) {
  const started = Date.now();
  let polls = 0;
  while (Date.now() - started < TASK_DEADLINE_MS) {
    polls += 1;
    const result = await provider.queryAnimateMotionTransferTask(taskId, apiKey, { baseUrl: BASE_URL });
    process.stdout.write(`${JSON.stringify({ phase: 'animate-poll', poll: polls, status: result.status })}\n`);
    if (result.status === 'failed') throw new Error(`animate failed: ${result.failReason || 'provider failure'}`);
    if (result.status === 'succeeded') {
      if (!result.videoUrl) throw new Error('animate succeeded without video URL');
      return { url: result.videoUrl, polls, durationMs: Date.now() - started, usagePresent: Boolean(result.usage) };
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('animate exceeded task deadline');
}

async function imageEvidence(bytes, filename) {
  const metadata = await sharp(bytes).metadata();
  fs.writeFileSync(filename, bytes);
  return { bytes: bytes.length, sha256: hash(bytes), width: metadata.width || 0, height: metadata.height || 0, format: metadata.format || '' };
}

async function videoEvidence(bytes, filename) {
  fs.writeFileSync(filename, bytes);
  const ffprobe = path.resolve('tools', 'ffmpeg-runtime', 'ffprobe.exe');
  const raw = await runProcess(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt:format=duration', '-of', 'json', filename,
  ]);
  const parsed = JSON.parse(raw);
  const stream = parsed?.streams?.[0] || {};
  return {
    bytes: bytes.length,
    sha256: hash(bytes),
    codec: String(stream.codec_name || ''),
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    durationSeconds: Number(parsed?.format?.duration) || 0,
  };
}

async function main() {
  const apiKey = String(process.env.SEEDANCE_API_KEY || await readSecretLine()).trim();
  if (!apiKey) throw new Error('SEEDANCE_API_KEY is required');
  runtimeApiKey = apiKey;
  const phases = selectedPhases();
  const runId = `qwen21-animate-live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outputDir = path.resolve('output', runId);
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-qwen21-animate-'));
  fs.mkdirSync(outputDir, { recursive: true });
  activeReportPath = path.join(outputDir, 'report.json');
  const report = {
    schema: 't8-qwen21-animate-live-v1',
    runId,
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    phases: [...phases],
    results: {},
  };
  activeReport = report;
  persistReport();
  try {
    const fixtures = await createFixtures(fixtureDir);

    if (phases.has('t2i')) {
      process.stdout.write(`${JSON.stringify({ phase: 'qwen-t2i-submit' })}\n`);
      const t2iSubmit = await provider.submitImageTask({
        model: 'qwen-image-global-2.1', prompt: 'A friendly futuristic penguin mascot in a clean cinematic studio, full body, detailed feathers',
        resolution: '1k', ratio: '1:1', seed: 20260922,
      }, apiKey, { baseUrl: BASE_URL });
      const t2i = await pollImage(t2iSubmit.taskId, apiKey, 'qwen-t2i-poll');
      report.results.qwenT2i = { passed: true, providerTerminalStatus: 'succeeded',
        submitHttpStatus: t2iSubmit.upstreamHttpStatus || t2iSubmit.transportHttpStatus || null,
        polls: t2i.polls, durationMs: t2i.durationMs, usagePresent: t2i.usagePresent };
      persistReport();
      await attachOutputEvidence(
        report.results.qwenT2i,
        (bytes) => imageEvidence(bytes, path.join(outputDir, 'qwen-t2i.png')),
        t2i.url,
      );
    }

    if (phases.has('i2i')) {
      process.stdout.write(`${JSON.stringify({ phase: 'qwen-i2i-submit' })}\n`);
      const i2iSubmit = await provider.submitImageTask({
        model: 'qwen-image-global-2.1', prompt: 'Keep the penguin identity and text layout, transform into a premium neon editorial poster',
        images: [fixtures.imagePath], resolution: '1k', ratio: '1:1', seed: 20260922,
      }, apiKey, { baseUrl: BASE_URL, uploadIntervalMs: 0 });
      const i2i = await pollImage(i2iSubmit.taskId, apiKey, 'qwen-i2i-poll');
      report.results.qwenI2i = { passed: true, providerTerminalStatus: 'succeeded',
        submitHttpStatus: i2iSubmit.upstreamHttpStatus || i2iSubmit.transportHttpStatus || null,
        polls: i2i.polls, durationMs: i2i.durationMs, usagePresent: i2i.usagePresent };
      persistReport();
      await attachOutputEvidence(
        report.results.qwenI2i,
        (bytes) => imageEvidence(bytes, path.join(outputDir, 'qwen-i2i.png')),
        i2i.url,
      );
    }

    if (phases.has('animate')) {
      process.stdout.write(`${JSON.stringify({ phase: 'animate-submit' })}\n`);
      const animateSubmit = await provider.submitAnimateMotionTransferTask({
        model: 'animate-motion-transfer', images: [fixtures.imagePath], videos: [fixtures.videoPath],
        resolution: '480p', ratio: 'adaptive', frameRate: 24, maxFrames: 48, skipFrames: 0,
        poseMethod: 'vitpose', normalMode: true, neckCorrection: false, poseStrength: 1,
        cameraMotion: false, cameraStrength: 1, maskMode: false, expressionStrength: 0.8, chestMotionStrength: 0.2,
      }, apiKey, { baseUrl: BASE_URL, uploadIntervalMs: 0 });
      const animate = await pollAnimate(animateSubmit.taskId, apiKey);
      report.results.animate = { passed: true, providerTerminalStatus: 'succeeded',
        submitHttpStatus: animateSubmit.upstreamHttpStatus || animateSubmit.transportHttpStatus || null,
        polls: animate.polls, durationMs: animate.durationMs, usagePresent: animate.usagePresent };
      persistReport();
      await attachOutputEvidence(
        report.results.animate,
        (bytes) => videoEvidence(bytes, path.join(outputDir, 'animate.mp4')),
        animate.url,
      );
    }

    report.completedAt = new Date().toISOString();
    report.passed = true;
    persistReport();
    process.stdout.write(`${JSON.stringify({ phase: 'complete', passed: true, reportPath: activeReportPath })}\n`);
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.passed = false;
    report.error = sanitizeError(error, apiKey);
    persistReport();
    throw error;
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ phase: 'failed', error: sanitizeError(error, runtimeApiKey) })}\n`);
  runtimeApiKey = '';
  process.exitCode = 1;
});
