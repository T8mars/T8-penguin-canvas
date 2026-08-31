'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const config = require('../config');
const { ensureRuntimeArchiveExtracted, getRuntimeArchiveInfo, getRuntimeCachePath } = require('../utils/runtimeArchive');
const { mimeFromPath, resolveMediaRef } = require('../providers/mediaResolver');

const DUBBING_LANGUAGES = new Set(['ZH', 'EN', 'JA', 'ES', 'AR']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma']);
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 8 * 60 * 60 * 1000;
// The audited repository is used only as a pinned source archive for the
// standalone IndexTTS engine. Runtime execution never contacts ComfyUI.
const ENGINE_REPOSITORY = 'T8mars/comfyui-indextts25-t8';
const ENGINE_REVISION = '642275f9b0e5e1b8bcf235a3c3b01c2f6b6cf761';
const ENGINE_ARCHIVE_SHA256 = '228794d659e69997e5e0ef0717210e0de6475125645ac18f7c9ba81555bd63f2';
const MODEL_REPOSITORY = 'IndexTeam/IndexTTS-2.5';
const MODEL_REVISION = 'c39ce5ba981572cb187443877ff559dfb246ce63';
const MODEL_LICENSE_URL = 'https://github.com/index-tts/index-tts/blob/main/LICENSE_ZH.txt';
const WORKER_PATH = path.resolve(__dirname, '..', 'tools', 'localizationRuntime', 'worker.py');
const AUXILIARY_INSTALLER_PATH = path.resolve(__dirname, '..', 'tools', 'localizationRuntime', 'download_auxiliary.py');
const AUXILIARY_MANIFEST_PATH = path.resolve(__dirname, '..', 'tools', 'localizationRuntime', 'auxiliary-models.json');

let worker = null;
let workerBuffer = '';
let workerStderr = '';
let workerSequence = 0;
const workerPending = new Map();
let generationTail = Promise.resolve();
const ttsJobPromises = new Map();
let installPromise = null;
let installController = null;
let installState = { running: false, stage: 'idle', progress: 0, message: '', error: '', startedAt: 0, finishedAt: 0 };

function runtimeLayout() {
  const root = path.join(config.BASE_DIR, 'localization-runtime', 'index-tts-2.5');
  return {
    root,
    engineRoot: path.join(root, 'engine'),
    dependenciesRoot: path.join(root, 'site-packages'),
    downloadsRoot: path.join(root, '.downloads'),
    licenseReceiptPath: path.join(root, 'model-license-receipt.json'),
    modelRoot: path.join(config.BASE_DIR, 'localization-models', 'IndexTTS-2.5'),
    cacheRoot: path.join(config.BASE_DIR, 'localization-cache'),
  };
}

function isRegularFile(filename) { try { return fs.statSync(filename).isFile(); } catch (_) { return false; } }
function isDirectory(dirname) { try { return fs.statSync(dirname).isDirectory(); } catch (_) { return false; } }

function safeOutputName(prefix, extension) {
  const clean = String(prefix || 'localization').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'localization';
  return `${clean}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${extension}`;
}
function outputPublicUrl(file) { return `/files/output/${encodeURIComponent(path.basename(file))}`; }
function boundedText(value, max, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label}不能为空。`);
  if (text.length > max) throw new Error(`${label}超过 ${max} 字符上限。`);
  return text;
}
function appendBounded(value, chunk, maximum) {
  const next = `${value}${chunk}`;
  return next.length > maximum ? next.slice(-maximum) : next;
}
function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename, { highWaterMark: 8 * 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function ttsJobIdentity(input = {}) {
  const key = String(input.jobKey || '').trim();
  return key
    ? `tts-${sha256Text(`t8-localization-tts-job-v1:${key}`).slice(0, 32)}`
    : `tts-${crypto.randomUUID().replace(/-/g, '')}`;
}

function ttsJobInputDigest(input = {}) {
  return sha256Text(JSON.stringify({
    language: String(input.language || '').trim().toUpperCase(),
    units: (Array.isArray(input.units) ? input.units : []).slice(0, 5_000).map((unit) => ({
      index: Number(unit?.index) || 0,
      role: String(unit?.role || '').slice(0, 40),
      translatedText: String(unit?.translatedText || '').slice(0, 20_000),
      pronunciation: String(unit?.pronunciation || '').slice(0, 2_000),
      emotion: String(unit?.emotion || '').slice(0, 1_000),
      startMs: Math.max(0, Number(unit?.startMs) || 0),
      endMs: Math.max(1, Number(unit?.endMs) || 1),
    })),
    roles: (Array.isArray(input.roles) ? input.roles : []).slice(0, 16).map((role) => ({
      role: String(role?.role || '').slice(0, 40),
      consentConfirmed: role?.consentConfirmed === true,
      referenceDigest: sha256Text(String(role?.referenceUrl || '')),
    })),
    timelinePolicy: input.timelinePolicy,
    timingMode: input.timingMode,
    asrEnabled: input.asrEnabled !== false,
    asrRetryCount: input.asrRetryCount,
    asrThreshold: input.asrThreshold,
    subtitleTimingMode: input.subtitleTimingMode,
    subtitleTextMode: input.subtitleTextMode,
    subtitleIncludeRole: input.subtitleIncludeRole === true,
    postprocessPreset: input.postprocessPreset,
    postprocessStrength: input.postprocessStrength,
    seed: input.seed,
  }));
}

function ttsJobPaths(jobId, options = {}) {
  const layout = runtimeLayout();
  const jobsRoot = path.resolve(options.jobsRoot || path.join(layout.cacheRoot, 'tts-jobs'));
  const outputDir = path.resolve(options.outputDir || config.OUTPUT_DIR);
  const jobDir = path.join(jobsRoot, jobId);
  return {
    jobsRoot,
    outputDir,
    jobDir,
    manifest: path.join(jobDir, 'manifest.json'),
    result: path.join(jobDir, 'result.json'),
    audio: path.join(outputDir, `localization_dub_${jobId}.wav`),
    subtitle: path.join(outputDir, `localization_dub_${jobId}.srt`),
  };
}

async function readJsonFile(filename) {
  try { return JSON.parse(await fsp.readFile(filename, 'utf8')); } catch (_) { return null; }
}

async function writeJsonAtomic(filename, value) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    await fsp.rename(temporary, filename);
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
    await fsp.rm(filename, { force: true });
    await fsp.rename(temporary, filename);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function ttsJobManifest(jobId, inputDigest, patch = {}) {
  return {
    schema: 't8-localization-tts-job-v1',
    jobId,
    inputDigest,
    status: 'prepared',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    engine: 'embedded-index-tts-2.5',
    modelRevision: MODEL_REVISION,
    requiresComfyUI: false,
    ...patch,
  };
}

async function persistedTtsResult(paths, manifest) {
  const result = await readJsonFile(paths.result);
  if (!result || result.schema !== 't8-localization-tts-result-v2') return null;
  const [audioStat, subtitleStat] = await Promise.all([
    fsp.stat(paths.audio).catch(() => null),
    fsp.stat(paths.subtitle).catch(() => null),
  ]);
  if (!audioStat?.isFile() || !subtitleStat?.isFile() || !audioStat.size || !subtitleStat.size) return null;
  const [audioSha, subtitleSha] = await Promise.all([sha256File(paths.audio), sha256File(paths.subtitle)]);
  if (audioSha !== result.sha256 || subtitleSha !== result.subtitleSha256) return null;
  return {
    ...result,
    jobId: manifest.jobId,
    reused: true,
    recovery: { schema: 't8-localization-tts-recovery-v1', status: 'verified-complete', recoveredAt: Date.now() },
  };
}

async function inspectIndexTtsJob(jobId, options = {}) {
  const normalized = String(jobId || '').trim();
  if (!/^tts-[a-f0-9]{32}$/i.test(normalized)) {
    const error = new Error('本地化配音任务 ID 无效。');
    error.code = 'LOCALIZATION_TTS_JOB_ID_INVALID';
    error.status = 400;
    throw error;
  }
  const paths = ttsJobPaths(normalized, options);
  const manifest = await readJsonFile(paths.manifest);
  if (!manifest || manifest.schema !== 't8-localization-tts-job-v1') {
    const error = new Error('本地化配音任务不存在。');
    error.code = 'LOCALIZATION_TTS_JOB_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const result = await persistedTtsResult(paths, manifest);
  return { ...manifest, result: result || undefined, outputVerified: Boolean(result) };
}

function childEnvironment(layout, engineRoot) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|AUTHORIZATION|SESSION)/i.test(key)) delete env[key];
  }
  env.PYTHONPATH = [layout.dependenciesRoot, engineRoot].filter(isDirectory).join(path.delimiter);
  env.PYTHONUTF8 = '1';
  env.PYTHONIOENCODING = 'utf-8';
  env.HF_HOME = path.join(layout.cacheRoot, 'huggingface');
  env.HUGGINGFACE_HUB_CACHE = path.join(layout.cacheRoot, 'huggingface', 'hub');
  env.TRANSFORMERS_CACHE = path.join(layout.cacheRoot, 'transformers');
  env.TORCH_HOME = path.join(layout.cacheRoot, 'torch');
  env.OMP_NUM_THREADS = '1';
  env.MKL_NUM_THREADS = '1';
  env.OPENBLAS_NUM_THREADS = '1';
  env.NUMEXPR_NUM_THREADS = '1';
  env.TOKENIZERS_PARALLELISM = 'false';
  env.HF_HUB_DISABLE_TELEMETRY = '1';
  return env;
}

function workerEnvironment(layout, engineRoot) {
  const env = childEnvironment(layout, engineRoot);
  env.HF_HUB_OFFLINE = '1';
  env.TRANSFORMERS_OFFLINE = '1';
  env.T8_INDEXTTS25_ASR_DEVICE = String(process.env.T8_INDEXTTS25_ASR_DEVICE || 'cpu').toLowerCase() === 'cuda' ? 'cuda' : 'cpu';
  return env;
}

function findCommand(name) {
  const result = spawnSync(name, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  return !result.error && result.status === 0 ? name : '';
}
function pythonCandidates() {
  const values = [];
  const injected = String(process.env.T8_INDEXTTS25_PYTHON || '').trim();
  if (injected) values.push(injected);
  const resourcesRoot = String(process.env.T8PC_RES || '').trim();
  if (process.platform === 'darwin' && resourcesRoot) {
    values.push(path.join(resourcesRoot, 'tools', 'indextts25-python', 'python', 'bin', 'python3'));
    values.push(path.join(resourcesRoot, 'tools', 'indextts25-python', 'bin', 'python3'));
  }
  if (!config.IS_PACKAGED && process.platform === 'win32') {
    values.push(path.resolve(config.BASE_DIR, 'tools', 'remove-ai-watermarks-runtime', 'python', 'python.exe'));
    values.push(path.resolve(__dirname, '..', '..', '..', 'tools', 'remove-ai-watermarks-runtime', 'python', 'python.exe'));
  }
  try {
    const info = getRuntimeArchiveInfo('remove-ai-watermarks');
    if (info.ready) {
      const root = getRuntimeCachePath('remove-ai-watermarks');
      values.push(path.join(root, 'python', 'python.exe'), path.join(root, 'python.exe'));
    }
  } catch (_) {}
  for (const value of values) if (isRegularFile(value)) return value;
  return findCommand(process.platform === 'win32' ? 'python' : 'python3');
}
function installedEngineRoot(layout = runtimeLayout()) {
  const injected = String(process.env.T8_INDEXTTS25_ENGINE_ROOT || '').trim();
  if (injected && isRegularFile(path.join(injected, 'indextts', 'infer_v2_5.py'))) return path.resolve(injected);
  return isRegularFile(path.join(layout.engineRoot, 'indextts', 'infer_v2_5.py')) ? layout.engineRoot : '';
}

function parseJsonLine(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch (_) {}
  }
  return null;
}
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd: options.cwd, env: options.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      try { child.kill('SIGKILL'); } catch (_) {}
      const error = new Error('安装已取消。');
      error.code = 'LOCALIZATION_INSTALL_ABORTED';
      finish(reject, error);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      const error = new Error('本地引擎操作超时。');
      error.code = 'LOCALIZATION_PROCESS_TIMEOUT';
      finish(reject, error);
    }, Math.max(10_000, Number(options.timeoutMs) || 10 * 60_000));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk.toString('utf8'), 512 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk.toString('utf8'), 64 * 1024); });
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) => {
      if (code === 0) finish(resolve, { code, stdout, stderr });
      else finish(reject, new Error((stderr || stdout).trim().slice(-4000) || `进程退出码 ${code}`));
    });
  });
}

async function probeRuntime(layout = runtimeLayout()) {
  const python = pythonCandidates();
  const engineRoot = installedEngineRoot(layout);
  if (!python || !engineRoot || !isRegularFile(WORKER_PATH) || !isRegularFile(AUXILIARY_MANIFEST_PATH)) {
    return { python: python || '', engineRoot: engineRoot || '', dependenciesReady: false, missingDependencies: [], modelReady: false, torch: { available: false } };
  }
  try {
    const result = await runProcess(python, [WORKER_PATH, '--engine-root', engineRoot, '--model-root', layout.modelRoot, '--probe'], {
      env: childEnvironment(layout, engineRoot), timeoutMs: 90_000,
    });
    const payload = parseJsonLine(result.stdout);
    if (!payload?.ok) throw new Error(payload?.error || '运行时探测返回异常');
    return payload.result;
  } catch (error) {
    return { python, engineRoot, dependenciesReady: false, missingDependencies: [], modelReady: false, torch: { available: false }, probeError: String(error?.message || error) };
  }
}

async function inspectIndexTtsRuntime() {
  const license = await readIndexTtsLicenseReceipt();
  const probe = await probeRuntime();
  const engineReady = !!probe.engineRoot;
  const dependenciesReady = probe.dependenciesReady === true;
  const modelReady = probe.modelReady === true;
  const auxiliaryReady = probe.auxiliaryReady === true;
  const nvidiaAvailable = hasNvidiaGpu();
  const accelerationReady = !nvidiaAvailable || probe.torch?.cudaAvailable === true;
  const ready = license.accepted && engineReady && dependenciesReady && modelReady && auxiliaryReady && accelerationReady;
  let message = 'IndexTTS 2.5 本地引擎已就绪，无需 ComfyUI。';
  if (!license.accepted) message = '请先在本机阅读并接受 IndexTTS 2.5 模型许可。许可不会写入画布或随项目传递。';
  else if (!probe.python) message = '未找到可用的内置 Python 运行时，请点击“一键安装本地引擎”。';
  else if (!engineReady) message = 'IndexTTS 2.5 推理引擎尚未安装。';
  else if (!dependenciesReady) message = `本地推理依赖尚未完成：${(probe.missingDependencies || []).join('、') || probe.probeError || '需要安装'}`;
  else if (!modelReady) message = 'IndexTTS 2.5 模型尚未下载（约 5.5GB，需先确认模型许可）。';
  else if (!auxiliaryReady) message = `IndexTTS 2.5 辅助模型尚未完成固定版本校验：${[...(probe.auxiliaryMissing || []), ...(probe.auxiliaryMismatched || [])].slice(0, 4).join('、') || '需要修复'}`;
  else if (!accelerationReady) message = '检测到 NVIDIA GPU，但当前 Torch 不是可用的 CUDA 版本，需要修复本地推理依赖。';
  return {
    schema: 't8-indextts25-runtime-receipt-v2', checkedAt: Date.now(), ready, online: true,
    licenseAccepted: license.accepted,
    ...(license.acceptedAt ? { licenseAcceptedAt: license.acceptedAt } : {}),
    engineReady, dependenciesReady, modelReady, auxiliaryReady, accelerationReady, nvidiaAvailable,
    pythonVersion: String(probe.pythonVersion || ''),
    device: probe.torch?.cudaAvailable ? 'cuda' : probe.torch?.mpsAvailable ? 'mps' : 'cpu',
    deviceName: String(probe.torch?.deviceName || ''), torchVersion: String(probe.torch?.version || ''),
    engineRepository: ENGINE_REPOSITORY, engineRevision: ENGINE_REVISION,
    modelRepository: MODEL_REPOSITORY, modelRevision: MODEL_REVISION, modelLicenseUrl: MODEL_LICENSE_URL,
    modelFingerprint: String(probe.modelFingerprint || ''),
    auxiliaryFingerprint: String(probe.auxiliaryFingerprint || ''),
    auxiliaryManifestSha256: String(probe.auxiliaryManifestSha256 || ''),
    auxiliaryFileCount: Number(probe.auxiliaryFileCount || 0),
    requiresComfyUI: false, install: { ...installState }, message,
  };
}

async function readIndexTtsLicenseReceipt() {
  const layout = runtimeLayout();
  try {
    const payload = JSON.parse(await fsp.readFile(layout.licenseReceiptPath, 'utf8'));
    const accepted = payload?.schema === 't8-indextts25-model-license-receipt-v1'
      && payload?.modelRepository === MODEL_REPOSITORY
      && payload?.modelRevision === MODEL_REVISION
      && Number(payload?.acceptedAt) > 0;
    return { accepted, acceptedAt: accepted ? Number(payload.acceptedAt) : 0 };
  } catch {
    return { accepted: false, acceptedAt: 0 };
  }
}

async function acceptIndexTtsModelLicense(input = {}) {
  if (input?.accepted !== true) {
    const error = new Error('必须在本机明确阅读并接受 IndexTTS 2.5 模型许可。');
    error.code = 'INDEXTTS25_LICENSE_NOT_CONFIRMED';
    error.status = 409;
    throw error;
  }
  const layout = runtimeLayout();
  await fsp.mkdir(layout.root, { recursive: true });
  const receipt = {
    schema: 't8-indextts25-model-license-receipt-v1',
    acceptedAt: Date.now(),
    modelRepository: MODEL_REPOSITORY,
    modelRevision: MODEL_REVISION,
    licenseUrl: MODEL_LICENSE_URL,
  };
  await writeJsonAtomic(layout.licenseReceiptPath, receipt);
  return { accepted: true, acceptedAt: receipt.acceptedAt, modelRepository: MODEL_REPOSITORY, modelRevision: MODEL_REVISION };
}

async function requireIndexTtsModelLicense() {
  const receipt = await readIndexTtsLicenseReceipt();
  if (!receipt.accepted) {
    const error = new Error('必须先在本机确认 IndexTTS 2.5 模型许可，画布中的旧确认不会被信任。');
    error.code = 'INDEXTTS25_LICENSE_NOT_CONFIRMED';
    error.status = 409;
    throw error;
  }
  return receipt;
}

async function downloadFile(url, destination, expectedSha256, signal) {
  try {
    const response = await fetch(url, { signal, redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`下载本地引擎失败：HTTP ${response.status}`);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await pipeline(response.body, fs.createWriteStream(destination, { flags: 'wx' }));
    const actual = await sha256File(destination);
    if (actual !== expectedSha256) throw new Error('IndexTTS 2.5 引擎下载校验失败。');
  } catch (error) {
    await fsp.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}
async function installEngineSource(layout, signal) {
  if (isRegularFile(path.join(layout.engineRoot, 'indextts', 'infer_v2_5.py'))) return layout.engineRoot;
  const archive = path.join(layout.downloadsRoot, `engine-${ENGINE_REVISION}.zip`);
  const staging = path.join(layout.root, `.engine-installing-${process.pid}-${Date.now()}`);
  await fsp.mkdir(layout.downloadsRoot, { recursive: true });
  await fsp.rm(archive, { force: true });
  await downloadFile(`https://codeload.github.com/${ENGINE_REPOSITORY}/zip/${ENGINE_REVISION}`, archive, ENGINE_ARCHIVE_SHA256, signal);
  let extract;
  try { extract = require('extract-zip'); } catch (_) { throw new Error('缺少安全 ZIP 解压组件。'); }
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  await extract(archive, { dir: staging });
  const children = await fsp.readdir(staging, { withFileTypes: true });
  const rootEntry = children.find((entry) => entry.isDirectory());
  if (!rootEntry || !isRegularFile(path.join(staging, rootEntry.name, 'indextts', 'infer_v2_5.py'))) throw new Error('IndexTTS 2.5 引擎归档内容不完整。');
  await fsp.rm(layout.engineRoot, { recursive: true, force: true });
  await fsp.rename(path.join(staging, rootEntry.name), layout.engineRoot);
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.rm(archive, { force: true });
  return layout.engineRoot;
}

