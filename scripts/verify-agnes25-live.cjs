'use strict';
// Isolated provider verification, not a production submission ledger. Production keeps the shared Run authority.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { submitOnce, safeError } = require('./verify-seedream-flash-live.cjs');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const contract = require('../backend/src/shared/agnesVideoContract.json');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'local-private/quick-add-agnes-20261024/live');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function save(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function command(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}
async function main() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw Error('Development worktree required');
  const key = String(process.env.AGNES_API_KEY || '').trim(); delete process.env.AGNES_API_KEY;
  if (!key) throw Error('Agnes API key required');
  const { app, session } = require('electron');
  const scratch = process.env.T8_AGNES_LIVE_PROFILE;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-agnes-live-')) throw Error('Isolated profile required');
  app.setPath('userData', scratch); app.setPath('sessionData', scratch); app.disableHardwareAcceleration();
  fs.mkdirSync(path.join(directory, 'outputs'), { recursive: true });
  const reportFile = path.join(directory, 'report.json');
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { startedAt: new Date().toISOString(), results: {} };
  try {
    await app.whenReady();
    const network = session.fromPartition('t8-agnes25-live');
    const bridge = require('../electron/systemFetchBridge.cjs');
    bridge.installChromiumResponseHeaderBridge(network);
    bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network),
      refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
    const config = require('../backend/src/config');
    config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json'); config.OUTPUT_DIR = path.join(directory, 'outputs');
    const adapter = require('../backend/src/providers/agnes');
    const { generateVideoWithProvider } = require('../backend/src/providers/adapters');
    const media = require('../backend/src/routes/proxy')._test;
    const provider = { id: 'agnes', protocol: 'agnes', apiKey: key, baseUrl: 'https://apihub.agnes-ai.com/v1' };
    for (const model of contract.models) {
      if (report.results[model]?.passed) continue;
      const input = { model, prompt: 'A friendly small penguin waves one flipper on a quiet snowy hill. Fixed camera, gentle natural movement, no text.', duration: 4, resolution: '720P', ratio: '16:9' };
      const stateFile = path.join(directory, model + '.state.private.json');
      const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
      const started = Date.now(); let polls = 0; let result;
      const options = { timeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, maxPolls: 120,
        fetchImpl: async (url, init) => {
          const res = await network.fetch(url, init);
          if (init.method === 'POST') {
            const raw = await res.clone().json();
            const taskId = raw?.video_id || raw?.data?.video_id;
            if (taskId) save(stateFile, { model, inputDigest: hash(JSON.stringify(input)), taskId, acceptance: 'accepted', acceptedAt: new Date().toISOString() });
            process.stdout.write(JSON.stringify({ model, phase: 'submit', httpStatus: res.status, accepted: Boolean(taskId) }) + '\n');
          } else { polls++; if (polls % 5 === 1) process.stdout.write(JSON.stringify({ model, phase: 'poll', polls, httpStatus: res.status }) + '\n'); }
          return res;
        } };
      try {
        if (state) {
          if (!state.taskId || state.inputDigest !== hash(JSON.stringify(input))) throw Error('Prior acceptance unknown or input changed; refusing POST');
          const resumed = await adapter.waitForAgnesVideoTask(provider, state.taskId, model, options);
          result = { ok: true, model, taskId: state.taskId, ...resumed };
        } else {
          await submitOnce(stateFile, model, input, async body => {
            result = await generateVideoWithProvider(provider, body, options);
            if (!result.ok) throw Error(result.error);
            return result;
          });
        }
        if (!result?.ok || result.videoUrls?.length !== 1) throw Error('Expected one completed video');
        const downloaded = await media.fetchProxyRemoteMedia(result.videoUrls[0], { trustedProviderOutput: true, allowedKinds: ['video'], maxBytes: 128 * 1024 * 1024,
          connectTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS });
        const file = path.join(directory, 'outputs', model + '.mp4'); fs.writeFileSync(file, downloaded.buffer);
        const metadata = JSON.parse(await command(path.join(root, 'tools/ffmpeg-runtime/ffprobe.exe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
        const video = metadata.streams?.find(stream => stream.codec_type === 'video');
        if (!video?.width || !video?.height || Number(metadata.format?.duration) < 3) throw Error('Invalid or too-short video');
        await command(path.join(root, 'tools/ffmpeg-runtime/ffmpeg.exe'), ['-v', 'error', '-threads', '1', '-i', file, '-map', '0:v:0', '-f', 'null', '-']);
        report.results[model] = { passed: true, elapsedSeconds: (Date.now() - started) / 1000, polls, bytes: downloaded.buffer.length, sha256: hash(downloaded.buffer),
          width: video.width, height: video.height, duration: Number(metadata.format.duration), fullDecode: true, file: path.relative(root, file).replace(/\\/g, '/') };
        process.stdout.write(JSON.stringify({ model, phase: 'full-video-decode', passed: true }) + '\n');
      } catch (error) {
        report.results[model] = { passed: false, polls, error: safeError(error, key) };
        process.stdout.write(JSON.stringify({ model, phase: 'failed', error: safeError(error, key) }) + '\n');
      }
      save(reportFile, report);
    }
    report.passed = contract.models.every(model => report.results[model]?.passed);
    report.completedAt = new Date().toISOString(); save(reportFile, report); app.exit(report.passed ? 0 : 1);
  } catch (error) { process.stderr.write(safeError(error, key) + '\n'); app.exit(1); }
}
async function launch() {
  let key = String(process.env.AGNES_API_KEY || '').trim();
  if (!key) {
    process.stdout.write('Waiting for Agnes key on hidden stdin; not saved.\n');
    const { Writable } = require('node:stream');
    const reader = require('node:readline').createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY), output: new Writable({ write(_chunk, _encoding, done) { done(); } }) });
    key = await new Promise(resolve => reader.once('line', line => { reader.close(); resolve(line.trim()); })); reader.close();
  }
  if (!key) throw Error('Agnes key required');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-agnes-live-'));
  const env = { ...process.env, AGNES_API_KEY: key, T8_AGNES_LIVE_PROFILE: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['--js-flags=--max-old-space-size=768', __filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  delete env.AGNES_API_KEY; key = null;
  child.once('exit', code => {
    if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-agnes-live-')) fs.rmSync(scratch, { recursive: true, force: true });
    process.exitCode = code ?? 1;
  });
}
(process.argv.includes('--launch') ? launch() : main()).catch(error => { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; });
