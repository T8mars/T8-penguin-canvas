'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');
const {
  inspectIndexTtsJob,
  runIndexTtsDialogue,
} = require('../backend/src/services/localizationMaster.js');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('localization runtime has no ComfyUI HTTP, 8188, prompt-queue, or ComfyUI provider dependency', () => {
  const files = [
    'backend/src/services/localizationMaster.js',
    'backend/src/routes/localizationMaster.js',
    'backend/src/tools/localizationRuntime/worker.py',
    'src/services/localizationMaster.ts',
    'src/components/nodes/LocalizationMasterNode.tsx',
  ];
  const source = files.map(read).join('\n');
  for (const forbidden of [
    /127\.0\.0\.1:8188/i,
    /\/prompt(?:\b|\/)/i,
    /\/queue(?:\b|\/)/i,
    /comfyBaseUrl/i,
    /providers[\\/]comfyui/i,
    /websocket.*comfy/i,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /requiresComfyUI:\s*false/);
  assert.match(source, /embedded-index-tts-2\.5/);
});

test('runtime probe imports native dependencies and installer repairs the torch stack last', () => {
  const worker = read('backend/src/tools/localizationRuntime/worker.py');
  const service = read('backend/src/services/localizationMaster.js');
  assert.match(worker, /importlib\.import_module\(name\)/);
  assert.match(worker, /torchaudioImportReady/);
  assert.match(worker, /torchvisionImportReady/);
  assert.match(worker, /abiCompatible/);
  assert.match(worker, /stackCompatible/);
  assert.match(worker, /"dependenciesReady": not missing and not import_errors/);
  const dependencies = service.indexOf('async function installDependencies');
  const commonInstall = service.indexOf("'accelerate>=1.8.1,<2'", dependencies);
  const finalTorchStack = service.indexOf('await installTorchStack(', commonInstall);
  assert.ok(dependencies >= 0 && commonInstall > dependencies && finalTorchStack > commonInstall);
  assert.match(service, /--force-reinstall', '--no-deps'/);
  assert.match(service, /'torchvision==0\.25\.0'/);
  assert.match(service, /const nonTorchMissing =/);
  assert.match(service, /hasNvidiaGpu\(\) && initialProbe\?\.torch\?\.cudaAvailable !== true/);
  assert.match(service, /const accelerationReady = !nvidiaAvailable \|\| probe\.torch\?\.cudaAvailable === true/);
});

test('auxiliary models are pinned, verified during install, and inference is offline-only', () => {
  const worker = read('backend/src/tools/localizationRuntime/worker.py');
  const installer = read('backend/src/tools/localizationRuntime/download_auxiliary.py');
  const service = read('backend/src/services/localizationMaster.js');
  const manifest = JSON.parse(read('backend/src/tools/localizationRuntime/auxiliary-models.json'));
  assert.equal(manifest.schema, 't8-indextts25-auxiliary-model-manifest-v1');
  assert.equal(manifest.files.length, 11);
  assert.equal(new Set(manifest.files.map((item) => item.destination)).size, manifest.files.length);
  for (const item of manifest.files) {
    assert.match(item.revision, /^[a-f0-9]{40}$/u);
    assert.match(item.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(item.size > 0);
  }
  assert.match(installer, /hf_hub_download/);
  assert.match(installer, /revision=str\(entry\["revision"\]\)/);
  assert.match(installer, /os\.replace\(temporary_path, destination\)/);
  assert.match(installer, /validate_all\(cache_root, manifest, verify_hash=True\)/);
  assert.match(worker, /auxiliary_model_probe\(model_root, verify_hashes=False\)/);
  assert.match(worker, /拒绝在推理时临时联网下载/);
  assert.match(worker, /faster-whisper-small/);
  assert.doesNotMatch(worker, /WhisperModel\("base"/);
  assert.match(worker, /infer_v2_5\.save_pcm_wav = save_engine_pcm_wav/);
  assert.match(worker, /with wave\.open\(str\(destination\), "wb"\)/);
  assert.match(worker, /T8_INDEXTTS25_ASR_DEVICE", "cpu"/);
  assert.match(service, /T8_INDEXTTS25_ASR_DEVICE \|\| 'cpu'/);
  assert.match(worker, /spoken_text = str\(unit\.get\("pronunciation"\)/);
  assert.match(worker, /qwen_emotion = model\.ensure_qwen_emotion\(\)/);
  assert.match(worker, /"emotionControl": emotion_control/);
  assert.match(worker, /text-emotion-unavailable:/);
  assert.match(worker, /score = similarity\(spoken_text, recognized, language\)/);
  assert.match(worker, /OpenCC\("t2s"\)\.convert\(value\)/);
  assert.match(worker, /str\.maketrans\("0123456789", "零一二三四五六七八九"\)/);
  assert.doesNotMatch(service, /torchcodec/iu);
  const coreDownload = service.indexOf("'--accept-license', '--skip-aux'");
  const auxiliaryDownload = service.indexOf("AUXILIARY_INSTALLER_PATH, '--model-root'");
  const localReceipt = service.indexOf('async function acceptIndexTtsModelLicense');
  const installGate = service.indexOf('await requireIndexTtsModelLicense()', coreDownload - 5_000);
  assert.ok(localReceipt >= 0 && installGate >= 0 && coreDownload > installGate && auxiliaryDownload > coreDownload);
  assert.match(service, /modelRevision: MODEL_REVISION/);
  assert.match(service, /画布中的旧确认不会被信任/);
  const verifier = read('scripts/verify-localization-indextts-live.cjs');
  assert.match(verifier, /acceptIndexTtsModelLicense\(\{ accepted: true \}\)/);
  assert.match(service, /env\.HF_HUB_OFFLINE = '1'/);
  assert.match(service, /env\.TRANSFORMERS_OFFLINE = '1'/);
  assert.match(service, /atrim=0:/);
  assert.match(service, /afade=t=in/);
  assert.match(service, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0/);
  assert.match(service, /\[1:a:0\]apad\[a\]/);
});

test('packaged app ships the standalone Worker and both platforms resolve a managed Python runtime', () => {
  const pkg = JSON.parse(read('package.json'));
  const workerResource = pkg.build.extraResources.find((item) => item.to === 'backend-enc/tools/localizationRuntime');
  assert.ok(workerResource);
  assert.deepEqual(workerResource.filter, ['worker.py', 'download_auxiliary.py']);
  const encryptedBackend = pkg.build.extraResources.find((item) => item.to === 'backend-enc');
  assert.ok(encryptedBackend);
  assert.ok(encryptedBackend.filter.includes('**/*'));
  assert.equal(
    workerResource.filter.includes('auxiliary-models.json'),
    false,
    'auxiliary-models.json is already copied into build/backend-enc and must not be mapped twice on macOS',
  );
  const service = read('backend/src/services/localizationMaster.js');
  assert.match(service, /remove-ai-watermarks-runtime/);
  assert.match(service, /indextts25-python/);
  assert.match(service, /--engine-root/);
  const mac = read('scripts/prepare-macos-runtime.cjs');
  assert.match(mac, /python-build-standalone/);
  assert.match(mac, /aarch64-apple-darwin-install_only/);
  assert.match(mac, /archiveSha256/);
});

test('schema exposes typed source, voice, video, audio, subtitle, and manifest ports', () => {
  const schema = JSON.parse(read('backend/src/shared/canvasNodeSchema.json'));
  const ports = schema.connectionPorts['localization-master'];
  assert.deepEqual(ports.inputs.map((item) => item.id), ['source-media', 'source-text', 'voice-references']);
  assert.deepEqual(ports.outputs.map((item) => item.id), ['localized-video', 'dubbed-audio', 'subtitles', 'manifest']);
  const meta = schema.types.find((item) => item.type === 'localization-master');
  assert.equal(meta.executable, true);
  assert.match(meta.description, /无需启动 ComfyUI/);
});

test('IndexTTS jobs persist verified results across retries without rerunning the worker, including Unicode paths', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 't8-本地化-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const jobsRoot = path.join(root, '任务缓存');
  const outputDir = path.join(root, '输出目录');
  const reference = path.join(root, '授权参考音色.wav');
  await fs.promises.writeFile(reference, Buffer.from('RIFF-reference-audio'));
  let workerCalls = 0;
  const workerRequest = async (_action, payload) => {
    workerCalls += 1;
    await fs.promises.mkdir(payload.outputDir, { recursive: true });
    const suffix = `fixture-${workerCalls}`;
    const audioPath = path.join(payload.outputDir, `localization_dub_${suffix}.wav`);
    const subtitlePath = path.join(payload.outputDir, `localization_subtitles_${suffix}.srt`);
    const reportPath = path.join(payload.outputDir, `localization_report_${suffix}.json`);
    const subtitleText = '1\n00:00:00,000 --> 00:00:01,000\n[Narrator] Hello T8\n';
    const report = { schema: 't8-localization-indextts25-execution-report-v1', language: payload.language, lines: [] };
    await Promise.all([
      fs.promises.writeFile(audioPath, Buffer.from('RIFF-persisted-fixture-audio')),
      fs.promises.writeFile(subtitlePath, subtitleText, 'utf8'),
      fs.promises.writeFile(reportPath, JSON.stringify(report), 'utf8'),
    ]);
    return { audioPath, subtitlePath, reportPath, subtitleText, report };
  };
  const input = {
    modelLicenseConfirmed: true,
    jobKey: 'canvas-run/attempt/EN',
    language: 'EN',
    units: [{ index: 1, role: 'Narrator', translatedText: 'Hello T8', startMs: 0, endMs: 1000 }],
    roles: [{ role: 'Narrator', referenceUrl: reference, consentConfirmed: true }],
    timelinePolicy: 'shift',
    timingMode: 'pad',
    asrEnabled: false,
    asrRetryCount: 0,
    asrThreshold: 0.82,
    subtitleTimingMode: 'actual',
    subtitleTextMode: 'original',
    subtitleIncludeRole: true,
    postprocessPreset: 'off',
    postprocessStrength: 0,
  };
  const options = {
    jobsRoot,
    outputDir,
    ensureAudioFile: async (filename) => ({ path: filename, temporary: false, mime: 'audio/wav' }),
    workerRequest,
  };
  const first = await runIndexTtsDialogue(input, options);
  assert.equal(first.reused, false);
  assert.match(first.jobId, /^tts-[a-f0-9]{32}$/);
  assert.equal(workerCalls, 1);
  const second = await runIndexTtsDialogue(input, options);
  assert.equal(second.reused, true);
  assert.equal(second.jobId, first.jobId);
  assert.equal(workerCalls, 1);
  const inspected = await inspectIndexTtsJob(first.jobId, options);
  assert.equal(inspected.status, 'complete');
  assert.equal(inspected.outputVerified, true);
  const persisted = await fs.promises.readFile(path.join(jobsRoot, first.jobId, 'manifest.json'), 'utf8');
  assert.equal(persisted.includes(input.jobKey), false);
  assert.equal(persisted.includes(reference), false);
  await fs.promises.appendFile(path.join(outputDir, `localization_dub_${first.jobId}.wav`), 'corrupt');
  await assert.rejects(
    runIndexTtsDialogue(input, options),
    (error) => error.code === 'LOCALIZATION_TTS_RECOVERY_CONFIRMATION_REQUIRED' && error.status === 409,
  );
  assert.equal(workerCalls, 1);
});
