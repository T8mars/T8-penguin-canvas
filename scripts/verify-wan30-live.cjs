'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ProxyAgent, fetch: undiciFetch } = require('undici');
const seedanceNz = require('../backend/src/providers/seedanceNz');

const apiKey = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
if (!apiKey) {
  console.error('SEEDANCE_NZ_API_KEY is required');
  process.exit(2);
}

const models = [
  'wan-3.0-global-i2v',
  'wan-3.0-global-r2v',
  'wan-3.0-i2v',
  'wan-3.0-r2v',
  'wan-3.0-prime-i2v',
  'wan-3.0-prime-r2v',
  'wan-3.0-global-prime-i2v',
  'wan-3.0-global-prime-r2v',
];
const root = path.resolve(__dirname, '..');
const runtimeName = process.platform === 'win32' ? '.exe' : '';
const ffmpeg = path.join(root, 'tools', 'ffmpeg-runtime', `ffmpeg${runtimeName}`);
const ffprobe = path.join(root, 'tools', 'ffmpeg-runtime', `ffprobe${runtimeName}`);
const runName = String(process.env.WAN30_LIVE_RUN || 'wan30-live-20260825').trim();
const outputDir = path.join(root, 'output', runName);
const stateFile = path.join(outputDir, 'state.private.json');
const reportFile = path.join(outputDir, 'report.json');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-wan30-'));
fs.mkdirSync(outputDir, { recursive: true });
const proxyUrl = String(process.env.SEEDANCE_NZ_PROXY_URL || '').trim();
const proxyDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
const providerFetch = proxyDispatcher
  ? (url, init = {}) => undiciFetch(url, { ...init, dispatcher: proxyDispatcher })
  : null;

