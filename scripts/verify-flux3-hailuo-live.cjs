const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const seedanceNz = require('../backend/src/providers/seedanceNz');

const apiKey = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
if (!apiKey) {
  console.error('SEEDANCE_NZ_API_KEY is required');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const runtimeName = process.platform === 'win32' ? '.exe' : '';
const ffmpeg = path.join(root, 'tools', 'ffmpeg-runtime', `ffmpeg${runtimeName}`);
const ffprobe = path.join(root, 'tools', 'ffmpeg-runtime', `ffprobe${runtimeName}`);
const runName = String(process.env.FLUX3_HAILUO_LIVE_RUN || 'flux3-hailuo-live-20260808').trim();
const outputDir = path.join(root, 'output', runName);
const stateFile = path.join(outputDir, 'state.private.json');
const reportFile = path.join(outputDir, 'report.json');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-flux3-hailuo-'));
fs.mkdirSync(outputDir, { recursive: true });
const liveResults = [];
let lastProviderRejection = null;

const catalogModels = [
  'minimax-h3-ow-i2v-fast',
  'minimax-h3-ow-r2v-fast',
  'minimax-h3-ow-ref2va-audio-drive-fast',
  'minimax-h3-ow-fl2va-audio-drive-fast',
  'minimax-h3-ow-t2v-fast',
  'hailuo-h3-t2v',
  'hailuo-h3-i2v',
  'hailuo-h3-multi',
  'hailuo-h3-global-t2v',
  'hailuo-h3-global-i2v',
  'hailuo-h3-global-multi',
  'hailuo-h3-max-t2v',
  'hailuo-h3-max-i2v',
  'hailuo-h3-max-turbo-t2v',
  'hailuo-h3-max-turbo-i2v',
  'flux-3-video-t2v',
  'flux-3-video-i2v',
  'flux-3-video-v2v',
  'flux-3-video-draft-enhance',
  'flux-3-video-global-t2v',
  'flux-3-video-global-i2v',
  'flux-3-video-global-v2v',
  'flux-3-video-global-draft-enhance',
];
const requestedModels = String(process.env.FLUX3_HAILUO_VERIFY_MODELS || '')
  .split(',').map((item) => item.trim()).filter(Boolean);
if (requestedModels.some((model) => !catalogModels.includes(model))) {
  console.error('FLUX3_HAILUO_VERIFY_MODELS contains a model outside the verified catalog');
  process.exit(2);
}
const models = requestedModels.length
  ? catalogModels.filter((model) => requestedModels.includes(model))
  : catalogModels;

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 120_000,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 500);
    throw new Error(`${label} failed: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function createFixtures() {
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) throw new Error('ffmpeg/ffprobe runtime is missing');
  const image = path.join(tempDir, 'reference.png');
  const video = path.join(tempDir, 'reference.mp4');
  const audio = path.join(tempDir, 'reference.wav');
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x17324d:s=768x768:d=0.1',
    '-vf', 'drawbox=x=172:y=172:w=424:h=424:color=0xf1d39a:t=fill,drawbox=x=268:y=268:w=232:h=232:color=0x315a7d:t=fill',
    '-frames:v', '1', image,
  ], 'reference image');
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x17324d:s=480x270:d=5:r=24',
    '-vf', 'drawbox=x=70+40*t:y=85:w=100:h=100:color=0xf1d39a:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', video,
  ], 'reference video');
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'pcm_s16le', audio,
  ], 'reference audio');
  return { image, video, audio };
}

function loadState() {
  if (!fs.existsSync(stateFile)) return { tasks: {}, history: {}, appliedRetryTokens: {} };
  const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return parsed && typeof parsed === 'object' && parsed.tasks
    ? parsed
    : { tasks: {}, history: {}, appliedRetryTokens: {} };
}

function saveState(state) {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function applyExplicitRetry(state) {
  const token = String(process.env.FLUX3_HAILUO_RETRY_TOKEN || '').trim();
  const requested = String(process.env.FLUX3_HAILUO_RETRY_MODELS || '')
    .split(',').map((item) => item.trim()).filter(Boolean);
  if (!token || requested.length === 0) return;
  if (requested.some((model) => !catalogModels.includes(model))) throw new Error('retry model is outside the verified catalog');
  state.appliedRetryTokens ||= {};
  if (state.appliedRetryTokens[token]) return;
  state.history ||= {};
  for (const model of requested) {
    if (!state.tasks[model]?.taskId) throw new Error(`${model} has no previous accepted task to retry`);
    state.history[model] ||= [];
    state.history[model].push(state.tasks[model]);
    delete state.tasks[model];
  }
  state.appliedRetryTokens[token] = requested;
  saveState(state);
}

function isFlux(model) {
  return model.startsWith('flux-3-video');
}

function taskTypeFor(model) {
  if (model.endsWith('-draft-enhance')) return 'draft-enhance';
  if (model.endsWith('-multi')) return 'multi';
  if (model.includes('-audio-drive-')) return 'multi';
  if (model.includes('-r2v')) return 'r2v';
  if (model.includes('-i2v')) return 'i2v';
  if (model.endsWith('-v2v')) return 'v2v';
  return 't2v';
}

function draftSourceModel(model) {
  return model.includes('-global-') ? 'flux-3-video-global-t2v' : 'flux-3-video-t2v';
}

function requestFor(model, fixtures, state) {
  if (!isFlux(model)) {
    const isMinimaxFast = model.startsWith('minimax-h3-ow-') && model.endsWith('-fast');
    const isHailuoH3Max = model.startsWith('hailuo-h3-max-');
    const isHailuoH3MaxTurbo = model.startsWith('hailuo-h3-max-turbo-');
    const common = {
      model,
      duration: 5,
      resolution: isMinimaxFast || isHailuoH3MaxTurbo ? '480p' : isHailuoH3Max ? '480P' : '768P',
    };
    if (model.includes('-audio-drive-')) {
      return {
        ...common,
        ratio: '16:9',
        prompt: 'Preserve the paper sculpture identity and drive a natural expressive performance with the connected audio.',
        images: [fixtures.image],
        audios: [fixtures.audio],
      };
    }
    if (model.includes('-i2v')) {
      return {
        ...common,
        ...(isMinimaxFast ? { ratio: '16:9' } : {}),
        prompt: 'The geometric paper sculpture gently rotates while the camera slowly pushes in; preserve identity and composition.',
        images: [fixtures.image],
      };
    }
    if (model.includes('-r2v')) {
      return {
        ...common,
        ratio: '16:9',
        prompt: 'Preserve the reference sculpture identity and materials while the camera slowly pushes in.',
        images: [fixtures.image],
      };
    }
    if (model.endsWith('-multi')) {
      return {
        ...common,
        ratio: 'adaptive',
        prompt: 'Keep @Image 1 as the subject identity, follow @Video 1 camera rhythm, and synchronize motion accents with @Audio 1.',
        images: [fixtures.image],
        videos: [fixtures.video],
        audios: [fixtures.audio],
      };
    }
    return {
      ...common,
      ratio: '16:9',
      prompt: 'A geometric paper sculpture gently rotates in a clean blue studio while the camera slowly pushes in, coherent cinematic lighting, no text.',
    };
  }

  // Keep the paid smoke on the documented required contract. Optional audio and
  // safety fields have their own offline payload coverage and are deliberately
  // omitted here so Draft Enhance replays only the source task's opaque cache.
  const common = { model, duration: 5, resolution: 'hd', ratio: '16:9' };
  if (model.endsWith('-draft-enhance')) {
    const source = draftSourceModel(model);
    const draftCache = String(state.tasks[source]?.draftCache || '').trim();
    if (!draftCache) throw new Error(`${model} requires completed draft_cache from ${source}`);
    return { ...common, draftCache };
  }
  if (model.endsWith('-i2v')) {
    return { ...common, prompt: 'Slow cinematic push in while preserving the paper sculpture identity.', images: [fixtures.image] };
  }
  if (model.endsWith('-v2v')) {
    return { ...common, prompt: 'Preserve the motion and replace the background with a clean cinematic paper studio.', videos: [fixtures.video] };
  }
  return {
    ...common,
    draft: true,
    prompt: 'A geometric paper sculpture rotates on a clean blue studio turntable, slow cinematic push in, coherent lighting, no text.',
  };
}

async function submitWithAcceptedResponseRecovery(model, request) {
  let accepted = null;
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const isSubmission = init?.method === 'POST' && parsed.pathname === '/v1/videos';
    const headers = new Headers(init?.headers);
    if (isSubmission) {
      headers.set('Idempotency-Key', crypto.createHash('sha256')
        .update(`${runName}:${model}:${JSON.stringify(request)}`).digest('hex'));
    }
    const response = await globalThis.fetch(url, { ...init, headers });
    if (isSubmission) {
      const body = await response.clone().text();
      let data = null;
      try { data = JSON.parse(body); } catch {}
      accepted = { ok: response.ok, status: response.status, data, bodyBytes: Buffer.byteLength(body) };
    }
    return response;
  };

  const submit = isFlux(model) ? seedanceNz.submitFlux3Task : seedanceNz.submitHailuoTask;
  try {
    return await submit(request, apiKey, { fetchImpl, uploadIntervalMs: 0 });
  } catch (error) {
    const taskId = String(accepted?.data?.id || accepted?.data?.task_id || accepted?.data?.data?.id || '').trim();
    const status = String(accepted?.data?.status || accepted?.data?.data?.status || '').trim().toLowerCase();
    const safeOpaqueId = taskId.length > 0 && taskId.length <= 512
      && !/[\u0000-\u0020\u007f]/.test(taskId) && !taskId.includes(apiKey) && !/^https?:\/\//i.test(taskId);
    if (accepted && !accepted.ok) {
      const upstreamCode = String(
        accepted.data?.code
        || accepted.data?.error?.code
        || accepted.data?.data?.code
        || '',
      ).trim().slice(0, 96);
      const upstreamMessage = String(
        accepted.data?.message
        || accepted.data?.error?.message
        || accepted.data?.data?.message
        || '',
      ).trim()
        .replaceAll(apiKey, '[redacted]')
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .replace(/[A-Za-z0-9_\-+/=]{96,}/g, '[redacted-opaque]')
        .slice(0, 240);
      lastProviderRejection = {
        httpStatus: accepted.status,
        code: upstreamCode || 'missing',
        reason: upstreamMessage || 'missing',
        model,
      };
      console.error(`[live:${model}] rejected http=${accepted.status} code=${upstreamCode || 'missing'} reason=${upstreamMessage || 'missing'}`);
    }
    if (error?.code !== 'SEEDANCE_INVALID_RESPONSE' || !accepted?.ok || !safeOpaqueId
      || !['queued', 'pending', 'in_progress', 'processing', 'submitted'].includes(status)) throw error;
    console.log(`[live:${model}] recovered accepted response after bounded-reader rejection (${accepted.bodyBytes} bytes)`);
    return { taskId, taskType: taskTypeFor(model), model };
  }
}

async function poll(model, entry, state) {
  const deadline = Date.now() + 60 * 60 * 1000;
  let previous = '';
  while (Date.now() < deadline) {
    const result = await seedanceNz.queryTask(entry.taskId, apiKey);
    const line = `${result.status}:${result.progress || ''}`;
    if (line !== previous) console.log(`[live:${model}] ${line}`);
    previous = line;
    if (result.status === 'failed') {
      state.tasks[model].status = 'failed';
      state.tasks[model].failReason = result.failReason || 'unknown provider error';
      saveState(state);
      throw new Error(`${model} failed: ${result.failReason || 'unknown provider error'}`);
    }
    if (result.status === 'succeeded') {
      if (!result.videoUrl) throw new Error(`${model} succeeded without a result URL`);
      state.tasks[model].status = 'succeeded';
      state.tasks[model].url = result.videoUrl;
      state.tasks[model].draftCache = result.draftCache || null;
      saveState(state);
      return result.videoUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }
  throw new Error(`${model} timed out`);
}

function downloadAndValidate(model, url) {
  const file = path.join(outputDir, `${model}.mp4`);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1024) {
    const partial = `${file}.partial-${process.pid}`;
    fs.rmSync(partial, { force: true });
    run(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--fail', '--silent', '--show-error', '--location',
      '--retry', '5', '--retry-all-errors', '--retry-delay', '2',
      '--connect-timeout', '30', '--max-time', '900',
      '--output', partial, url,
    ], `${model} output download`, { timeout: 920_000 });
    if (!fs.existsSync(partial) || fs.statSync(partial).size < 1024) throw new Error(`${model} output is empty`);
    fs.rmSync(file, { force: true });
    fs.renameSync(partial, file);
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
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-map', '0:v:0',
    '-f', 'null', '-',
  ], `${model} full video decode`, { timeout: 920_000 });
  return {
    file: path.relative(root, file).replace(/\\/g, '/'),
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    media,
    fullDecodeVerified: true,
  };
}

function writeSanitizedReport(ok, status, blocker = null) {
  const report = {
    ok,
    status,
    verifiedAt: new Date().toISOString(),
    provider: 'seedance-nz',
    officialDocs: {
      url: 'https://api.seedance.nz/docs/llms.txt',
      sha256: '9da7fb9abf0f87b2c6041d1f7ddcb6c8c90f24bde0a05eb9b5aa875a5bc3c033',
      lastModified: 'Thu, 03 Sep 2026 15:44:49 GMT',
    },
    taskCount: liveResults.length,
    catalogTaskCount: catalogModels.length,
    credentialsPersisted: false,
    results: liveResults,
    ...(blocker ? { blocker } : {}),
  };
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const fixtures = createFixtures();
  const state = loadState();
  applyExplicitRetry(state);

  for (const model of models) {
    let entry = state.tasks[model];
    if (!entry?.taskId) {
      console.log(`[live:${model}] submitting`);
      const submitted = await submitWithAcceptedResponseRecovery(model, requestFor(model, fixtures, state));
      entry = { taskId: submitted.taskId, taskType: submitted.taskType, status: 'submitted' };
      state.tasks[model] = entry;
      saveState(state);
      console.log(`[live:${model}] accepted as ${submitted.taskType}`);
    }
    const url = entry.status === 'succeeded' && entry.url ? entry.url : await poll(model, entry, state);
    if (entry.status === 'succeeded' && isFlux(model) && model.endsWith('-t2v') && !entry.draftCache) {
      const refreshed = await seedanceNz.queryTask(entry.taskId, apiKey);
      entry.draftCache = refreshed.draftCache || null;
      saveState(state);
    }
    const output = downloadAndValidate(model, url);
    liveResults.push({
      model,
      taskType: entry.taskType || taskTypeFor(model),
      status: 'succeeded',
      attempts: 1 + (state.history?.[model]?.length || 0),
      output,
    });
    writeSanitizedReport(false, 'in_progress');
    console.log(`[live:${model}] downloaded and decoded`);
  }

  const ok = liveResults.length === models.length && liveResults.every((item) => item.status === 'succeeded');
  writeSanitizedReport(ok, ok ? 'completed' : 'incomplete');
  console.log(`[live] verified ${liveResults.length}/${models.length} models; sanitized report: ${path.relative(root, reportFile)}`);
}

main()
  .catch((error) => {
    writeSanitizedReport(false, 'blocked', lastProviderRejection
      ? { type: 'provider_rejected', ...lastProviderRejection }
      : { type: 'verification_error', reason: String(error?.code || 'unknown').slice(0, 96) });
    console.error(`[live] ${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
