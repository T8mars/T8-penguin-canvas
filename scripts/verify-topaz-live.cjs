'use strict';
// Isolated verifier only. Never replay an accepted or ambiguous creation POST.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { submitOnce, safeError } = require('./verify-seedream-flash-live.cjs');
const contract = require('../backend/src/shared/topazVideoContract.json');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const root = path.resolve(__dirname, '..');
const runName = process.env.T8_TOPAZ_VERIFY_RUN || 'topaz-live-20261011';
if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(runName)) throw new Error('Invalid verification directory');
const directory = path.join(root, 'local-private', runName);
function save(file, value) {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
const command = (exe, args) => execFileSync(exe, args, { windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
function requireRole() {
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Development worktree required');
}
async function main() {
  requireRole();
  const key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key) throw new Error('Process-only SEEDANCE_NZ_API_KEY required');
  const { app, session } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-topaz-'));
  app.setPath('userData', scratch);
  app.disableHardwareAcceleration();
  const outputDir = path.join(directory, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const report = { schema: 't8-topaz-live-v1', model: contract.model, channel: 'seedance-nz', startedAt: new Date().toISOString(),
    credentialPersisted: false, replayPolicy: 'resume-original-task-only' };
  const log = (phase, status) => process.stdout.write(`${JSON.stringify({ phase, ...(status ? { status } : {}) })}\n`);
  try {
    await app.whenReady();
    const network = session.fromPartition('t8-topaz-live');
    const bridge = require('../electron/systemFetchBridge.cjs');
    bridge.installChromiumResponseHeaderBridge(network);
    bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network),
      refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
    const config = require('../backend/src/config');
    config.OUTPUT_DIR = outputDir;
    config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json');
    const provider = require('../backend/src/providers/seedanceNz');
    const media = require('../backend/src/routes/proxy')._test;
    const { resolveBundledFfmpeg, resolveBundledFfprobe } = require('../backend/src/providers/llmMedia');
    const inputVideo = path.join(directory, 'reference.mp4');
    if (!fs.existsSync(inputVideo)) command(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-threads', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', inputVideo]);
    const input = { model: contract.model, videos: [inputVideo], resolution: '720p', quality: 'Low' };
    report.requestedResolution = input.resolution;
    report.restorationModel = input.quality;
    log('submit-or-resume');
    const taskId = await submitOnce(path.join(directory, 'task.state.private.json'), contract.model, input,
      (body) => provider.submitTopazVideoTask(body, key));
    const started = Date.now();
    let result;
    let previous = '';
    let polls = 0;
    while (Date.now() - started < 60 * 60_000) {
      result = await provider.queryTopazVideoTask(taskId, key);
      polls += 1;
      if (result.status !== previous) log('poll', result.status);
      previous = result.status;
      if (result.status === 'failed') throw new Error(result.failReason || 'Original task failed');
      if (result.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    if (result?.status !== 'succeeded' || !result.videoUrls?.length) throw new Error('No completed output; resume original task only');
    report.outputs = [];
    for (const [index, url] of result.videoUrls.entries()) {
      log('download');
      const downloaded = await media.fetchProxyRemoteMedia(url, { trustedProviderOutput: true, allowedKinds: ['video'],
        maxBytes: 512 * 1024 * 1024, connectTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
        deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS });
      const local = media.storeMaterializedOutputBuffer(downloaded.buffer, 'video', media.verifiedProxyMediaExtension(downloaded), `topaz-nz:${taskId}:${index}`);
      const filename = path.join(outputDir, path.basename(local));
      const probe = JSON.parse(command(resolveBundledFfprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename]).toString());
      const video = probe.streams.find((stream) => stream.codec_type === 'video');
      if (!video || !(Number(probe.format?.duration) > 0)) throw new Error('Invalid video stream');
      command(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', filename, '-map', '0:v:0', '-f', 'null', '-']);
      report.outputs.push({ file: path.relative(root, filename).replace(/\\/g, '/'), bytes: downloaded.buffer.length,
        sha256: crypto.createHash('sha256').update(downloaded.buffer).digest('hex'), codec: video.codec_name,
        width: video.width, height: video.height, duration: Number(probe.format.duration), fullDecode: true });
    }
    report.passed = true;
    report.providerTerminalStatus = result.status;
    report.upstreamHttpStatus = result.upstreamHttpStatus;
    report.polls = polls;
    report.pollThroughDecodeMs = Date.now() - started;
  } catch (error) {
    report.passed = false;
    report.error = safeError(error, key);
  }
  report.completedAt = new Date().toISOString();
  save(reportPath, report);
  log('complete', report.passed ? 'passed' : report.error);
  app.exit(report.passed ? 0 : 1);
}
async function launch() {
  requireRole();
  let key = process.env.SEEDANCE_NZ_API_KEY;
  if (!key) {
    process.stdout.write('Waiting for API key on hidden stdin (not saved).\n');
    const { Writable } = require('node:stream');
    key = await new Promise((resolve) => {
      const input = require('node:readline').createInterface({ input: process.stdin,
        output: new Writable({ write(_chunk, _encoding, done) { done(); } }), terminal: Boolean(process.stdin.isTTY) });
      input.once('line', (line) => { input.close(); resolve(line.trim()); });
    });
  }
  if (!key) throw new Error('API key required');
  const env = { ...process.env, SEEDANCE_NZ_API_KEY: key };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  delete env.SEEDANCE_NZ_API_KEY;
  key = null;
  child.once('exit', (code) => { process.exitCode = code || 0; });
  child.once('error', () => { process.stderr.write('Cannot launch Electron verifier\n'); process.exitCode = 1; });
}
if (require.main === module || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  (process.argv.includes('--launch') ? launch() : main()).catch((error) => { process.stderr.write(`${safeError(error)}\n`); process.exit(1); });
}
