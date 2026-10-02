'use strict';

// Isolated verification only; production nodes continue to use the shared Run ledger.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const contract = require('../backend/src/shared/seedreamNzContract.json');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const root = path.resolve(__dirname, '..');
const MODELS = [
  'dola-seedream-5.0-flash-t2i', 'dola-seedream-5.0-flash-i2i',
  'seedream-v5-flash-t2i', 'seedream-v5-flash-i2i', 'dola-seedream-5.0-flash-layer-decomposition',
  'seedream-v5-flash-layer-decomposition',
];
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function atomicJson(file, value) {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
function safeError(error, secret) {
  return String(error?.message || error).split(secret || '\0').join('[redacted]')
    .replace(/https?:\/\/[^\s"']+/gi, '[remote-url]').slice(0, 500);
}
async function submitOnce(file, model, input, submit) {
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const inputDigest = digest(JSON.stringify(input));
  if (state) {
    if (state.model !== model || state.inputDigest !== inputDigest) throw new Error('Saved task input changed; refusing a new paid submission');
    if (state.taskId) return state.taskId;
    throw new Error('Prior submission acceptance is unknown; refusing to replay the paid POST');
  }
  atomicJson(file, { model, inputDigest, acceptance: 'unknown', startedAt: new Date().toISOString() });
  const result = await submit(input);
  if (result.model !== model) throw new Error('Provider adapter selected an unexpected model');
  atomicJson(file, { model, inputDigest, taskId: result.taskId, acceptance: 'accepted', acceptedAt: new Date().toISOString() });
  return result.taskId;
}

async function main() {
  const key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key) throw new Error('SEEDANCE_NZ_API_KEY is required (process environment only)');
  const { app, session } = require('electron');
  if (!app) throw new Error('Run using Electron without ELECTRON_RUN_AS_NODE');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-seedream-flash-'));
  app.setPath('userData', scratch);
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  const directory = path.join(root, 'local-private', 'seedream-flash-live-20261002');
  const outputDir = path.join(directory, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : { schema: 't8-seedream-flash-live-v1', models: MODELS, startedAt: new Date().toISOString(), results: {} };
  report.models = MODELS;
  const log = (model, phase, status) => process.stdout.write(`${JSON.stringify({ model, phase, ...(status ? { status } : {}) })}\n`);
  try {
    await app.whenReady();
    const networkSession = session.fromPartition('t8-seedream-flash-live');
    const { installGlobalSystemFetchBridge, installChromiumResponseHeaderBridge } = require('../electron/systemFetchBridge.cjs');
    installChromiumResponseHeaderBridge(networkSession);
    installGlobalSystemFetchBridge({
      chromiumFetch: networkSession.fetch.bind(networkSession),
      resolveHost: networkSession.resolveHost.bind(networkSession),
      refreshNetwork: async () => { await networkSession.forceReloadProxyConfig(); await networkSession.clearHostResolverCache(); },
    });
    const config = require('../backend/src/config');
    config.OUTPUT_DIR = outputDir;
    config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json');
    const provider = require('../backend/src/providers/seedanceNz');
    const media = require('../backend/src/routes/proxy')._test;
    let reference = report.results[MODELS[0]]?.outputs?.[0]?.file;
    for (const model of MODELS) {
      if (report.results[model]?.passed) { log(model, 'already-verified'); continue; }
      const layer = contract.layerModels.includes(model);
      const editing = model.endsWith('-i2i');
      if ((layer || editing) && !reference) throw new Error('A decoded generated scene is required for editing/decomposition');
      const input = {
        model,
        prompt: layer ? '' : editing
          ? 'Keep the penguin and objects in their original positions. Change the teapot to bright red and the background to pale blue.'
          : 'A friendly penguin standing next to a yellow ceramic teapot and a small green plant on a wooden table, soft pale background, distinct separate objects, clean detailed illustration, no text.',
        ...(layer || editing ? { images: [path.join(root, reference)] } : {}),
        resolution: layer ? 'auto' : '1.5k', output_format: 'png',
      };
      log(model, 'submit-or-resume');
      const taskId = await submitOnce(path.join(directory, `${model}.state.private.json`), model, input,
        (body) => provider.submitImageTask(body, key));
      let result;
      const started = Date.now();
      let last = '';
      while (Date.now() - started < 60 * 60_000) {
        result = await provider.queryImageTask(taskId, key);
        if (result.status !== last) log(model, 'poll', result.status);
        last = result.status;
        if (result.status === 'failed') throw new Error(result.failReason || 'Provider task failed');
        if (result.status === 'succeeded') break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (result?.status !== 'succeeded') throw new Error('Original task remains nonterminal; only resume polling, never resubmit');
      const urls = result.imageUrls;
      if (!urls?.length || (layer && urls.length < 2)) throw new Error('Missing image/base-and-layer outputs');
      const outputs = [];
      for (const [index, url] of urls.entries()) {
        const downloaded = await media.fetchProxyRemoteMedia(url, {
          trustedProviderOutput: true, allowedKinds: ['image'], maxBytes: 128 * 1024 * 1024,
          connectTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
          deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
        });
        const metadata = await sharp(downloaded.buffer, { failOn: 'error' }).metadata();
        await sharp(downloaded.buffer, { failOn: 'error' }).raw().toBuffer();
        const local = media.storeMaterializedOutputBuffer(downloaded.buffer, 'img', media.verifiedProxyMediaExtension(downloaded), `seedance-nz-image:${taskId}:${index}`);
        const file = path.relative(root, path.join(outputDir, path.basename(local))).replace(/\\/g, '/');
        outputs.push({ index, file, bytes: downloaded.buffer.length, sha256: digest(downloaded.buffer),
          officialCosDomainRecovery: downloaded.providerResultDomainFallback === 'tencent-cos',
          width: metadata.width, height: metadata.height, format: metadata.format, hasAlpha: metadata.hasAlpha === true });
        log(model, 'downloaded', `${index + 1}/${urls.length}`);
      }
      report.results[model] = { passed: true, providerTerminalStatus: 'succeeded', upstreamHttpStatus: result.upstreamHttpStatus,
        resolution: input.resolution, outputFormat: input.output_format, referenceCount: input.images?.length || 0,
        outputCount: urls.length, preservedProviderOrder: true, decodedEveryOutput: true, outputs };
      report.passed = MODELS.every((item) => report.results[item]?.passed);
      atomicJson(reportPath, report);
      if (model === MODELS[0]) reference = outputs[0].file;
    }
    if (process.env.SEEDREAM_FLASH_VERIFY_COS_ALIAS === '1') {
      const model = MODELS[0];
      const state = JSON.parse(fs.readFileSync(path.join(directory, `${model}.state.private.json`), 'utf8'));
      const original = await provider.queryImageTask(state.taskId, key);
      const { tencentCosResultUrlFallback } = require('../backend/src/utils/safeRemoteMediaFetch');
      const alias = tencentCosResultUrlFallback(original.imageUrls[0]);
      if (!alias) throw new Error('Original output is not an eligible official COS bucket endpoint');
      const bytes = (await media.fetchProxyRemoteMedia(alias, {
        trustedProviderOutput: true, allowedKinds: ['image'], maxBytes: 128 * 1024 * 1024,
        deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
      })).buffer;
      await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
      if (digest(bytes) !== report.results[model].outputs[0].sha256) throw new Error('Official COS alias returned different bytes');
      report.officialCosAliasProbe = { passed: true, readOnly: true, sameOutputSha256: true, decoded: true, bytes: bytes.length };
      log(model, 'official-cos-alias-probe', 'passed');
    }
    report.completedAt = new Date().toISOString();
    delete report.error;
    atomicJson(reportPath, report);
    log('all', 'complete', report.passed ? 'passed' : 'incomplete');
  } catch (error) {
    report.passed = false;
    report.error = safeError(error, key);
    atomicJson(reportPath, report);
    process.stderr.write(`${JSON.stringify({ phase: 'failed', error: report.error })}\n`);
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode || 0);
    // userData scratch is OS temporary; Electron may still hold Chromium files at exit.
  }
}
module.exports = { MODELS, submitOnce, safeError };
if (require.main === module || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  main().catch((error) => { process.stderr.write(`${safeError(error)}\n`); process.exit(1); });
}