function hasNvidiaGpu() {
  if (!['win32', 'linux'].includes(process.platform)) return false;
  const result = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true, encoding: 'utf8', timeout: 10_000 });
  return !result.error && result.status === 0 && !!String(result.stdout || '').trim();
}
async function ensurePythonAvailable() {
  let python = pythonCandidates();
  if (python) return python;
  if (process.platform === 'win32') {
    const extracted = ensureRuntimeArchiveExtracted('remove-ai-watermarks');
    if (!extracted.available && !extracted.ready) throw new Error('安装包缺少内置 Python 运行时。');
    python = pythonCandidates();
  }
  if (!python) throw new Error('安装包缺少 IndexTTS 2.5 内置 Python 运行时；无需安装 ComfyUI，请重新安装完整版本后重试。');
  return python;
}
async function installTorchStack(python, layout, engineRoot, signal) {
  const env = childEnvironment(layout, engineRoot);
  const common = [
    '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade',
    '--force-reinstall', '--no-deps', '--target', layout.dependenciesRoot,
  ];
  if (hasNvidiaGpu()) {
    await runProcess(python, [
      ...common, '--index-url', 'https://download.pytorch.org/whl/cu130',
      'torch==2.10.0', 'torchaudio==2.10.0', 'torchvision==0.25.0',
    ], { env, signal, timeoutMs: INSTALL_TIMEOUT_MS });
  } else if (process.platform === 'darwin') {
    await runProcess(python, [...common, 'torch==2.10.0', 'torchaudio==2.10.0', 'torchvision==0.25.0'], {
      env, signal, timeoutMs: INSTALL_TIMEOUT_MS,
    });
  } else {
    await runProcess(python, [
      ...common, '--index-url', 'https://download.pytorch.org/whl/cpu',
      'torch==2.10.0', 'torchaudio==2.10.0', 'torchvision==0.25.0',
    ], { env, signal, timeoutMs: INSTALL_TIMEOUT_MS });
  }
  await removeStaleTorchMetadata(layout);
}
async function removeStaleTorchMetadata(layout) {
  const root = path.resolve(layout.dependenciesRoot);
  const expectedVersion = { torch: '2.10.0', torchaudio: '2.10.0', torchvision: '0.25.0' };
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = /^(torch|torchaudio|torchvision)-([^\\/]+)\.dist-info$/iu.exec(entry.name);
    if (!match) continue;
    const packageName = match[1].toLowerCase();
    const installedVersion = match[2].split('+', 1)[0];
    if (installedVersion === expectedVersion[packageName]) continue;
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== root) throw new Error('Torch 元数据清理目标越界。');
    await fsp.rm(target, { recursive: true, force: true });
  }
}
async function installDependencies(python, layout, engineRoot, signal, initialProbe = {}, modelSource = 'huggingface') {
  await fsp.mkdir(layout.dependenciesRoot, { recursive: true });
  const env = childEnvironment(layout, engineRoot);
  const common = ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade', '--target', layout.dependenciesRoot];
  const nonTorchMissing = (Array.isArray(initialProbe.missingDependencies) ? initialProbe.missingDependencies : [])
    .filter((name) => !['torch', 'torchaudio', 'torchvision'].includes(String(name)));
  if (nonTorchMissing.length > 0) {
    await runProcess(python, [...common,
      'accelerate>=1.8.1,<2', 'fugashi>=1.2,<2', 'librosa>=0.10.2,<1', 'munch>=4,<5',
      'omegaconf>=2.3,<3', 'tiktoken>=0.7,<1', 'transformers>=4.52.1,<5', 'unidic-lite>=1,<2',
      'sentencepiece>=0.2,<1', 'einops>=0.8,<1', 'scipy>=1.13,<2', 'soundfile>=0.12,<1',
      'safetensors>=0.4,<1', 'filelock>=3.16,<4', 'faster-whisper>=1.2,<2',
      'opencc-python-reimplemented>=0.1.7,<1',
    ], { env, signal, timeoutMs: INSTALL_TIMEOUT_MS });
    if (modelSource === 'modelscope') {
      await runProcess(python, [...common, 'modelscope>=1.27,<2'], { env, signal, timeoutMs: INSTALL_TIMEOUT_MS });
    }
  }
  // Install the matching native stack last. Packages such as accelerate can otherwise
  // resolve a newer CPU-only torch from PyPI and silently overwrite the CUDA
  // module while leaving an older torchaudio binary behind.
  await installTorchStack(python, layout, engineRoot, signal);
}
async function installModelSourceDependency(python, layout, engineRoot, signal, modelSource) {
  if (modelSource !== 'modelscope') return;
  const env = childEnvironment(layout, engineRoot);
  await runProcess(python, [
    '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade',
    '--target', layout.dependenciesRoot, 'modelscope>=1.27,<2',
  ], { env, signal, timeoutMs: INSTALL_TIMEOUT_MS });
}
function updateInstall(stage, progress, message) { installState = { ...installState, running: true, stage, progress, message, error: '' }; }
async function performInstall(input, signal) {
  await requireIndexTtsModelLicense();
  const layout = runtimeLayout();
  await Promise.all([fsp.mkdir(layout.root, { recursive: true }), fsp.mkdir(layout.cacheRoot, { recursive: true }), fsp.mkdir(layout.modelRoot, { recursive: true })]);
  updateInstall('engine', 8, '正在校验并安装 IndexTTS 2.5 推理引擎…');
  const engineRoot = await installEngineSource(layout, signal);
  updateInstall('python', 18, '正在准备内置 Python 运行时…');
  const python = await ensurePythonAvailable();
  const initialProbe = await probeRuntime(layout);
  const modelSource = input?.source === 'modelscope' ? 'modelscope' : 'huggingface';
  const requiresTorchRepair = initialProbe?.torch?.torchaudioImportReady !== true
    || initialProbe?.torch?.torchvisionImportReady !== true
    || initialProbe?.torch?.abiCompatible !== true
    || initialProbe?.torch?.stackCompatible !== true
    || (hasNvidiaGpu() && initialProbe?.torch?.cudaAvailable !== true);
  if (!initialProbe.dependenciesReady || requiresTorchRepair) {
    updateInstall('dependencies', 28, '正在安装 GPU/CPU 推理依赖，首次安装文件较大…');
    await installDependencies(python, layout, engineRoot, signal, initialProbe, modelSource);
  } else {
    await installModelSourceDependency(python, layout, engineRoot, signal, modelSource);
  }
  await removeStaleTorchMetadata(layout);
  updateInstall('model', 58, '正在下载并逐文件校验 IndexTTS 2.5 模型（约 5.5GB）…');
  await runProcess(python, [path.join(engineRoot, 'scripts', 'download_models.py'), '--target', layout.modelRoot, '--source', modelSource, '--accept-license', '--skip-aux'], {
    env: childEnvironment(layout, engineRoot), signal, timeoutMs: INSTALL_TIMEOUT_MS,
  });
  updateInstall('auxiliary-models', 76, '正在下载并逐文件校验固定版本的语音与 ASR 辅助模型…');
  if (!isRegularFile(AUXILIARY_INSTALLER_PATH) || !isRegularFile(AUXILIARY_MANIFEST_PATH)) {
    throw new Error('IndexTTS 2.5 辅助模型安装器不完整。');
  }
  await runProcess(python, [AUXILIARY_INSTALLER_PATH, '--model-root', layout.modelRoot], {
    env: childEnvironment(layout, engineRoot), signal, timeoutMs: INSTALL_TIMEOUT_MS,
  });
  updateInstall('verify', 94, '正在执行最终运行时与模型校验…');
  const finalProbe = await probeRuntime(layout);
  if (!finalProbe.dependenciesReady || !finalProbe.modelReady || !finalProbe.auxiliaryReady) {
    const failures = [
      ...(finalProbe.missingDependencies || []),
      ...(finalProbe.auxiliaryMissing || []),
      ...(finalProbe.auxiliaryMismatched || []),
    ];
    throw new Error(finalProbe.probeError || `最终校验未通过：${failures.join('、')}`);
  }
  updateInstall('complete', 100, 'IndexTTS 2.5 本地引擎与模型已就绪。');
}
function startIndexTtsRuntimeInstall(input = {}) {
  if (installPromise) return { ...installState, duplicate: true };
  installController = new AbortController();
  installState = { running: true, stage: 'starting', progress: 1, message: '正在启动本地引擎安装…', error: '', startedAt: Date.now(), finishedAt: 0 };
  installPromise = performInstall(input, installController.signal)
    .then(() => { installState = { ...installState, running: false, stage: 'complete', progress: 100, finishedAt: Date.now() }; })
    .catch((error) => {
      installState = { ...installState, running: false, stage: error?.code === 'LOCALIZATION_INSTALL_ABORTED' ? 'cancelled' : 'error', error: String(error?.message || error), message: String(error?.message || error), finishedAt: Date.now() };
    })
    .finally(() => { installPromise = null; installController = null; });
  return { ...installState, duplicate: false };
}
function cancelIndexTtsRuntimeInstall() {
  if (!installController) return { cancelled: false, install: { ...installState } };
  installController.abort();
  return { cancelled: true, install: { ...installState } };
}

