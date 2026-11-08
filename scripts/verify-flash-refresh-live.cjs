'use strict';

// Isolated paid verification, not a replacement for the production shared Run ledger.
// Resume only saved task identities. An ambiguous POST is never replayed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const sharp = require('sharp');
const { submitOnce, safeError } = require('./verify-seedream-flash-live.cjs');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const root = path.resolve(__dirname, '..');
const runName = process.env.T8_FLASH_REFRESH_VERIFY_RUN || 'flash-refresh-20261108-live-20261010';
if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(runName)) throw new Error('Invalid isolated verification directory name');
const directory = path.join(root, 'local-private', runName);
const CASES = [
 ...['2k','4k'].map(resolution=>({id:'g26-'+resolution,model:'zhenzhen-image-g-v2.6-lowprice',kind:'image',resolution})),
 {id:'g26-gif',model:'zhenzhen-image-g-v2.6-lowprice',kind:'image',gif:true},
 ...Object.keys(require('../backend/src/shared/flashVideoContract.json').models).flatMap((model,index)=>['text','image','video'].map(mode=>({id:(index?'omni12':'kling-flash')+'-'+mode,model,kind:'video',mode}))),
];
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function save(file, value) {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
function command(executable, args) {
  return execFileSync(executable, args, { windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
}
async function main() {
  const role = require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development');
  if (!role.ok) throw new Error('Live verification requires an authorized development worktree');
  const key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key) throw new Error('SEEDANCE_NZ_API_KEY is required (process environment only)');
  const { app, session } = require('electron');
  if (!app) throw new Error('Run in Electron without ELECTRON_RUN_AS_NODE, or use --launch');
  const scratch = process.env.T8_FLASH_REFRESH_PROFILE;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-flash-refresh-20261108-')) throw Error('Isolated profile required');
  app.setPath('userData', scratch);
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  const outputDir = path.join(directory, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : { schema: 't8-flash-refresh-20261108-live-v1', channel: 'seedance-nz', startedAt: new Date().toISOString(), results: {} };
  const log = (id, phase, status) => process.stdout.write(`${JSON.stringify({ id, phase, ...(status ? { status } : {}) })}\n`);
  try {
    await app.whenReady();
    const network = session.fromPartition('t8-flash-refresh-20261108-live');
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
    const image = path.join(directory, 'reference.png');
    const video = path.join(directory, 'reference.mp4');
    if (!fs.existsSync(image)) await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><rect width="768" height="768" fill="#e0f2fe"/><ellipse cx="384" cy="400" rx="180" ry="250" fill="#164e63"/><ellipse cx="384" cy="460" rx="130" ry="170" fill="white"/><circle cx="324" cy="270" r="18" fill="white"/><circle cx="444" cy="270" r="18" fill="white"/><path d="M354 310 L414 310 L384 350Z" fill="#fbbf24"/><rect x="560" y="470" width="110" height="120" rx="18" fill="#fbbf24"/></svg>')).png().toFile(image);
    if (!fs.existsSync(video)) command(resolveBundledFfmpeg(), ['-hide_banner','-loglevel','error','-threads','1','-loop','1','-i',image,'-t','3','-vf','scale=768:768','-r','24','-pix_fmt','yuv420p','-c:v','libx264','-preset','ultrafast',video]);
    let cursor = 0;
    async function worker() {
      while (cursor < CASES.length) {
        const item = CASES[cursor++];
        if (report.results[item.id]?.passed) { log(item.id, 'already-verified'); continue; }
        const input = item.kind === 'image' ? {model:item.model,prompt:item.gif?'A small blue circle gently bouncing on a white background, seamless looping animation.':'A friendly penguin beside a yellow cup, clean soft blue studio, no text.',n:1,output_mode:item.gif?'gif':'image',...(item.gif?{output_format:'gif',size:'auto'}:{output_format:'png',size:'1:1',resolution:item.resolution,quality:'auto'})}
          : {model:item.model,prompt:'The camera stays locked. A friendly penguin gently waves beside a yellow cup.',duration:3,resolution:item.id.startsWith('omni12')?'360p':'720p',ratio:'16:9',...(item.mode==='image'?{refImages:[image]}:item.mode==='video'?{videos:[video]}:{})};
        try {
          log(item.id, 'submit-or-resume');
          const taskId = await submitOnce(path.join(directory, `${item.id}.state.private.json`), item.model, input,
            (body) => item.kind === 'image' ? provider.submitImageTask(body, key) : provider.submitTask(body, key));
          const started = Date.now();
          let result;
          let previous = '';
          let polls = 0;
          while (Date.now() - started < 60 * 60_000) {
            result = item.kind === 'image' ? await provider.queryImageTask(taskId, key) : await provider.queryTask(taskId, key);
            polls += 1;
            if (result.status !== previous) log(item.id, 'poll', result.status);
            previous = result.status;
            if (result.status === 'failed') throw new Error(result.failReason || 'Provider original task failed');
            if (result.status === 'succeeded') break;
            await new Promise((resolve) => setTimeout(resolve, 10_000));
          }
          if (result?.status !== 'succeeded') throw new Error('Original task remains nonterminal; resume polling only');
          const urls = item.kind === 'image' ? result.imageUrls : [result.videoUrl].filter(Boolean);
          if (!urls?.length) throw new Error('Succeeded task has no output');
          const outputs = [];
          for (const [index, url] of urls.entries()) {
            const downloaded = await media.fetchProxyRemoteMedia(url, { trustedProviderOutput: true, allowedKinds: [item.kind],
              maxBytes: item.kind === 'image' ? 128 * 1024 * 1024 : 512 * 1024 * 1024,
              connectTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS });
            const local = media.storeMaterializedOutputBuffer(downloaded.buffer, item.kind === 'image' ? 'img' : 'video',
              media.verifiedProxyMediaExtension(downloaded), `seedance-nz-${item.kind}:${taskId}:${index}`);
            const filename = path.join(outputDir, path.basename(local));
            let decoded;
            if (item.kind === 'image') {
              const metadata = await sharp(downloaded.buffer, { failOn: 'error', animated:true }).metadata();
              await sharp(downloaded.buffer, { failOn: 'error' }).raw().toBuffer();
              decoded = { width: metadata.width, height: metadata.pageHeight || metadata.height, format: metadata.format, frames:metadata.pages||1, fullDecode: true };
            } else {
              const probe = JSON.parse(command(resolveBundledFfprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename]).toString());
              const video = probe.streams.find((stream) => stream.codec_type === 'video');
              if (!video || Number(probe.format?.duration) <= 0) throw new Error('Video lacks a valid decoded stream/duration');
              command(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', filename, '-map', '0:v:0', '-f', 'null', '-']);
              decoded = { width: video.width, height: video.height, codec: video.codec_name, duration: Number(probe.format.duration),
                audioCodec: probe.streams.find((stream) => stream.codec_type === 'audio')?.codec_name || null, fullDecode: true };
            }
            outputs.push({ index, file: path.relative(root, filename).replace(/\\/g, '/'), bytes: downloaded.buffer.length,
              sha256: digest(downloaded.buffer), ...decoded });
          }
          report.results[item.id] = { passed: true, model: item.model, providerTerminalStatus: result.status, upstreamHttpStatus: result.upstreamHttpStatus,
            polls, requestedResolution: input.resolution, referenceCount: input.images?.length || 0,
            audioCount: input.audios?.length || 0, wavInputConvertedByProductionUploader: item.audio === true, outputs };
          log(item.id, 'verified', 'passed');
        } catch (error) {
          report.results[item.id] = { passed: false, model: item.model, error: safeError(error, key) };
          log(item.id, 'failed', report.results[item.id].error);
        }
        save(reportPath, report);
      }
    }
    await Promise.all([worker(), worker()]);
    report.passed = CASES.every((item) => report.results[item.id]?.passed);
    report.completedAt = new Date().toISOString();
    save(reportPath, report);
    log('all', 'complete', report.passed ? 'passed' : 'incomplete');
    app.exit(report.passed ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${safeError(error, key)}\n`);
    app.exit(1);
  }
}
async function launch() {
  const role = require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development');
  if (!role.ok) throw new Error('Live verification requires an authorized development worktree');
  let key = process.env.SEEDANCE_NZ_API_KEY;
  if (!key) {
    const readline = require('node:readline');
    const { Writable } = require('node:stream');
    process.stdout.write('Waiting for API key on hidden stdin (not written to disk).\n');
    key = await new Promise((resolve) => {
      const input = readline.createInterface({ input: process.stdin, output: new Writable({ write(_chunk, _encoding, done) { done(); } }), terminal: Boolean(process.stdin.isTTY) });
      input.once('line', (line) => { input.close(); resolve(line.trim()); });
    });
  }
  if (!key) throw new Error('API key is required');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-flash-refresh-20261108-'));
  const env = { ...process.env, SEEDANCE_NZ_API_KEY: key, T8_FLASH_REFRESH_PROFILE:scratch };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  delete env.SEEDANCE_NZ_API_KEY;
  key = null;
  child.once('exit', (code) => { fs.rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100}); process.exitCode = code || 0; });
  child.once('error', () => { process.stderr.write('Cannot launch Electron verifier\n'); process.exitCode = 1; });
}
module.exports = { CASES };
if (require.main === module || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  (process.argv.includes('--launch') ? launch() : main()).catch((error) => { process.stderr.write(`${safeError(error)}\n`); process.exit(1); });
}
