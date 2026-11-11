'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawn, execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util'), execute = promisify(execFile);
const { submitOnce } = require('./verify-seedream-flash-live.cjs');
const ROOT = path.resolve(__dirname, '..'), DIRECTORY = path.join(ROOT, 'local-private/seedream55-draft-20261111');
function save(name, value) { const file = path.join(DIRECTORY, name); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); fs.renameSync(file + '.tmp', file); }
async function main() {
  let key = process.env.SEEDANCE_NZ_API_KEY; delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key || !process.argv.includes('--confirm-live')) throw Error('Explicit confirmation and process-only key required');
  const scratch = process.env.T8_SD55_LIVE_PROFILE;
  if (!scratch || path.dirname(scratch) !== os.tmpdir() || !path.basename(scratch).startsWith('t8-sd55-live-')) throw Error('Fresh isolated profile required');
  const { app, session } = require('electron'); app.setPath('userData', scratch); app.setPath('sessionData', scratch); app.disableHardwareAcceleration(); await app.whenReady();
  const network = session.fromPartition('t8-sd55-live'), bridge = require('../electron/systemFetchBridge.cjs');
  bridge.installChromiumResponseHeaderBridge(network); bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network), refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
  const config = require('../backend/src/config'); config.OUTPUT_DIR = path.join(DIRECTORY, 'outputs'); config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json'); fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const provider = require('../backend/src/providers/seedanceNz'), download = require('../backend/src/routes/proxy')._test.saveRemoteFalToolboxFile, sharp = require('sharp');
  const reportFile = path.join(DIRECTORY, 'live-report.json');
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { schema: 't8-seedream55-draft-live-v1', maximumCreationPosts: 10, results: [] };
  if (process.argv.includes('--verify-existing-layers')) {
    const probes = [];
    for (const [label, model] of [['domestic-layer', 'seedream-v5.5-layer-decomposition'], ['global-layer', 'dola-seedream-5.5-layer-decomposition']]) {
      const task = JSON.parse(fs.readFileSync(path.join(DIRECTORY, label + '-private-task.json'), 'utf8'));
      const result = await provider.queryImageTask(task.taskId, key, { model });
      if (result.status !== 'succeeded' || !result.imageUrls.length) throw Error('Original layers unavailable');
      probes.push({ model, readOnly: true, outputs: result.imageUrls.length, metadataEntries: result.layers?.length ?? 0, passed: true });
    }
    save('layer-metadata-probes.json', probes); console.log(JSON.stringify(probes)); key = null; app.exit(0); return;
  }
  if (process.argv.includes('--retry-after-topup')) {
    if (process.env.T8_SD55_RETRY_AUTHORIZED !== '1' || report.error?.status !== 403) throw Error('Explicit owner-authorized retry of recorded HTTP403 required');
    report.previousGlobalEnhancementError = report.error;
    report.maximumCreationPosts = 11;
    report.ownerAuthorizedOneRetryAfterTopup = true;
  }
  if (process.argv.includes('--probe-access')) {
    for (const endpoint of ['/api/usage/wallet/', '/api/usage/token/']) {
      const response = await network.fetch('https://api.seedance.nz' + endpoint, { headers: { Authorization: 'Bearer ' + key } });
      const body = await response.json(), data = body.data || {};
      console.log(JSON.stringify({ endpoint, readOnly: true, status: response.status, code: body.code, amount: data.amount, remainQuota: data.remain_quota, unlimitedQuota: data.unlimited_quota, modelLimitsEnabled: data.model_limits_enabled, modelLimits: data.model_limits ? String(data.model_limits).split(',').filter(model => model.includes('seedance-2.5')) : undefined }));
    }
    key = null; app.exit(0); return;
  }
  if (process.argv.includes('--probe-draft')) {
    try {
      const result = await provider.queryTask(process.env.T8_SD55_PROBE_ID, key);
      console.log(JSON.stringify({ probe: 'user-domestic-draft', readOnly: true, status: result.status, hasVideo: Boolean(result.videoUrl), nativeIdMatches: !result.draftTaskId || result.draftTaskId === process.env.T8_SD55_PROBE_ID, upstreamHttpStatus: result.upstreamHttpStatus })); key = null; app.exit(0); return;
    } catch (error) { console.error(JSON.stringify({ probe: 'user-domestic-draft', status: error.status, code: error.code })); key = null; app.exit(1); return; }
  }
  async function run(label, request, video = false) {
    console.log(JSON.stringify({ label, model: request.model, phase: 'start' })); const start = Date.now();
    const journal = path.join(DIRECTORY, label + '-private-task.json');
    if (!fs.existsSync(journal) && fs.readdirSync(DIRECTORY).filter(name => name.endsWith('-private-task.json')).length >= report.maximumCreationPosts) throw Error('Creation cap reached');
    const id = await submitOnce(journal, request.model, request, value => video ? provider.submitTask(value, key) : provider.submitImageTask(value, key));
    const finalFile = path.join(DIRECTORY, label + '-private-final.json'); let result = fs.existsSync(finalFile) ? JSON.parse(fs.readFileSync(finalFile, 'utf8')) : null;
    for (let poll = 0; !result || !['succeeded', 'failed'].includes(result.status); poll++) {
      if (poll >= 540) throw Error('Original task polling timed out; no paid replay');
      result = await (video ? provider.queryTask(id, key) : provider.queryImageTask(id, key));
      console.log(JSON.stringify({ label, phase: 'poll', status: result.status, progress: result.progress }));
      if (['succeeded', 'failed'].includes(result.status)) save(label + '-private-final.json', result); else await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (result.status !== 'succeeded') throw Object.assign(Error('Upstream task failed; no repeat'), { code: 'UPSTREAM_TASK_FAILED' });
    const urls = video ? [result.videoUrl] : result.imageUrls, outputs = [];
    if (!urls?.length) throw Error('Missing outputs');
    for (const [index, url] of urls.entries()) {
      const saved = await download(url, video ? 'video' : 'image', 'sd55-live:' + id + ':' + index); if (!saved.url) throw Error('Download incomplete; GET-only resume');
      const file = path.join(config.OUTPUT_DIR, path.basename(saved.url)), bytes = fs.readFileSync(file), output = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), localFile: path.basename(saved.url) };
      if (video) {
        const media = require('../backend/src/providers/llmMedia');
        const { stdout } = await execute(media.resolveBundledFfprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
        const probe = JSON.parse(stdout), stream = probe.streams.find(s => s.codec_type === 'video'); if (!stream) throw Error('No video stream');
        await execute(media.resolveBundledFfmpeg(), ['-v', 'error', '-threads', '1', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
        Object.assign(output, { width: stream.width, height: stream.height, frames: Number(stream.nb_frames), duration: Number(probe.format.duration), fullDecode: true });
      } else {
        const metadata = await sharp(bytes, { failOn: 'error' }).metadata(); await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
        Object.assign(output, { width: metadata.width, height: metadata.height, format: metadata.format, hasAlpha: metadata.hasAlpha, fullDecode: true });
      }
      outputs.push(output);
    }
    const row = { label, model: request.model, passed: true, outputs, elapsedSeconds: (Date.now() - start) / 1000, upstreamHttpStatus: result.upstreamHttpStatus };
    report.results = report.results.filter(item => item.label !== label); report.results.push(row); save('live-report.json', report); save(label + '-private-local.json', { id, files: outputs.map(o => path.join(config.OUTPUT_DIR, o.localFile)) }); console.log(JSON.stringify({ label, phase: 'passed', outputs: outputs.length }));
    return { id, outputs };
  }
  try {
    if (process.argv.includes('--global-enhance-only')) {
      const original = process.env.T8_SD55_GLOBAL_DRAFT_ID, result = await provider.queryTask(original, key);
      if (result.status !== 'succeeded' || !result.videoUrl) throw Error('User-supplied draft is not completed');
      report.userSuppliedGlobalDraftReadOnlyVerified = true;
      report.initialGlobalSourceSubmission = 'upstream-error-without-task-id-acceptance-unknown-not-replayed';
      await run(process.argv.includes('--retry-after-topup') ? 'global-draft-enhance-after-topup' : 'global-draft-enhance', { model: 'seedance-2.5-global-standard-draft-to-video', draft_task_id: original, output_format: 'mp4', return_last_frame: false }, true);
      report.passed = true; delete report.error; save('live-report.json', report); key = null; app.exit(0); return;
    }
    for (const [region, imagePrefix, videoPrefix] of [['domestic', 'seedream-v5.5', 'seedance-2.5-standard-'], ['global', 'dola-seedream-5.5', 'seedance-2.5-global-standard-']]) {
      const generated = await run(region + '-t2i', { model: imagePrefix + '-t2i', prompt: 'A red toy robot and a blue ceramic teapot, separate objects, clean simple shapes, no lettering, transparent background.', resolution: '1k', output_format: 'png', background: 'transparent' });
      const source = 'data:image/png;base64,' + fs.readFileSync(path.join(config.OUTPUT_DIR, generated.outputs[0].localFile)).toString('base64');
      await run(region + '-i2i', { model: imagePrefix + '-i2i', prompt: 'Keep the robot and teapot, change the robot to green, use a plain cream background.', images: [source], resolution: '1k', output_format: 'jpeg', background: 'opaque' });
      await run(region + '-layer', { model: imagePrefix + '-layer-decomposition', images: [source], resolution: 'auto', output_format: 'png', max_images: 2, text_recognition: true });
      const draft = await run(region + '-draft-source', { model: videoPrefix + 't2v', prompt: 'A red toy robot slowly waves its right arm, plain cream background, fixed camera.', duration: 4, resolution: '480p', ratio: '16:9', draft: true, generate_audio: true }, true);
      await run(region + '-draft-enhance', { model: videoPrefix + 'draft-to-video', draft_task_id: draft.id, output_format: 'mp4', return_last_frame: false }, true);
    }
    report.passed = true; save('live-report.json', report); key = null; app.exit(0);
  } catch (error) { report.passed = false; report.error = { name: error.name, code: error.code || 'LIVE_FAILED', status: error.status, upstreamHttpStatus: error.upstreamHttpStatus, message: String(error.message || '').split(key).join('[redacted]').replace(/https?:\/\/[^\s"']+|task_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500) }; save('live-report.json', report); console.error(JSON.stringify({ phase: 'failed', ...report.error })); key = null; app.exit(1); }
}
async function launch() {
  execFileSync(process.execPath, ['scripts/worktree-role.cjs', 'development'], { cwd: ROOT, stdio: 'inherit' });
  if (!process.argv.includes('--confirm-live') || !process.env.SEEDANCE_NZ_API_KEY) throw Error('Explicit confirmation and process-only key required');
  fs.mkdirSync(DIRECTORY, { recursive: true }); const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-sd55-live-'));
  const env = { ...process.env, T8_SD55_LIVE_PROFILE: scratch, T8PC_DEV_DATA_ROOT: scratch, NODE_OPTIONS: '--max-old-space-size=768' }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--confirm-live', ...['--probe-draft', '--global-enhance-only', '--probe-access', '--retry-after-topup', '--verify-existing-layers'].filter(flag => process.argv.includes(flag))], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); delete process.env.SEEDANCE_NZ_API_KEY; delete env.SEEDANCE_NZ_API_KEY;
  const log = fs.createWriteStream(path.join(DIRECTORY, 'live.log'), { flags: 'a' }); child.stdout.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); }); child.stderr.on('data', chunk => log.write(chunk));
  child.once('exit', code => { log.end(); const target = path.resolve(scratch); if (path.dirname(target) === os.tmpdir() && path.basename(target).startsWith('t8-sd55-live-')) fs.rmSync(target, { recursive: true, force: true }); const probe = ['--probe-draft','--probe-access','--verify-existing-layers'].some(flag => process.argv.includes(flag)); let passed = probe; if (!probe) try { passed = JSON.parse(fs.readFileSync(path.join(DIRECTORY,'live-report.json'),'utf8')).passed === true; } catch {} process.exitCode = passed ? code ?? 1 : 1; });
}
if (require.main === module || process.argv[1] && path.resolve(process.argv[1]) === __filename) (process.argv.includes('--launch') ? launch() : main()).catch(error => { console.error(JSON.stringify({ phase: 'launcher-failed', name: error.name })); if (process.type === 'browser') require('electron').app.exit(1); else process.exitCode = 1; });
