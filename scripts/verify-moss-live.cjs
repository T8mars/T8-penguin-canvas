'use strict';
// Isolated verifier only: never replay an accepted or ambiguous paid POST.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { submitOnce, safeError } = require('./verify-seedream-flash-live.cjs');
const { CASES, workflow } = require('./generate-moss-workflows.cjs');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'local-private/moss-live-20261023');
function save(file, value) {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
async function main() {
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Authorized development worktree required');
  const key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key) throw new Error('API key required in process environment');
  const { app, session } = require('electron');
  if (!app) throw new Error('Use --launch');
  const scratch = process.env.T8_MOSS_VERIFY_PROFILE;
  if (!scratch || path.dirname(scratch) !== os.tmpdir() || !path.basename(scratch).startsWith('t8-moss-launch-')) throw new Error('Isolated launcher profile required');
  app.setPath('userData', scratch); app.setPath('sessionData', scratch);
  app.disableHardwareAcceleration();
  const outputDir = path.join(directory, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : { schema: 't8-moss-live-v1', channel: 'seedance-nz', startedAt: new Date().toISOString(), results: {} };
  const log = (id, phase, status) => process.stdout.write(`${JSON.stringify({ id, phase, ...(status ? { status } : {}) })}\n`);
  try {
    await app.whenReady();
    const network = session.fromPartition('t8-moss-live');
    const bridge = require('../electron/systemFetchBridge.cjs');
    bridge.installChromiumResponseHeaderBridge(network);
    bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network),
      refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
    const config = require('../backend/src/config');
    config.OUTPUT_DIR = outputDir; config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json');
    const provider = require('../backend/src/providers/seedanceNz');
    const media = require('../backend/src/routes/proxy')._test;
    for (const item of CASES) {
      if (report.results[item.id]?.passed) { log(item.id, 'already-verified'); continue; }
      const node = workflow(item).nodes.find((node) => node.id === 'generation').data;
      const images = [];
      if (item.references) {
        const generated = report.results['moss-image-t2i']?.outputs?.[0]?.file || report.results['moss-image-square-t2i']?.outputs?.[0]?.file;
        if (generated) images.push(path.join(root, generated));
        else {
          // Independent deterministic fixture: an upstream text failure must not prevent checking the upload/edit path.
          const file = path.join(directory, 'reference-fixture.png');
          if (!fs.existsSync(file)) await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><rect width="768" height="1024" fill="#bde5f7"/><ellipse cx="300" cy="520" rx="160" ry="240" fill="#182635"/><ellipse cx="300" cy="560" rx="110" ry="165" fill="white"/><circle cx="250" cy="390" r="16" fill="white"/><circle cx="350" cy="390" r="16" fill="white"/><path d="M275 440L325 440L300 475Z" fill="orange"/><rect x="500" y="580" width="140" height="150" rx="20" fill="#f8cf36"/><circle cx="650" cy="640" r="45" fill="none" stroke="#f8cf36" stroke-width="20"/></svg>')).png().toFile(file);
          images.push(file);
        }
      }
      const input = { model: item.model, prompt: node.prompt, ratio: node.aspectRatio, ...(images.length ? { images } : {}) };
      let lastResult;
      try {
        log(item.id, 'submit-or-resume');
        const taskId = await submitOnce(path.join(directory, `${item.id}.state.private.json`), item.model, input,
          (body) => provider.submitImageTask(body, key));
        const started = Date.now(); let result, previous = '', polls = 0;
        while (Date.now() - started < MIN_PROVIDER_MEDIA_TIMEOUT_MS) {
          result = await provider.queryImageTask(taskId, key); polls++;
          lastResult = result;
          if (result.status !== previous) log(item.id, 'poll', result.status);
          previous = result.status;
          if (result.status === 'failed') throw new Error(result.failReason || 'Original task failed');
          if (result.status === 'succeeded') break;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        if (result?.status !== 'succeeded') throw new Error('Original task nonterminal; resume GET only');
        if (result.imageUrls?.length !== 1) throw new Error('Expected exactly one Moss image');
        const downloaded = await media.fetchProxyRemoteMedia(result.imageUrls[0], { trustedProviderOutput: true, allowedKinds: ['image'],
          maxBytes: 128 * 1024 * 1024, connectTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
          deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS });
        const metadata = await sharp(downloaded.buffer, { failOn: 'error' }).metadata();
        const raw = await sharp(downloaded.buffer, { failOn: 'error' }).raw().toBuffer();
        const stats = await sharp(downloaded.buffer).stats();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !raw.length || !stats.channels.some((channel) => channel.stdev > 1)) throw new Error('Invalid/blank image result');
        const local = media.storeMaterializedOutputBuffer(downloaded.buffer, 'img', media.verifiedProxyMediaExtension(downloaded), `seedance-nz-image:${taskId}:0`);
        report.results[item.id] = { passed: true, model: item.model, referenceCount: images.length, ratio: node.aspectRatio,
          upstreamHttpStatus: result.upstreamHttpStatus, providerTerminalStatus: result.status, polls,
          elapsedSeconds: (Date.now() - started) / 1000,
          outputs: [{ file: path.relative(root, path.join(outputDir, path.basename(local))).replace(/\\/g, '/'),
            bytes: downloaded.buffer.length, sha256: crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),
            width: metadata.width, height: metadata.height, format: metadata.format, fullDecode: true, nonBlank: true }] };
        log(item.id, 'verified', 'passed');
      } catch (error) {
        report.results[item.id] = { passed: false, model: item.model, referenceCount: images.length, ratio: node.aspectRatio,
          ...(lastResult ? { providerTerminalStatus: lastResult.status, upstreamHttpStatus: lastResult.upstreamHttpStatus, usage: lastResult.usage } : {}),
          error: safeError(error, key) };
        log(item.id, 'failed', report.results[item.id].error);
      }
      save(reportPath, report);
    }
    report.passed = CASES.every((item) => report.results[item.id]?.passed);
    report.requiredModesPassed = [0, 1].every((count) => CASES.some((item) => item.references === count && report.results[item.id]?.passed));
    report.completedAt = new Date().toISOString(); save(reportPath, report);
    app.exit(report.passed ? 0 : 1);
  } catch (error) { process.stderr.write(`${safeError(error, key)}\n`); app.exit(1); }
}
async function launch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-moss-launch-'));
  // Parent owns the exact temporary profile so cleanup happens after Electron releases it.
  let key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  if (!key) {
    process.stdout.write('Waiting for API key on hidden stdin (not saved).\n');
    const { Writable } = require('node:stream');
    const input = require('node:readline').createInterface({ input: process.stdin,
      output: new Writable({ write(_chunk, _encoding, done) { done(); } }), terminal: Boolean(process.stdin.isTTY) });
    key = await new Promise((resolve) => input.once('line', (line) => { input.close(); resolve(line.trim()); })); input.close();
  }
  if (!key) throw new Error('API key required');
  const env = { ...process.env, SEEDANCE_NZ_API_KEY: key, T8_MOSS_VERIFY_PROFILE: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  delete env.SEEDANCE_NZ_API_KEY; key = null;
  const cleanup = () => fs.rmSync(scratch, { recursive: true, force: true });
  child.once('exit', (code) => { cleanup(); process.exitCode = code ?? 1; });
  child.once('error', () => { cleanup(); process.stderr.write('Cannot launch verifier\n'); process.exitCode = 1; });
}
if (require.main === module || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  (process.argv.includes('--launch') ? launch() : main()).catch((error) => { process.stderr.write(`${safeError(error)}\n`); process.exit(1); });
}
