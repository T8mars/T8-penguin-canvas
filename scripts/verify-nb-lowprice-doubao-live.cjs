'use strict';
// Isolated verification, never a substitute for the production shared Run ledger.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const sharp = require('sharp');
const { submitOnce, safeError } = require('./verify-seedream-flash-live.cjs');
const { CASES, imageWorkflow } = require('./generate-nb-lowprice-doubao-workflows.cjs');
const contract = require('../backend/src/shared/nbLowpriceDoubaoContract.json');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../backend/src/providers/providerTimeoutPolicy');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'local-private/nb-lowprice-doubao-live-20261013');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function save(file, value) {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
function sample() {
  const infoPath = path.join(directory, 'voice-sample-info.private.json');
  if (fs.existsSync(infoPath)) {
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    if (digest(fs.readFileSync(info.file)) !== info.sha256) throw new Error('Voice sample changed; no paid POST performed');
    return info;
  }
  if (process.platform !== 'win32') throw new Error('This isolated fixture requires installed Windows English speech synthesis');
  const file = path.join(directory, 'voice-sample.wav');
  if (fs.existsSync(file)) throw new Error('Unbound sample already exists; inspect it instead of overwriting');
  const text = 'Good morning. This is a clear voice sample for a local speech test. The little penguin is standing beside a yellow cup.';
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const code = `$t8Voice = New-Object -ComObject SAPI.SpVoice; $t8Voices = $t8Voice.GetVoices('Language=409'); if ($t8Voices.Count -lt 1) { throw 'Installed English voice unavailable' }; $t8Voice.Voice=$t8Voices.Item(0); $t8Stream=New-Object -ComObject SAPI.SpFileStream; $t8Stream.Open(${quote(file)},3,$false); $t8Voice.AudioOutputStream=$t8Stream; [void]$t8Voice.Speak(${quote(text)}); $t8Stream.Close()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', code], {
    windowsHide: true, timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1024 * 1024,
  });
  const info = { file, text, language: '1', customSpeaker: `T8LocalTest${crypto.randomBytes(6).toString('hex')}`,
    sha256: digest(fs.readFileSync(file)), source: 'installed-English-synthetic-voice' };
  save(infoPath, info);
  return info;
}
async function main() {
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Authorized development worktree required');
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const key = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
  delete process.env.SEEDANCE_NZ_API_KEY;
  if (!key) throw new Error('API key required in process environment');
  const { app, session } = require('electron');
  if (!app) throw new Error('Use --launch');
  const scratch = process.env.T8_NB_DOUBAO_SCRATCH;
  delete process.env.T8_NB_DOUBAO_SCRATCH;
  if (!scratch || path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('t8-nb-doubao-')) throw new Error('Isolated temporary profile required');
  app.setPath('userData', scratch); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu');
  const outputDir = path.join(directory, 'outputs'); fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : { schema: 't8-nb-lowprice-doubao-live-v1', channel: 'seedance-nz', startedAt: new Date().toISOString(), results: {} };
  const log = (id, phase, status) => process.stdout.write(`${JSON.stringify({ id, phase, ...(status ? { status } : {}) })}\n`);
  try {
    await app.whenReady();
    const network = session.fromPartition('t8-nb-doubao-live');
    const bridge = require('../electron/systemFetchBridge.cjs');
    bridge.installChromiumResponseHeaderBridge(network);
    bridge.installGlobalSystemFetchBridge({ chromiumFetch: network.fetch.bind(network), resolveHost: network.resolveHost.bind(network),
      refreshNetwork: async () => { await network.forceReloadProxyConfig(); await network.clearHostResolverCache(); } });
    const config = require('../backend/src/config'); config.OUTPUT_DIR = outputDir; config.SETTINGS_FILE = path.join(scratch, 'unused-settings.json');
    const provider = require('../backend/src/providers/seedanceNz');
    const media = require('../backend/src/routes/proxy')._test;
    const { resolveBundledFfmpeg, resolveBundledFfprobe } = require('../backend/src/providers/llmMedia');
    const download = url => media.fetchProxyRemoteMedia(url, { trustedProviderOutput: true, allowedKinds: ['image', 'audio'],
      maxBytes: 128 * 1024 * 1024, connectTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
      deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS, idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS });
    const poll = async (id, model, taskId, kind) => {
      const started = Date.now(); let result, previous = '', polls = 0;
      while (Date.now() - started < 60 * 60_000) {
        result = kind === 'image' ? await provider.queryImageTask(taskId, key) : await provider.queryAudioTask(taskId, key, { model });
        polls++;
        if (result.status !== previous) log(id, 'poll', result.status);
        previous = result.status;
        if (result.status === 'failed') throw new Error(result.failReason || 'Original task failed');
        if (result.status === 'succeeded') return { ...result, polls, elapsedSeconds: (Date.now() - started) / 1000 };
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      throw new Error('Original task remains nonterminal; resume GET only');
    };
    for (const item of CASES) {
      if (report.results[item.id]?.passed) { log(item.id, 'already-verified'); continue; }
      const node = imageWorkflow(item).nodes.find(node => node.id === 'generation').data;
      try {
        const images = Array.from({ length: item.references }, (_, index) => {
          const file = report.results[`${contract.banana.models[index % 2]}-t2i`]?.outputs?.[0]?.file;
          if (!file) throw new Error('Decoded reference unavailable; no paid POST performed');
          return path.join(root, file);
        });
        const input = { model: item.model, prompt: node.prompt, n: 1, size: node.aspectRatio, resolution: '1k', ...(images.length ? { images } : {}) };
        log(item.id, 'submit-or-resume');
        const taskId = await submitOnce(path.join(directory, `${item.id}.state.private.json`), item.model, input, body => provider.submitImageTask(body, key));
        const result = await poll(item.id, item.model, taskId, 'image');
        if (result.imageUrls?.length !== 1) throw new Error('NB Lowprice must return exactly one image');
        const remote = await download(result.imageUrls[0]);
        const metadata = await sharp(remote.buffer, { failOn: 'error' }).metadata();
        await sharp(remote.buffer, { failOn: 'error' }).raw().toBuffer();
        const stats = await sharp(remote.buffer).stats();
        if (!stats.channels.some(channel => channel.stdev > 1)) throw new Error('Blank image');
        const local = media.storeMaterializedOutputBuffer(remote.buffer, 'img', media.verifiedProxyMediaExtension(remote), `seedance-nz-image:${taskId}:0`);
        report.results[item.id] = { passed: true, model: item.model, referenceCount: images.length, providerTerminalStatus: result.status,
          upstreamHttpStatus: result.upstreamHttpStatus, polls: result.polls, elapsedSeconds: result.elapsedSeconds,
          outputs: [{ file: path.relative(root, path.join(outputDir, path.basename(local))).replace(/\\/g, '/'), bytes: remote.buffer.length,
            sha256: digest(remote.buffer), width: metadata.width, height: metadata.height, format: metadata.format, fullDecode: true, nonBlank: true }] };
        log(item.id, 'verified', 'passed');
      } catch (error) { report.results[item.id] = { passed: false, model: item.model, error: safeError(error, key) }; log(item.id, 'failed', report.results[item.id].error); }
      save(reportPath, report);
    }
    const speakerFile = path.join(directory, 'speaker.private.json');
    for (const model of [contract.audio.cloneModel, contract.audio.iclModel]) {
      if (report.results[model]?.passed) { log(model, 'already-verified'); continue; }
      try {
        const clone = model === contract.audio.cloneModel;
        const info = clone ? sample() : null;
        const speaker = !clone && fs.existsSync(speakerFile) ? JSON.parse(fs.readFileSync(speakerFile, 'utf8')).speaker : '';
        if (!clone && !speaker) throw new Error('Authoritative trained speaker unavailable; no paid POST performed');
        const input = clone ? { model, prompt: 'Good morning.', audioUrls: [info.file], doubaoVoice: {
          language: info.language, reference_text: info.text, custom_speaker_id: info.customSpeaker, enable_audio_denoise: false,
        } } : { model, prompt: 'Good morning.', speaker, doubaoVoice: { voice_model: 'seed-tts-2.0-standard', format: 'mp3', sample_rate: '24000', speech_rate: 0, explicit_language: 'en' } };
        log(model, 'submit-or-resume');
        const taskId = await submitOnce(path.join(directory, `${model}.state.private.json`), model, input, body => provider.submitAudioTask(body, key));
        const result = await poll(model, model, taskId, 'audio');
        if (clone && !result.resultText) throw new Error('Training did not return an authoritative speaker ID');
        const urls = result.audioUrls;
        if (!urls?.length) throw new Error('Missing audio output');
        const outputs = [];
        for (const [index, url] of urls.entries()) {
          const remote = await download(url);
          const local = media.storeMaterializedOutputBuffer(remote.buffer, 'audio', media.verifiedProxyMediaExtension(remote), `seed-audio-nz:${taskId}:${index}`);
          const file = path.join(outputDir, path.basename(local));
          const metadata = JSON.parse(execFileSync(resolveBundledFfprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 }).toString());
          const stream = metadata.streams?.find(item => item.codec_type === 'audio');
          const pcm = execFileSync(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', file, '-vn', '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], { windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
          let energy = 0;
          for (let offset = 0; offset + 4 <= pcm.length; offset += 4) { const value = pcm.readFloatLE(offset); if (!Number.isFinite(value)) throw new Error('Invalid decoded audio'); energy += value * value; }
          if (!stream || !pcm.length || energy < 0.00001) throw new Error('Invalid or silent audio');
          outputs.push({ index, file: path.relative(root, file).replace(/\\/g, '/'), bytes: remote.buffer.length, sha256: digest(remote.buffer),
            codec: stream.codec_name, sampleRate: Number(stream.sample_rate), channels: stream.channels, duration: Number(metadata.format?.duration), fullDecode: true, nonSilent: true });
        }
        if (clone) save(speakerFile, { speaker: result.resultText, taskId, source: 'authoritative-data.result_text' });
        report.results[model] = { passed: true, model, providerTerminalStatus: result.status, upstreamHttpStatus: result.upstreamHttpStatus,
          polls: result.polls, elapsedSeconds: result.elapsedSeconds, outputCount: outputs.length, preservedProviderOrder: true,
          ...(clone ? { authoritativeSpeakerReturned: true, syntheticEnglishSample: true } : { usedSameAccountTrainedSpeaker: true }), outputs };
        log(model, 'verified', 'passed');
      } catch (error) { report.results[model] = { passed: false, model, error: safeError(error, key) }; log(model, 'failed', report.results[model].error); }
      save(reportPath, report);
    }
    report.passed = [...CASES.map(item => item.id), contract.audio.cloneModel, contract.audio.iclModel].every(id => report.results[id]?.passed);
    report.completedAt = new Date().toISOString(); save(reportPath, report);
    app.exit(report.passed ? 0 : 1);
  } catch (error) { process.stderr.write(`${safeError(error, key)}\n`); app.exit(1); }
}
async function launch() {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  process.stdout.write('Waiting for API key on hidden stdin (not saved).\n');
  const { Writable } = require('node:stream');
  const input = require('node:readline').createInterface({ input: process.stdin, output: new Writable({ write(_chunk, _encoding, done) { done(); } }), terminal: Boolean(process.stdin.isTTY) });
  let key = process.env.SEEDANCE_NZ_API_KEY || await new Promise(resolve => input.once('line', line => { input.close(); resolve(line.trim()); }));
  input.close(); if (!key) throw new Error('API key required');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-nb-doubao-'));
  const env = { ...process.env, SEEDANCE_NZ_API_KEY: key, T8_NB_DOUBAO_SCRATCH: scratch }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['--js-flags=--max-old-space-size=768', __filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  delete env.SEEDANCE_NZ_API_KEY; key = null;
  child.once('exit', code => {
    if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-nb-doubao-')) {
      try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { process.stderr.write('Owned temporary profile cleanup pending\n'); }
    }
    process.exitCode = code || 0;
  });
  child.once('error', () => { process.stderr.write('Cannot launch verifier\n'); process.exitCode = 1; });
}
if (require.main === module || process.argv.some(value => path.resolve(value) === __filename)) {
  (process.argv.includes('--launch') ? launch() : main()).catch(error => { process.stderr.write(`${safeError(error)}\n`); process.exit(1); });
}