function stopWorker(errorMessage = '本地语音 Worker 已停止。') {
  const current = worker;
  worker = null;
  workerBuffer = '';
  if (current) { try { current.kill('SIGKILL'); } catch (_) {} }
  for (const pending of workerPending.values()) { clearTimeout(pending.timer); pending.reject(new Error(errorMessage)); }
  workerPending.clear();
}
async function ensureWorker() {
  if (worker && !worker.killed) return worker;
  const layout = runtimeLayout();
  const probe = await probeRuntime(layout);
  if (!probe.dependenciesReady || !probe.modelReady || !probe.auxiliaryReady || !probe.engineRoot || !probe.python) {
    const error = new Error('IndexTTS 2.5 本地引擎尚未就绪，请先一键安装。');
    error.code = 'INDEXTTS25_RUNTIME_NOT_READY';
    throw error;
  }
  workerStderr = '';
  const child = spawn(probe.python, [WORKER_PATH, '--engine-root', probe.engineRoot, '--model-root', layout.modelRoot, '--serve'], {
    windowsHide: true, env: workerEnvironment(layout, probe.engineRoot), stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    workerBuffer += chunk.toString('utf8');
    const lines = workerBuffer.split(/\r?\n/);
    workerBuffer = lines.pop() || '';
    for (const line of lines) {
      let message;
      try { message = JSON.parse(line); } catch (_) { continue; }
      const pending = workerPending.get(String(message.id || ''));
      if (!pending) continue;
      if (message.event === 'progress') { pending.onProgress?.(message); continue; }
      workerPending.delete(String(message.id || ''));
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || 'IndexTTS 2.5 Worker 执行失败。'));
    }
  });
  child.stderr.on('data', (chunk) => { workerStderr = appendBounded(workerStderr, chunk.toString('utf8'), 64 * 1024); });
  child.once('error', (error) => stopWorker(error.message));
  child.once('close', (code) => stopWorker(`IndexTTS 2.5 Worker 已退出（${code}）：${workerStderr.slice(-1200)}`));
  worker = child;
  return child;
}
async function workerRequest(action, payload, options = {}) {
  const child = await ensureWorker();
  const id = `${Date.now().toString(36)}-${(++workerSequence).toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      workerPending.delete(id);
      callback(value);
    };
    const onAbort = () => {
      stopWorker('IndexTTS 2.5 任务已取消，Worker 已释放。');
      const error = options.signal?.reason instanceof Error ? options.signal.reason : new Error('IndexTTS 2.5 任务已取消。');
      error.code = error.code || 'LOCALIZATION_TTS_ABORTED';
      settle(reject, error);
    };
    const timer = setTimeout(() => {
      stopWorker('IndexTTS 2.5 生成超时，Worker 已重置。');
      settle(reject, new Error('IndexTTS 2.5 生成超时。'));
    }, Math.max(60_000, Number(options.timeoutMs) || GENERATION_TIMEOUT_MS));
    workerPending.set(id, {
      resolve: (value) => settle(resolve, value),
      reject: (error) => settle(reject, error),
      timer,
      onProgress: options.onProgress,
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) return onAbort();
    child.stdin.write(`${JSON.stringify({ id, action, payload })}\n`, 'utf8', (error) => {
      if (!error) return;
      settle(reject, error);
    });
  });
}

async function downloadToTemporary(url, extension = '.bin', signal) {
  const response = await fetch(url, { redirect: 'follow', signal });
  if (!response.ok || !response.body) throw new Error(`下载媒体失败：HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_MEDIA_BYTES) throw new Error('媒体超过 512 MiB 安全上限。');
  const file = path.join(os.tmpdir(), safeOutputName('t8-localization-source', extension));
  try {
    await pipeline(response.body, fs.createWriteStream(file, { flags: 'wx' }));
    const stat = await fsp.stat(file);
    if (stat.size > MAX_MEDIA_BYTES) throw new Error('媒体超过 512 MiB 安全上限。');
    return file;
  } catch (error) {
    await fsp.rm(file, { force: true }).catch(() => undefined);
    throw error;
  }
}
async function materializeMediaRef(mediaRef, options = {}) {
  try {
    const local = await resolveMediaRef(mediaRef, { target: 'local-path', baseUrl: options.t8BaseUrl });
    const stat = await fsp.stat(local.path);
    if (stat.size > MAX_MEDIA_BYTES) throw new Error('媒体超过 512 MiB 安全上限。');
    return { path: local.path, temporary: false, mime: local.mime || mimeFromPath(local.path) };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (/超过 512 MiB 安全上限/.test(String(error?.message || ''))) throw error;
    const resolved = await resolveMediaRef(mediaRef, { target: 'url', baseUrl: options.t8BaseUrl });
    const parsed = new URL(resolved.url);
    const file = await downloadToTemporary(resolved.url, path.extname(parsed.pathname).toLowerCase() || '.bin', options.signal);
    return { path: file, temporary: true, mime: mimeFromPath(file) };
  }
}
function resolveFfmpeg() {
  const injected = String(process.env.T8PC_FFMPEG_PATH || '').trim();
  if (injected && fs.existsSync(injected)) return injected;
  try { const bundled = require('ffmpeg-static'); if (bundled && fs.existsSync(bundled)) return bundled; } catch (_) {}
  return 'ffmpeg';
}
async function ensureAudioFile(mediaRef, options = {}) {
  const source = await materializeMediaRef(mediaRef, options);
  const extension = path.extname(source.path).toLowerCase();
  if (AUDIO_EXTENSIONS.has(extension)) return source;
  if (!VIDEO_EXTENSIONS.has(extension) && !String(source.mime || '').startsWith('video/')) {
    if (source.temporary) await fsp.rm(source.path, { force: true }).catch(() => undefined);
    throw new Error(`参考音色必须是音频或含音轨的视频：${path.basename(source.path)}`);
  }
  const wav = path.join(os.tmpdir(), safeOutputName('t8-localization-voice', '.wav'));
  try {
    await runProcess(resolveFfmpeg(), ['-y', '-i', source.path, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav], { signal: options.signal });
    return { path: wav, temporary: true, mime: 'audio/wav', sourceTemporaryPath: source.temporary ? source.path : '' };
  } catch (error) {
    if (source.temporary) await fsp.rm(source.path, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function runIndexTtsDialogue(input, options = {}) {
  await requireIndexTtsModelLicense();
  const language = String(input.language || '').trim().toUpperCase();
  if (!DUBBING_LANGUAGES.has(language)) throw new Error(`IndexTTS 2.5 不支持 ${language} 配音。`);
  const units = Array.isArray(input.units) ? input.units.slice(0, 5_000) : [];
  if (!units.length) throw new Error('没有可配音的译文。');
  const inputRoles = Array.isArray(input.roles) ? input.roles : [];
  if (!inputRoles.length) throw new Error('至少需要 1 个角色音色。');
  if (inputRoles.length > 16) {
    const error = new Error(`IndexTTS 2.5 最多支持 16 个角色音色，当前为 ${inputRoles.length} 个。`);
    error.code = 'LOCALIZATION_ROLE_LIMIT_EXCEEDED';
    error.status = 400;
    throw error;
  }
  const jobId = ttsJobIdentity(input);
  const inputDigest = ttsJobInputDigest(input);
  const paths = ttsJobPaths(jobId, options);
  const active = ttsJobPromises.get(jobId);
  if (active) {
    if (active.inputDigest !== inputDigest) {
      const error = new Error('相同配音任务键对应的输入已经改变，已停止以避免串单。');
      error.code = 'LOCALIZATION_TTS_JOB_INPUT_MISMATCH';
      error.status = 409;
      throw error;
    }
    return active.promise;
  }
  const existing = await readJsonFile(paths.manifest);
  if (existing) {
    if (existing.schema !== 't8-localization-tts-job-v1' || existing.inputDigest !== inputDigest) {
      const error = new Error('已存在的配音任务与当前输入不一致，已停止以避免覆盖。');
      error.code = 'LOCALIZATION_TTS_JOB_INPUT_MISMATCH';
      error.status = 409;
      throw error;
    }
    const cached = await persistedTtsResult(paths, existing);
    if (cached) {
      if (existing.status !== 'complete') {
        await writeJsonAtomic(paths.manifest, { ...existing, status: 'complete', updatedAt: Date.now(), recoveredAt: Date.now() });
      }
      return cached;
    }
    if (!['failed', 'cancelled'].includes(existing.status) || input.retryFailed !== true) {
      const error = new Error('上次配音任务未留下完整可校验结果；不会自动重复推理，请明确重试后创建新运行。');
      error.code = 'LOCALIZATION_TTS_RECOVERY_CONFIRMATION_REQUIRED';
      error.status = 409;
      error.jobId = jobId;
      throw error;
    }
    await Promise.all([paths.result, paths.audio, paths.subtitle]
      .map((file) => fsp.rm(file, { force: true }).catch(() => undefined)));
  }

  const promise = (async () => {
    const temporaryFiles = [];
    const roles = [];
    const seen = new Set();
    let manifest = ttsJobManifest(jobId, inputDigest, {
      status: 'prepared',
      language,
      unitCount: units.length,
      roleCount: inputRoles.length,
    });
    await Promise.all([
      fsp.mkdir(paths.jobDir, { recursive: true }),
      fsp.mkdir(paths.outputDir, { recursive: true }),
    ]);
    await writeJsonAtomic(paths.manifest, manifest);
    try {
      const ensureAudio = options.ensureAudioFile || ensureAudioFile;
      for (const role of inputRoles) {
        const name = boundedText(role?.role, 40, '角色名');
        if (seen.has(name)) throw new Error(`角色名重复：${name}`);
        seen.add(name);
        if (role?.consentConfirmed !== true) throw new Error(`角色 ${name} 尚未确认音色授权。`);
        const audio = await ensureAudio(boundedText(role?.referenceUrl, 16_384, `角色 ${name} 的参考音色`), options);
        if (audio.temporary) temporaryFiles.push(audio.path);
        if (audio.sourceTemporaryPath) temporaryFiles.push(audio.sourceTemporaryPath);
        roles.push({ role: name, referencePath: audio.path, consentConfirmed: true });
      }
      manifest = { ...manifest, status: 'running', startedAt: Date.now(), updatedAt: Date.now() };
      await writeJsonAtomic(paths.manifest, manifest);
      const requestWorker = options.workerRequest || workerRequest;
      const run = () => requestWorker('generate', {
        language,
        units: units.map((unit, offset) => ({
          index: Number(unit?.index) || offset + 1, role: String(unit?.role || '旁白').slice(0, 40),
          translatedText: String(unit?.translatedText || '').slice(0, 20_000),
          pronunciation: String(unit?.pronunciation || '').slice(0, 2_000),
          emotion: String(unit?.emotion || '').slice(0, 1_000),
          startMs: Math.max(0, Number(unit?.startMs) || 0), endMs: Math.max(1, Number(unit?.endMs) || 1),
        })),
        roles, outputDir: paths.outputDir, timelinePolicy: input.timelinePolicy, timingMode: input.timingMode,
        asrEnabled: input.asrEnabled !== false, asrRetryCount: input.asrRetryCount, asrThreshold: input.asrThreshold,
        subtitleTimingMode: input.subtitleTimingMode, subtitleTextMode: input.subtitleTextMode,
        subtitleIncludeRole: input.subtitleIncludeRole === true, postprocessPreset: input.postprocessPreset,
        postprocessStrength: input.postprocessStrength, seed: input.seed,
      }, { signal: options.signal, onProgress: options.onProgress });
      const current = generationTail.then(run, run);
      generationTail = current.catch(() => undefined);
      const generated = await current;
      if (path.resolve(generated.audioPath) !== paths.audio) {
        await fsp.copyFile(generated.audioPath, paths.audio, fs.constants.COPYFILE_EXCL);
      }
      if (path.resolve(generated.subtitlePath) !== paths.subtitle) {
        await fsp.copyFile(generated.subtitlePath, paths.subtitle, fs.constants.COPYFILE_EXCL);
      }
      const [audioStat, subtitleStat, audioSha, subtitleSha] = await Promise.all([
        fsp.stat(paths.audio), fsp.stat(paths.subtitle), sha256File(paths.audio), sha256File(paths.subtitle),
      ]);
      const result = {
        schema: 't8-localization-tts-result-v2', engine: 'embedded-index-tts-2.5', requiresComfyUI: false,
        jobId, requestId: jobId, reused: false,
        audioUrl: outputPublicUrl(paths.audio), subtitleUrl: outputPublicUrl(paths.subtitle), subtitleText: generated.subtitleText,
        byteLength: audioStat.size, sha256: audioSha, subtitleByteLength: subtitleStat.size, subtitleSha256: subtitleSha,
        generationReport: generated.report,
        recovery: { schema: 't8-localization-tts-recovery-v1', status: 'fresh-complete' },
      };
      await writeJsonAtomic(paths.result, result);
      manifest = { ...manifest, status: 'complete', completedAt: Date.now(), updatedAt: Date.now(), audioSha256: audioSha, subtitleSha256: subtitleSha };
      await writeJsonAtomic(paths.manifest, manifest);
      await Promise.all([generated.audioPath, generated.subtitlePath, generated.reportPath]
        .filter((file) => file && ![paths.audio, paths.subtitle].includes(path.resolve(file)))
        .map((file) => fsp.rm(file, { force: true }).catch(() => undefined)));
      return result;
    } catch (error) {
      const cancelled = options.signal?.aborted || error?.code === 'LOCALIZATION_TTS_ABORTED';
      await writeJsonAtomic(paths.manifest, {
        ...manifest,
        status: cancelled ? 'cancelled' : 'failed',
        errorCode: String(error?.code || (cancelled ? 'LOCALIZATION_TTS_ABORTED' : 'LOCALIZATION_TTS_FAILED')).slice(0, 120),
        error: String(error?.message || error).slice(0, 2_000),
        updatedAt: Date.now(),
        finishedAt: Date.now(),
      }).catch(() => undefined);
      throw error;
    } finally {
      await Promise.all([...new Set(temporaryFiles)].map((file) => fsp.rm(file, { force: true }).catch(() => undefined)));
    }
  })();
  ttsJobPromises.set(jobId, { inputDigest, promise });
  try {
    return await promise;
  } finally {
    ttsJobPromises.delete(jobId);
  }
}

async function retryIndexTtsDialogueLine(input, options = {}) {
  await requireIndexTtsModelLicense();
  const unit = input?.unit && typeof input.unit === 'object' ? input.unit : null;
  if (!unit) throw new Error('缺少要重新配音的台词。');
  const startMs = Math.max(0, Math.round(Number(unit.startMs) || 0));
  const endMs = Math.max(startMs + 1, Math.round(Number(unit.endMs) || startMs + 1));
  const baseAudio = await ensureAudioFile(boundedText(input.baseAudioUrl, 16_384, '现有配音音轨'), options);
  let replacement;
  try {
    const lineResult = await runIndexTtsDialogue({
      ...input,
      units: [{ ...unit, startMs: 0, endMs: endMs - startMs }],
      roles: Array.isArray(input.roles) ? input.roles : [],
      timelinePolicy: 'shift',
      subtitleTimingMode: 'original',
      subtitleIncludeRole: false,
      jobKey: boundedText(input.jobKey, 512, '逐句重配任务键'),
    }, options);
    replacement = await ensureAudioFile(lineResult.audioUrl, options);
    await fsp.mkdir(config.OUTPUT_DIR, { recursive: true });
    const output = path.join(config.OUTPUT_DIR, safeOutputName(`localized_line_${Number(unit.index) || 0}`, '.wav'));
    const startSeconds = (startMs / 1000).toFixed(3);
    const endSeconds = (endMs / 1000).toFixed(3);
    const slotSeconds = Math.max(0.001, (endMs - startMs) / 1000);
    const fadeSeconds = Math.min(0.02, slotSeconds / 4);
    const fadeOutStart = Math.max(0, slotSeconds - fadeSeconds);
    // Keep the untouched programme at its original gain. FFmpeg amix defaults to
    // normalize=1, which would make the whole reused track quieter even though
    // only one dialogue slot is being replaced.
    const filter = `[0:a]volume=0:enable='between(t,${startSeconds},${endSeconds})'[base];[1:a]atrim=0:${slotSeconds.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeSeconds.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSeconds.toFixed(3)},adelay=${startMs}:all=1[new];[base][new]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`;
    await runProcess(resolveFfmpeg(), [
      '-y', '-i', baseAudio.path, '-i', replacement.path,
      '-filter_complex', filter, '-map', '[out]', '-c:a', 'pcm_s16le', output,
    ], { timeoutMs: 60 * 60_000, signal: options.signal });
    const stat = await fsp.stat(output);
    if (!stat.size) throw new Error('逐句重配生成了空音频。');
    return {
      schema: 't8-localization-tts-line-retry-result-v1',
      index: Number(unit.index) || 0,
      audioUrl: outputPublicUrl(output),
      byteLength: stat.size,
      sha256: await sha256File(output),
      lineResult,
    };
  } finally {
    if (baseAudio.temporary) await fsp.rm(baseAudio.path, { force: true }).catch(() => undefined);
    if (baseAudio.sourceTemporaryPath) await fsp.rm(baseAudio.sourceTemporaryPath, { force: true }).catch(() => undefined);
    if (replacement?.temporary) await fsp.rm(replacement.path, { force: true }).catch(() => undefined);
    if (replacement?.sourceTemporaryPath) await fsp.rm(replacement.sourceTemporaryPath, { force: true }).catch(() => undefined);
  }
}

async function muxLocalizedVideo(input, options = {}) {
  const video = await materializeMediaRef(boundedText(input.videoUrl, 16_384, '源视频'), options);
  const audio = await ensureAudioFile(boundedText(input.audioUrl, 16_384, '配音音轨'), options);
  await fsp.mkdir(config.OUTPUT_DIR, { recursive: true });
  const output = path.join(config.OUTPUT_DIR, safeOutputName('localized_video', '.mp4'));
  try {
    await runProcess(resolveFfmpeg(), ['-y', '-i', video.path, '-i', audio.path, '-filter_complex', '[1:a:0]apad[a]', '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output], { timeoutMs: 60 * 60_000, signal: options.signal });
    const stat = await fsp.stat(output);
    if (!stat.size) throw new Error('视频换轨生成了空文件。');
    return { schema: 't8-localization-video-mux-result-v1', videoUrl: outputPublicUrl(output), byteLength: stat.size, sha256: await sha256File(output), audioPolicy: 'replace' };
  } finally {
    if (video.temporary) await fsp.rm(video.path, { force: true }).catch(() => undefined);
    if (audio.temporary) await fsp.rm(audio.path, { force: true }).catch(() => undefined);
    if (audio.sourceTemporaryPath) await fsp.rm(audio.sourceTemporaryPath, { force: true }).catch(() => undefined);
  }
}

async function writeLocalizationSubtitle(input) {
  const text = boundedText(input?.text, 2_000_000, '字幕内容');
  const format = String(input?.format || 'srt').toLowerCase() === 'vtt' ? 'vtt' : 'srt';
  await fsp.mkdir(config.OUTPUT_DIR, { recursive: true });
  const output = path.join(config.OUTPUT_DIR, safeOutputName('localized_subtitles', `.${format}`));
  await fsp.writeFile(output, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  const stat = await fsp.stat(output);
  return {
    schema: 't8-localization-subtitle-result-v1',
    subtitleUrl: outputPublicUrl(output),
    byteLength: stat.size,
    sha256: await sha256File(output),
    format,
  };
}

module.exports = {
  DUBBING_LANGUAGES, MODEL_LICENSE_URL, acceptIndexTtsModelLicense, cancelIndexTtsRuntimeInstall, inspectIndexTtsRuntime,
  inspectIndexTtsJob, muxLocalizedVideo, retryIndexTtsDialogueLine, runIndexTtsDialogue, startIndexTtsRuntimeInstall, stopWorker,
  writeLocalizationSubtitle,
};
