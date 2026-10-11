'use strict';
// Isolated verification only. Accepted/ambiguous POSTs are never replayed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { submitOnce, safeError } = require('./verify-seedream-flash-live.cjs');
const { CASES, workflow } = require('./generate-mai-workflows.cjs');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'local-private/mai-live-20261011');
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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-mai-live-'));
  app.setPath('userData', scratch);
  app.disableHardwareAcceleration();
  const outputDir = path.join(directory, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : { schema: 't8-mai-live-v1', channel: 'seedance-nz', startedAt: new Date().toISOString(), results: {} };
  const log = (id, phase, status) => process.stdout.write(`${JSON.stringify({ id, phase, ...(status ? { status } : {}) })}\n`);
  try {
    await app.whenReady();
    const network = session.fromPartition('t8-mai-live');
    const bridge = require('../electron/systemFetchBridge.cjs');
    bridge.installChromiumResponseHeaderBridge(network);
    bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network),
      refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
    const config = require('../backend/src/config');
    config.OUTPUT_DIR = outputDir;
    config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json');
    const provider = require('../backend/src/providers/seedanceNz');
    const media = require('../backend/src/routes/proxy')._test;
    for (const item of CASES) {
      if (report.results[item.id]?.passed) { log(item.id, 'already-verified'); continue; }
      const node = workflow(item).nodes.find((node) => node.id === 'generation').data;
      const sources = ['mai-image-2-6-t2i', 'mai-image-2-6-flash-t2i'];
      // Multi-reference tests follow both text tasks, preserving reference order.
      const images = Array.from({ length: item.references }, (_, index) => {
        const file = report.results[sources[index]]?.outputs?.[0]?.file;
        if (!file) throw new Error('Decoded generated reference unavailable; no submission performed');
        return path.join(root, file);
      });
      const input = { model: item.model, prompt: node.prompt, n: 1, web_grounding: node.maiWebGrounding,
        ...(images.length ? { images } : node.maiSize === 'custom_pixels' ? { width: node.maiWidth, height: node.maiHeight }
          : { size: node.maiSize, resolution: node.maiResolution, auto_aspect_ratio: node.maiAutoAspectRatio }) };
      try {
        log(item.id, 'submit-or-resume');
        const taskId = await submitOnce(path.join(directory, `${item.id}.state.private.json`), item.model, input,
          (body) => provider.submitImageTask(body, key));
        const started = Date.now();
        let result, previous = '', polls = 0;
        while (Date.now() - started < 60 * 60_000) {
          result = await provider.queryImageTask(taskId, key); polls++;
          if (result.status !== previous) log(item.id, 'poll', result.status);
          previous = result.status;
          if (result.status === 'failed') throw new Error(result.failReason || 'Original task failed');
          if (result.status === 'succeeded') break;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        if (result?.status !== 'succeeded') throw new Error('Original task nonterminal; resume GET only');
        if (result.imageUrls?.length !== 1) throw new Error('Mai must return exactly one image');
        const downloaded = await media.fetchProxyRemoteMedia(result.imageUrls[0], { trustedProviderOutput: true, allowedKinds: ['image'],
          maxBytes: 128 * 1024 * 1024, connectTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
          deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS });
        const metadata = await sharp(downloaded.buffer, { failOn: 'error' }).metadata();
        const raw = await sharp(downloaded.buffer, { failOn: 'error' }).raw().toBuffer();
        const stats = await sharp(downloaded.buffer).stats();
        if (metadata.format !== 'png' || !raw.length || !stats.channels.some((channel) => channel.stdev > 1)) throw new Error('Invalid/blank PNG result');
        const local = media.storeMaterializedOutputBuffer(downloaded.buffer, 'img', media.verifiedProxyMediaExtension(downloaded), `seedance-nz-image:${taskId}:0`);
        report.results[item.id] = { passed: true, model: item.model, referenceCount: images.length, upstreamHttpStatus: result.upstreamHttpStatus,
          providerTerminalStatus: result.status, polls, elapsedSeconds: (Date.now() - started) / 1000,
          outputs: [{ file: path.relative(root, path.join(outputDir, path.basename(local))).replace(/\\/g, '/'),
            bytes: downloaded.buffer.length, sha256: crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),
            width: metadata.width, height: metadata.height, format: metadata.format, fullDecode: true, nonBlank: true }] };
        log(item.id, 'verified', 'passed');
      } catch (error) { report.results[item.id] = { passed: false, model: item.model, error: safeError(error, key) }; log(item.id, 'failed', report.results[item.id].error); }
      save(reportPath, report);
    }
    report.passed = CASES.every((item) => report.results[item.id]?.passed);
    report.completedAt = new Date().toISOString(); save(reportPath, report);
    app.exit(report.passed ? 0 : 1);
  } catch (error) { process.stderr.write(`${safeError(error, key)}\n`); app.exit(1); }
}
async function launch() {
  process.stdout.write('Waiting for API key on hidden stdin (not saved).\n');
  const { Writable } = require('node:stream');
  const input = require('node:readline').createInterface({ input: process.stdin,
    output: new Writable({ write(_chunk, _encoding, done) { done(); } }), terminal: Boolean(process.stdin.isTTY) });
  let key = process.env.SEEDANCE_NZ_API_KEY || await new Promise((resolve) => input.once('line', (line) => { input.close(); resolve(line.trim()); }));
  input.close();
  if (!key) throw new Error('API key required');
  const env = { ...process.env, SEEDANCE_NZ_API_KEY: key }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  delete env.SEEDANCE_NZ_API_KEY; key = null;
  child.once('exit', (code) => { process.exitCode = code || 0; });
  child.once('error', () => { process.stderr.write('Cannot launch verifier\n'); process.exitCode = 1; });
}
if (require.main === module || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  (process.argv.includes('--launch') ? launch() : main()).catch((error) => { process.stderr.write(`${safeError(error)}\n`); process.exit(1); });
}