function run(command, args, label, timeout = 120_000) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 500);
    throw new Error(`${label} failed: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function createFixture() {
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) throw new Error('ffmpeg/ffprobe runtime is missing');
  const image = path.join(tempDir, 'wan30-reference.png');
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x17324d:s=768x768:d=0.1',
    '-vf', 'drawbox=x=172:y=172:w=424:h=424:color=0xf1d39a:t=fill,drawbox=x=268:y=268:w=232:h=232:color=0x315a7d:t=fill',
    '-frames:v', '1', image,
  ], 'Wan 3.0 fixture image');
  return image;
}

function loadState() {
  if (!fs.existsSync(stateFile)) return { tasks: {} };
  const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return parsed && typeof parsed === 'object' && parsed.tasks ? parsed : { tasks: {} };
}

function saveState(state) {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function requestFor(model, image) {
  const isI2v = model.endsWith('-i2v');
  return {
    model,
    prompt: isI2v
      ? 'A geometric paper sculpture slowly rotates while the camera gently pushes in; preserve identity, composition and materials.'
      : 'Use the reference sculpture as the exact subject identity; create a coherent slow cinematic push-in with stable materials and no text.',
    duration: 2,
    resolution: '480P',
    ratio: 'adaptive',
    images: [image],
    generateAudio: false,
    enableThinking: false,
    seed: 0,
  };
}

function tencentCosFallbackUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !hostname.endsWith('.myqcloud.com') || !hostname.includes('.cos.')) {
    return null;
  }
  parsed.hostname = `${hostname.slice(0, -'.myqcloud.com'.length)}.tencentcos.cn`;
  return parsed.toString();
}

async function poll(model, taskId, state) {
  const deadline = Date.now() + 60 * 60 * 1000;
  let previous = '';
  while (Date.now() < deadline) {
    const result = await seedanceNz.queryTask(taskId, apiKey, providerFetch ? { fetchImpl: providerFetch } : {});
    const line = `${result.status}:${result.progress || ''}`;
    if (line !== previous) console.log(`[live:${model}] ${line}`);
    previous = line;
    if (result.status === 'failed') {
      state.tasks[model].status = 'failed';
      saveState(state);
      throw new Error(`${model} failed at provider`);
    }
    if (result.status === 'succeeded') {
      if (!result.videoUrl) throw new Error(`${model} succeeded without a result URL`);
      state.tasks[model].status = 'succeeded';
      state.tasks[model].url = result.videoUrl;
      saveState(state);
      return result.videoUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }
  throw new Error(`${model} timed out`);
}

async function downloadAndValidate(model, url) {
  const file = path.join(outputDir, `${model}.mp4`);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1024) {
    let response;
    let lastError;
    const urls = [url, tencentCosFallbackUrl(url)].filter(Boolean);
    for (let attempt = 0; attempt < 5 && !response?.ok; attempt += 1) {
      for (const candidate of urls) {
        try {
          response = providerFetch
            ? await providerFetch(candidate, { headers: { Accept: 'video/mp4,video/webm,video/*,*/*;q=0.8' } })
            : await seedanceNz.fetchRemote(candidate, { headers: { Accept: 'video/mp4,video/webm,video/*,*/*;q=0.8' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          break;
        } catch (error) {
          lastError = error;
          response = null;
        }
      }
      if (!response?.ok && attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1500 * (2 ** attempt)));
    }
    if (!response?.ok) throw lastError || new Error(`${model} output download failed`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error(`${model} output is empty`);
    fs.writeFileSync(file, buffer);
  }
  const buffer = fs.readFileSync(file);
  const probe = JSON.parse(run(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration,size',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-of', 'json', file,
  ], `${model} ffprobe`));
  const video = Array.isArray(probe.streams) ? probe.streams.find((item) => item.codec_type === 'video') : null;
  const media = {
    format: probe.format?.format_name || null,
    duration: Number(probe.format?.duration || 0),
    codec: video?.codec_name || null,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
  };
  if (!media.duration || !media.codec || !media.width || !media.height) throw new Error(`${model} video decode failed`);
  return {
    file: path.relative(root, file).replace(/\\/g, '/'),
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    media,
  };
}

function writeReport(results, status, blocker) {
  const report = {
    ok: status === 'completed' && results.length === models.length,
    status,
    verifiedAt: new Date().toISOString(),
    provider: 'seedance-nz',
    officialDocs: 'https://api.seedance.nz/docs/llms.txt',
    catalogTaskCount: models.length,
    taskCount: results.length,
    credentialsPersisted: false,
    taskIdsPersisted: false,
    signedUrlsPersisted: false,
    results,
    ...(blocker ? { blocker } : {}),
  };
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const image = createFixture();
  const state = loadState();
  const results = [];
  for (const model of models) {
    let entry = state.tasks[model];
    if (!entry?.taskId) {
      console.log(`[live:${model}] submitting`);
      const submitted = await seedanceNz.submitWanTask(requestFor(model, image), apiKey, {
        uploadIntervalMs: 0,
        submissionKey: crypto.createHash('sha256').update(`${runName}:${model}`).digest('hex'),
        ...(providerFetch ? { fetchImpl: providerFetch } : {}),
      });
      entry = { taskId: submitted.taskId, taskType: submitted.taskType, status: 'submitted' };
      state.tasks[model] = entry;
      saveState(state);
      console.log(`[live:${model}] accepted as ${submitted.taskType}`);
    }
    const url = entry.status === 'succeeded' && entry.url ? entry.url : await poll(model, entry.taskId, state);
    const output = await downloadAndValidate(model, url);
    results.push({ model, taskType: entry.taskType, status: 'succeeded', output });
    writeReport(results, 'in_progress');
    console.log(`[live:${model}] downloaded and decoded`);
  }
  writeReport(results, 'completed');
  fs.rmSync(stateFile, { force: true });
  console.log(`[live] verified ${results.length}/${models.length}; report: ${path.relative(root, reportFile)}`);
}

main()
  .catch((error) => {
    writeReport([], 'blocked', { type: 'verification_error', reason: String(error?.code || error?.name || 'unknown').slice(0, 96) });
    console.error(`[live] ${String(error?.message || error).replaceAll(apiKey, '[redacted]').slice(0, 500)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await proxyDispatcher?.close();
  });
