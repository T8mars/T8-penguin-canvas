// ============================================================================
// _post_build.js — electron-builder 完成后的产物核验脚本
//
// 职责:
//   1. 检查 dist_electron/win-unpacked/resources/backend-enc/*.t8c 是否存在
//   2. 检查 frontend/index.html 是否到位
//   3. 强制移除任何意外混入的明文 backend/src/*.js (双保险)
//   4. 运行本地私有扩展的可选分发检查
//   5. 输出最终产物清单
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  exactTopLevelVersion,
  latestInstallerMetadata,
} = require('../scripts/latest-yml.cjs');
const { assertElectronAppAsar } = require('../scripts/electron-asar-contract.cjs');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = require(path.join(ROOT, 'package.json'));
const APP_VERSION = PACKAGE_JSON.version;
const PRODUCT_NAME = PACKAGE_JSON.build && PACKAGE_JSON.build.productName
  ? PACKAGE_JSON.build.productName
  : 'T8-PenguinCanvas';
const UNPACKED = path.join(ROOT, 'dist_electron', 'win-unpacked');
const RES = path.join(UNPACKED, 'resources');
let missingCount = 0;
const CANVAS_AGENT_INTEGRITY_MANIFEST = 'canvas-agent-source-integrity.json';
const CANVAS_AGENT_INTEGRITY_FILES = Object.freeze([
  { source: 'routes/canvasAgentTools.js', output: 'routes/canvasAgentTools.t8c', format: 't8c' },
  { source: 'services/canvasAgentTools.js', output: 'services/canvasAgentTools.t8c', format: 't8c' },
  { source: 'services/canvasAgentPublicView.js', output: 'services/canvasAgentPublicView.t8c', format: 't8c' },
  { source: 'services/runEvidenceDiagnosis.js', output: 'services/runEvidenceDiagnosis.t8c', format: 't8c' },
  { source: 'shared/canvasNodeSchema.json', output: 'shared/canvasNodeSchema.json', format: 'json' },
]);
const RUNTIME_ARCHIVE_REQUIREMENTS = Object.freeze({
  'remove-ai-watermarks': Object.freeze({
    id: 'remove-ai-watermarks',
    archiveFile: 'remove-ai-watermarks-runtime.zip',
    minimumArchiveBytes: 500_000_000,
    minimumSourceFiles: 40_000,
    minimumSourceBytes: 1_000_000_000,
    requiredEntries: Object.freeze([
      'python/python.exe',
      'python/Scripts/remove-ai-watermarks.exe',
      'runtime-manifest.json',
    ]),
  }),
  'parsehub-pythonlibs': Object.freeze({
    id: 'parsehub-pythonlibs',
    archiveFile: 'parsehub-pythonlibs.zip',
    minimumArchiveBytes: 50_000_000,
    minimumSourceFiles: 6_000,
    minimumSourceBytes: 200_000_000,
    requiredEntries: Object.freeze([
      'parsehub/__init__.py',
    ]),
  }),
});

function ok(p) {
  console.log('  ✅', path.relative(UNPACKED, p));
}
function bad(p) {
  console.log('  ❌ MISSING', path.relative(UNPACKED, p));
}

function checkFile(p) {
  if (fs.existsSync(p)) ok(p);
  else {
    missingCount += 1;
    bad(p);
  }
}

function checkFrontendAsset(prefix, ext) {
  const assetsDir = path.join(RES, 'frontend', 'assets');
  const label = path.join(assetsDir, `${prefix}*${ext}`);
  if (!fs.existsSync(assetsDir)) {
    missingCount += 1;
    bad(label);
    return;
  }
  const found = fs.readdirSync(assetsDir).find((name) => name.startsWith(prefix) && name.endsWith(ext));
  if (found) ok(path.join(assetsDir, found));
  else {
    missingCount += 1;
    bad(label);
  }
}

function checkAchievementMedia() {
  const mediaRoot = path.join(RES, 'resources', 'achievement-media');
  const encryptedRewards = [
    'film-tech-01.mp4.t8media',
    'film-rh-01.mp4.t8media',
    'film-yyh-01.mp4.t8media',
    'film-dragon-ball-01.mp4.t8media',
    'film-saint-seiya-01.mp4.t8media',
    'film-tetris-01.mp4.t8media',
  ];
  for (const fileName of encryptedRewards) {
    checkFile(path.join(mediaRoot, fileName));
  }
  for (const file of walkFiles(mediaRoot)) {
    if (path.extname(file).toLowerCase() === '.mp4') {
      failSecurity('achievement reward video must be encrypted before packaging:', file);
    }
  }
}

function checkWebImageExtensionResources() {
  const extensionRoot = path.join(RES, 'extension', 'web-image-reverse');
  checkFile(path.join(extensionRoot, 'manifest.json'));
  checkFile(path.join(extensionRoot, 'popup.html'));
  checkFile(path.join(extensionRoot, 'sidepanel.html'));
  checkFile(path.join(extensionRoot, 'scripts', 'asset-panel.js'));
  checkFile(path.join(extensionRoot, 'scripts', 'background.js'));
  checkFile(path.join(extensionRoot, 'scripts', 'content.js'));
  checkFile(path.join(extensionRoot, 'scripts', 'runninghub-bridge.js'));
  checkFile(path.join(extensionRoot, 'styles', 'asset-panel.css'));
  checkFile(path.join(extensionRoot, 'styles', 'content.css'));
}

function checkNoLocalVibexRoute() {
  const localRoute = path.join(RES, 'backend-enc', 'routes', 'vibex.t8c');
  if (fs.existsSync(localRoute)) {
    failSecurity('local VibeX static adapter must not be shipped in online-only releases:', localRoute);
  }
  console.log('  ✅ local VibeX static adapter route is not packaged');
}

function listDir(p, indent = '    ') {
  if (!fs.existsSync(p)) return;
  for (const name of fs.readdirSync(p)) {
    const full = path.join(p, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      console.log(indent + '📁', name);
      listDir(full, indent + '    ');
    } else {
      console.log(indent + '📄', name, `(${st.size}B)`);
    }
  }
}

function nukePlainBackend() {
  // electron-builder 不应该把明文 backend/src 打进 asar/resources;若存在则强制删
  const candidates = [
    path.join(RES, 'app', 'backend', 'src'),
    path.join(RES, 'backend', 'src'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      console.log('  🧹 nuke plaintext:', path.relative(UNPACKED, c));
      fs.rmSync(c, { recursive: true, force: true });
    }
  }
}

function rel(p) {
  return path.relative(UNPACKED, p);
}

function failSecurity(message, p) {
  console.error('  ❌ SECURITY', message, p ? rel(p) : '');
  process.exit(1);
}

function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  const handle = fs.openSync(filename, 'r');
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function require7zaForRuntimeVerification() {
  const candidates = [
    process.env.T8_RUNTIME_ARCHIVE_7Z,
    process.platform === 'win32'
      ? path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe')
      : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) {}
  }
  try {
    const sevenZip = require('7zip-bin');
    if (sevenZip?.path7za && fs.existsSync(sevenZip.path7za)) return sevenZip.path7za;
  } catch (_) {}
  failSecurity('strict runtime archive verification requires system 7-Zip or 7zip-bin');
  return '';
}

function normalizeArchiveEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function verifyPackagedRuntimeArchive(requirement, archive, manifestPath) {
  if (!fs.existsSync(archive)) failSecurity(`packaged runtime archive is missing: ${requirement.id}`, archive);
  if (!fs.existsSync(manifestPath)) failSecurity(`packaged runtime manifest is missing: ${requirement.id}`, manifestPath);

  const archiveStat = fs.statSync(archive);
  if (!archiveStat.isFile() || archiveStat.size < requirement.minimumArchiveBytes) {
    failSecurity(
      `packaged runtime archive is implausibly small: ${requirement.id} (${archiveStat.size} bytes)`,
      archive,
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    failSecurity('packaged runtime archive manifest must be valid JSON:', manifestPath);
  }
  const entry = manifest?.runtimes?.[requirement.id];
  if (!entry
    || entry.archiveFile !== requirement.archiveFile
    || Number(entry.archiveBytes || 0) !== archiveStat.size
    || Number(entry.sourceFiles || 0) < requirement.minimumSourceFiles
    || Number(entry.sourceBytes || 0) < requirement.minimumSourceBytes
    || !/^[a-f0-9]{64}$/i.test(String(entry.sourceSha256 || ''))
    || !/^[a-f0-9]{64}$/i.test(String(entry.archiveSha256 || ''))) {
    failSecurity(`packaged runtime archive manifest entry is invalid: ${requirement.id}`, manifestPath);
  }

  const archiveSha256 = sha256File(archive);
  if (archiveSha256 !== String(entry.archiveSha256).toLowerCase()) {
    failSecurity(`packaged runtime archive SHA-256 mismatch: ${requirement.id}`, archive);
  }

  const path7za = require7zaForRuntimeVerification();
  const commonOptions = {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  };
  // Keep formal-release verification bounded on creator workstations. 7-Zip's
  // default worker count can contend with Electron/NSIS immediately after a
  // large build and has produced transient CRC failures even when the copied
  // archive SHA-256 is byte-for-byte identical to the verified source.
  const testResult = spawnSync(
    path7za,
    ['t', '-mmt=2', '-bso0', '-bsp0', '-bb0', '--', archive],
    commonOptions,
  );
  if (testResult.error || testResult.status !== 0) {
    failSecurity(`packaged runtime archive CRC verification failed: ${requirement.id}`, archive);
  }
  const listResult = spawnSync(path7za, ['l', '-slt', '-bsp0', '-bb0', '--', archive], commonOptions);
  if (listResult.error || listResult.status !== 0) {
    failSecurity(`packaged runtime archive entry listing failed: ${requirement.id}`, archive);
  }
  const archiveEntries = new Set(
    String(listResult.stdout || '')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('Path = '))
      .map((line) => normalizeArchiveEntry(line.slice('Path = '.length))),
  );
  const missingEntries = requirement.requiredEntries.filter((requiredEntry) => {
    return !archiveEntries.has(normalizeArchiveEntry(requiredEntry));
  });
  if (missingEntries.length > 0) {
    failSecurity(
      `packaged runtime archive is missing required entries: ${requirement.id} (${missingEntries.join(', ')})`,
      archive,
    );
  }
  console.log(`  ✅ ${requirement.id} archive SHA-256, CRC and required entries verified`);
}

function isPlausibleRuntimeFile(filePath, minimumBytes = 16 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size >= minimumBytes;
  } catch (_) {
    return false;
  }
}

function verifyDirectAiWatermarkRuntime(runtimeRoot) {
  if (!fs.existsSync(runtimeRoot)) return false;
  const layouts = [
    [path.join(runtimeRoot, 'remove-ai-watermarks.exe')],
    [path.join(runtimeRoot, 'Scripts', 'remove-ai-watermarks.exe')],
    [
      path.join(runtimeRoot, 'python', 'python.exe'),
      path.join(runtimeRoot, 'python', 'Scripts', 'remove-ai-watermarks.exe'),
    ],
    [
      path.join(runtimeRoot, '.venv', 'Scripts', 'python.exe'),
      path.join(runtimeRoot, '.venv', 'Scripts', 'remove-ai-watermarks.exe'),
    ],
  ];
  const layout = layouts.find((requiredFiles) => (
    requiredFiles.every((filePath) => isPlausibleRuntimeFile(filePath))
  ));
  if (!layout) {
    failSecurity('direct remove-ai-watermarks runtime is incomplete or implausibly small:', runtimeRoot);
  }
  layout.forEach(ok);
  const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
  if (fs.existsSync(manifestPath)) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
      failSecurity('direct remove-ai-watermarks runtime manifest must be valid JSON:', manifestPath);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      failSecurity('direct remove-ai-watermarks runtime manifest must be an object:', manifestPath);
    }
    ok(manifestPath);
  } else if (process.env.T8_REQUIRE_AI_WATERMARK_RUNTIME === '1') {
    failSecurity('required direct remove-ai-watermarks runtime manifest is missing:', manifestPath);
  }
  return true;
}

function verifyDirectParseHubRuntime(libsRoot) {
  if (!fs.existsSync(libsRoot)) return false;
  const packageEntry = path.join(libsRoot, 'parsehub', '__init__.py');
  if (!isPlausibleRuntimeFile(packageEntry, 64)) {
    failSecurity('direct ParseHub runtime is incomplete or implausibly small:', packageEntry);
  }
  ok(packageEntry);
  return true;
}

function checkCanvasAgentIntegrity() {
  const manifestPath = path.join(RES, 'backend-enc', CANVAS_AGENT_INTEGRITY_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    missingCount += 1;
    bad(manifestPath);
    return;
  }
  ok(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    failSecurity('canvas Agent integrity manifest must be valid JSON:', manifestPath);
  }
  if (manifest?.schema !== 't8-canvas-agent-electron-integrity-v1'
    || manifest?.hashAlgorithm !== 'sha256'
    || !Array.isArray(manifest?.entries)
    || manifest.entries.length !== CANVAS_AGENT_INTEGRITY_FILES.length) {
    failSecurity('canvas Agent integrity manifest schema or entry count is invalid:', manifestPath);
  }
  const entries = new Map(manifest.entries.map((entry) => [entry?.source, entry]));
  if (entries.size !== CANVAS_AGENT_INTEGRITY_FILES.length) {
    failSecurity('canvas Agent integrity manifest contains duplicate sources:', manifestPath);
  }
  for (const expected of CANVAS_AGENT_INTEGRITY_FILES) {
    const entry = entries.get(expected.source);
    if (!entry || entry.output !== expected.output || entry.format !== expected.format
      || !/^[a-f0-9]{64}$/.test(String(entry.sourceSha256 || ''))
      || !/^[a-f0-9]{64}$/.test(String(entry.outputSha256 || ''))) {
      failSecurity(`canvas Agent integrity entry is invalid: ${expected.source}`, manifestPath);
    }
    const sourcePath = path.join(ROOT, 'backend', 'src', ...expected.source.split('/'));
    const outputPath = path.join(RES, 'backend-enc', ...expected.output.split('/'));
    if (!fs.existsSync(sourcePath)) failSecurity('canvas Agent integrity source is missing:', sourcePath);
    if (!fs.existsSync(outputPath)) failSecurity('canvas Agent integrity output is missing:', outputPath);
    if (sha256File(sourcePath) !== entry.sourceSha256) {
      failSecurity(`canvas Agent encrypted output was built from stale source: ${expected.source}`, sourcePath);
    }
    if (sha256File(outputPath) !== entry.outputSha256) {
      failSecurity(`canvas Agent packaged output SHA-256 mismatch: ${expected.output}`, outputPath);
    }
    if (expected.format === 'json' && entry.sourceSha256 !== entry.outputSha256) {
      failSecurity('canvas Agent packaged node schema differs from source JSON:', outputPath);
    }
    if (expected.format === 't8c') {
      const header = fs.readFileSync(outputPath).subarray(0, 7).toString('utf8');
      if (header !== 'T8ENC1\n') failSecurity('canvas Agent backend source is not encrypted:', outputPath);
    }
  }
  console.log('  ✅ canvas Agent source/output SHA-256 integrity verified');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkFiles(root, out = []) {
  if (!fs.existsSync(root)) return out;
  const st = fs.statSync(root);
  if (!st.isDirectory()) return out;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const item = fs.statSync(full);
    if (item.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function isSmallTextFile(p) {
  const ext = path.extname(p).toLowerCase();
  if (!['.json', '.js', '.cjs', '.mjs', '.html', '.txt', '.env', '.yml', '.yaml', '.toml'].includes(ext)) {
    return false;
  }
  try {
    return fs.statSync(p).size <= 2 * 1024 * 1024;
  } catch (_) {
    return false;
  }
}

function runLocalPostBuildChecks() {
  const disabled = process.env.T8_ENABLE_LOCAL_PRIVATE === '0'
    || process.env.T8_DISABLE_LOCAL_EXTENSIONS === '1';
  const required = process.env.T8_REQUIRE_LOCAL_PRIVATE === '1';
  const hookPath = path.join(ROOT, 'local-private', 'extensions', 'build', 'post-build.cjs');
  if (disabled) {
    if (required) failSecurity('formal release cannot disable local private build hook:', hookPath);
    console.log('  ⚠️  local private build hook disabled by environment');
    return;
  }
  if (!fs.existsSync(hookPath)) {
    if (required) failSecurity('formal release requires local private build hook:', hookPath);
    console.log('  ✅ no local private build hook configured');
    return;
  }
  const hook = require(hookPath);
  const run = typeof hook === 'function' ? hook : hook && hook.runLocalPostBuildChecks;
  if (typeof run !== 'function') {
    failSecurity('local private build hook does not export a runnable check:', hookPath);
  }
  run({
    ROOT,
    PACKAGE_JSON,
    APP_VERSION,
    PRODUCT_NAME,
    UNPACKED,
    RES,
    ok,
    bad,
    checkFile,
    checkFrontendAsset,
    listDir,
    rel,
    failSecurity,
    walkFiles,
    isSmallTextFile,
  });
}

function checkRequiredLocalPrivateArtifacts() {
  if (process.env.T8_REQUIRE_LOCAL_PRIVATE !== '1') return;
  const requiredBackend = [
    path.join(RES, 'backend-enc', 'local-private', 'extensions', 'backend', 'index.t8c'),
    path.join(RES, 'backend-enc', 'local-private', 'recharge', 'backend', 'routes.t8c'),
  ];
  for (const file of requiredBackend) {
    if (!fs.existsSync(file)) failSecurity('formal release missing encrypted local private backend:', file);
    ok(file);
  }

  const forbiddenPlaintext = [
    path.join(RES, 'backend-enc', 'local-private', 'extensions', 'backend', 'index.cjs'),
    path.join(RES, 'backend-enc', 'local-private', 'recharge', 'backend', 'routes.cjs'),
  ];
  for (const file of forbiddenPlaintext) {
    if (fs.existsSync(file)) failSecurity('formal release leaked local private backend source:', file);
  }

  console.log('  ✅ formal release local private frontend/backend artifacts verified');
}

function checkAiWatermarkRuntime(resourcesRoot = RES) {
  const runtimeRoot = path.join(resourcesRoot, 'tools', 'remove-ai-watermarks');
  const archiveRoot = path.join(resourcesRoot, 'tools', 'runtime-archives');
  const archive = path.join(archiveRoot, 'remove-ai-watermarks-runtime.zip');
  const archiveManifest = path.join(archiveRoot, 'runtime-archives-manifest.json');
  const required = process.env.T8_REQUIRE_AI_WATERMARK_RUNTIME === '1';
  const archiveStrict = process.env.T8_REQUIRE_RUNTIME_ARCHIVES === '1';
  if (archiveStrict) {
    verifyPackagedRuntimeArchive(
      RUNTIME_ARCHIVE_REQUIREMENTS['remove-ai-watermarks'],
      archive,
      archiveManifest,
    );
    ok(archive);
    ok(archiveManifest);
    verifyDirectAiWatermarkRuntime(runtimeRoot);
    return;
  }
  if (verifyDirectAiWatermarkRuntime(runtimeRoot)) return;
  if (fs.existsSync(archive)) {
    ok(archive);
    if (fs.existsSync(archiveManifest)) ok(archiveManifest);
    else {
      missingCount += 1;
      bad(archiveManifest);
    }
    if (required) {
      verifyPackagedRuntimeArchive(
        RUNTIME_ARCHIVE_REQUIREMENTS['remove-ai-watermarks'],
        archive,
        archiveManifest,
      );
    }
    return;
  }
  const message = 'remove-ai-watermarks sidecar runtime not bundled; packaged app will require PATH/env installed CLI';
  if (required) failSecurity(message, runtimeRoot);
  console.log('  ⚠️ ', message);
  console.log('     Set T8_REQUIRE_AI_WATERMARK_RUNTIME=1 for user-release builds that must be offline/self-contained.');
}

function loadPackagedVideoTransitions() {
  const catalogPath = path.join(RES, 'shared', 'videoTransitions.json');
  if (!fs.existsSync(catalogPath)) {
    missingCount += 1;
    bad(catalogPath);
    return [];
  }
  let catalog = null;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  } catch (_) {
    failSecurity('packaged videoTransitions.json must be valid JSON:', catalogPath);
  }
  const transitions = Array.isArray(catalog?.transitions) ? catalog.transitions : [];
  if (transitions.length === 0) {
    failSecurity('packaged videoTransitions.json has no transitions:', catalogPath);
  }
  return transitions;
}

function checkFfmpegRuntime() {
  const runtimeRoot = path.join(RES, 'tools', 'ffmpeg');
  const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffmpeg = path.join(runtimeRoot, binary);
  if (!fs.existsSync(ffmpeg)) {
    missingCount += 1;
    bad(ffmpeg);
    return;
  }
  ok(ffmpeg);
  const result = spawnSync(ffmpeg, ['-hide_banner', '-h', 'filter=xfade'], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0 || !/wipeleft/.test(output) || !/circleopen/.test(output) || !/pixelize/.test(output)) {
    failSecurity('packaged ffmpeg must support xfade high-quality transitions:', ffmpeg);
  }
  const missingTransitions = [];
  for (const transition of loadPackagedVideoTransitions()) {
    if (!transition || transition.quality !== 'native-xfade') continue;
    if (!transition.xfade) {
      missingTransitions.push(`${transition.id || 'unknown'}:missing-xfade`);
      continue;
    }
    const transitionName = String(transition.xfade);
    const supported = new RegExp(`\\b${escapeRegExp(transitionName)}\\b`).test(output);
    if (!supported) missingTransitions.push(`${transition.id || transitionName}:${transitionName}`);
  }
  if (missingTransitions.length > 0) {
    failSecurity(`packaged ffmpeg missing native xfade transitions from catalog: ${missingTransitions.join(', ')}`, ffmpeg);
  }
  const encodersResult = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  const encodersOutput = `${encodersResult.stdout || ''}\n${encodersResult.stderr || ''}`;
  const requiredAssetEncoders = ['libx264', 'aac', 'libwebp'];
  const missingAssetEncoders = requiredAssetEncoders.filter((encoder) => !new RegExp(`\\b${escapeRegExp(encoder)}\\b`).test(encodersOutput));
  if (encodersResult.status !== 0 || missingAssetEncoders.length > 0) {
    failSecurity(`packaged ffmpeg missing intelligent asset preview encoders: ${missingAssetEncoders.join(', ')}`, ffmpeg);
  }
  console.log('  ✅ ffmpeg xfade high-quality transitions verified against packaged catalog');
  console.log('  ✅ ffmpeg H.264/AAC/WebP asset preview encoders verified');
}

function checkFfprobeRuntime() {
  const runtimeRoot = path.join(RES, 'tools', 'ffmpeg');
  const binary = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const ffprobe = path.join(runtimeRoot, binary);
  if (!fs.existsSync(ffprobe)) {
    missingCount += 1;
    bad(ffprobe);
    return;
  }
  ok(ffprobe);
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'testsrc=size=16x16:rate=1:duration=0.1',
    '-show_streams',
    '-show_format',
    '-of', 'json',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    failSecurity('packaged ffprobe must support JSON probing:', ffprobe);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (_) {
    failSecurity('packaged ffprobe returned invalid JSON:', ffprobe);
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  if (!streams.some((stream) => stream && stream.codec_type === 'video')) {
    failSecurity('packaged ffprobe JSON probe did not expose a video stream:', ffprobe);
  }
  console.log('  ✅ packaged ffprobe JSON probe verified');
}

function checkParseHubRuntime(resourcesRoot = RES) {
  const bridge = path.join(resourcesRoot, 'tools', 'parsehub-bridge', 'parsehub_bridge.py');
  const libsRoot = path.join(resourcesRoot, 'tools', 'parsehub-pythonlibs');
  const archiveRoot = path.join(resourcesRoot, 'tools', 'runtime-archives');
  const archive = path.join(archiveRoot, 'parsehub-pythonlibs.zip');
  const archiveManifest = path.join(archiveRoot, 'runtime-archives-manifest.json');
  const strict = process.env.T8_REQUIRE_PARSEHUB_RUNTIME === '1';
  const archiveStrict = process.env.T8_REQUIRE_RUNTIME_ARCHIVES === '1';

  checkFile(bridge);
  if (archiveStrict) {
    verifyPackagedRuntimeArchive(
      RUNTIME_ARCHIVE_REQUIREMENTS['parsehub-pythonlibs'],
      archive,
      archiveManifest,
    );
    ok(archive);
    ok(archiveManifest);
    verifyDirectParseHubRuntime(libsRoot);
    return;
  }
  if (verifyDirectParseHubRuntime(libsRoot)) return;
  if (fs.existsSync(archive)) {
    ok(archive);
    if (fs.existsSync(archiveManifest)) ok(archiveManifest);
    else {
      missingCount += 1;
      bad(archiveManifest);
    }
    if (strict) {
      verifyPackagedRuntimeArchive(
        RUNTIME_ARCHIVE_REQUIREMENTS['parsehub-pythonlibs'],
        archive,
        archiveManifest,
      );
    }
    return;
  }

  const message = 'ParseHub python dependencies not bundled; aggregate parser will require T8_PARSEHUB_LIB_PATHS or system/site installed parsehub';
  if (strict) failSecurity(message, libsRoot);
  console.log('  ⚠️ ', message);
  console.log('     Refresh with: tools\\remove-ai-watermarks-runtime\\python\\python.exe -m pip install --upgrade --target tools\\parsehub-pythonlibs .\\ParseHub, then npm run prepack:runtimes');
}

function checkFigmaBridgeRuntime() {
  const root = path.join(RES, 'tools', 'figma-bridge');
  checkFile(path.join(root, 'server.cjs'));
  checkFile(path.join(root, 'start-figma-bridge.cmd'));
  checkFile(path.join(root, 'plugin', 'manifest.json'));
  checkFile(path.join(root, 'plugin', 'code.js'));
  checkFile(path.join(root, 'plugin', 'ui.html'));
}

function checkPhotoshopBridgeResources() {
  const root = path.join(RES, 'tools', 'photoshop-bridge', 'plugin');
  const sourceRoot = path.join(ROOT, 'tools', 'photoshop-bridge', 'plugin');
  const requiredFiles = [
    'manifest.json',
    'index.html',
    'style.css',
    path.join('js', 'boot.js'),
    path.join('js', 'state.js'),
    path.join('js', 'net.js'),
    path.join('js', 'ps.js'),
    path.join('js', 'app.js'),
  ];
  for (const relativePath of requiredFiles) {
    const packagedPath = path.join(root, relativePath);
    const sourcePath = path.join(sourceRoot, relativePath);
    checkFile(packagedPath);
    if (fs.existsSync(packagedPath) && fs.existsSync(sourcePath) && sha256File(packagedPath) !== sha256File(sourcePath)) {
      failSecurity('packaged Photoshop plugin differs from the authoritative source:', packagedPath);
    }
  }
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.json'), 'utf8'));
  const packagedManifestPath = path.join(root, 'manifest.json');
  if (fs.existsSync(packagedManifestPath)) {
    const packagedManifest = JSON.parse(fs.readFileSync(packagedManifestPath, 'utf8'));
    if (packagedManifest.id !== sourceManifest.id || packagedManifest.version !== sourceManifest.version) {
      failSecurity('packaged Photoshop plugin manifest id/version is stale:', packagedManifestPath);
    }
  }
  const staleArchive = path.join(RES, 'tools', 'photoshop-bridge', 'PS联动插件.rar');
  if (fs.existsSync(staleArchive)) {
    failSecurity('stale Photoshop plugin archive must not be packaged:', staleArchive);
  }
}

function checkUpdateArtifacts() {
  const distDir = path.join(ROOT, 'dist_electron');
  const installerName = `${PRODUCT_NAME}-Setup-${APP_VERSION}.exe`;
  const installer = path.join(distDir, installerName);
  const blockmap = path.join(distDir, `${installerName}.blockmap`);
  const latest = path.join(distDir, 'latest.yml');
  const strict = process.env.T8_REQUIRE_UPDATE_ARTIFACTS === '1';
  const directoryBuild = process.env.T8_DIRECTORY_BUILD === '1';
  const hasInstaller = fs.existsSync(installer);
  const hasBlockmap = fs.existsSync(blockmap);

  if (!strict && (directoryBuild || (!hasInstaller && !hasBlockmap))) {
    console.log('  ⚠️  NSIS update artifacts not present; skipping installer/latest.yml checks for dir build');
    return;
  }

  checkFile(installer);
  checkFile(blockmap);
  checkFile(latest);

  if (fs.existsSync(latest)) {
    const text = fs.readFileSync(latest, 'utf-8');
    if (!exactTopLevelVersion(text, APP_VERSION)) {
      missingCount += 1;
      console.error(`  ❌ latest.yml version mismatch, expected ${APP_VERSION}`);
    } else {
      ok(latest);
    }
    try {
      latestInstallerMetadata(text, installerName);
    } catch (error) {
      missingCount += 1;
      console.error(`  ❌ ${error?.message || String(error)}`);
    }
  }
}

function checkNoRhToolboxMaker() {
  const forbiddenDirs = [
    path.join(RES, 'tools', 'rh-toolbox-maker'),
    path.join(RES, 'rh-toolbox-maker'),
    path.join(RES, 'app', 'rh-toolbox-maker'),
    path.join(RES, 'app.asar.unpacked', 'rh-toolbox-maker'),
  ];
  for (const p of forbiddenDirs) {
    if (fs.existsSync(p)) {
      failSecurity('RH toolbox maker must not be shipped to end users:', p);
    }
  }

  const forbiddenText = [
    /RHToolboxMakerNode/,
    /RH工具箱制作器/,
    /rh-toolbox-maker/,
  ];
  for (const p of walkFiles(path.join(RES, 'frontend')).filter(isSmallTextFile)) {
    const text = fs.readFileSync(p, 'utf-8');
    if (forbiddenText.some((re) => re.test(text))) {
      failSecurity('RH toolbox maker frontend code leaked into packaged assets:', p);
    }
  }
  console.log('  ✅ RH toolbox maker is not present in packaged resources');
}

function isFrontendBundleTextFile(p) {
  const ext = path.extname(p).toLowerCase();
  if (!['.json', '.js', '.mjs', '.html'].includes(ext)) return false;
  try {
    return fs.statSync(p).size <= 20 * 1024 * 1024;
  } catch (_) {
    return false;
  }
}

function extractRhToolboxManifestObjectLiteral(source) {
  const marker = 'export const RH_TOOLBOX_MANIFEST';
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error('RH_TOOLBOX_MANIFEST export not found');
  const start = source.indexOf('{', markerIndex);
  if (start < 0) throw new Error('RH_TOOLBOX_MANIFEST object literal not found');

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('RH_TOOLBOX_MANIFEST object literal is not balanced');
}

function loadRhToolboxReleaseManifestMarkers() {
  const manifestPath = path.join(ROOT, 'src', 'data', 'rhToolboxManifest.ts');
  const source = fs.readFileSync(manifestPath, 'utf-8');
  const literal = extractRhToolboxManifestObjectLiteral(source);
  const manifest = Function(`"use strict"; return (${literal});`)();
  const markers = [];
  for (const tool of Array.isArray(manifest.tools) ? manifest.tools : []) {
    if (!tool || tool.enabled === false || !String(tool.webappId || '').trim()) continue;
    if (String(tool.id || '').trim()) markers.push(String(tool.id).trim());
    markers.push(String(tool.webappId).trim());
  }
  return Array.from(new Set(markers));
}

function checkRhToolboxReleaseManifest() {
  const frontendRoot = path.join(RES, 'frontend');
  if (!fs.existsSync(frontendRoot)) {
    failSecurity('frontend assets missing before RH toolbox release manifest check:', frontendRoot);
  }
  const requiredMarkers = loadRhToolboxReleaseManifestMarkers();
  if (requiredMarkers.length === 0) {
    failSecurity('RH toolbox release manifest has no enabled tools to verify:', frontendRoot);
  }
  const found = new Set();
  for (const p of walkFiles(frontendRoot).filter(isFrontendBundleTextFile)) {
    const text = fs.readFileSync(p, 'utf-8');
    for (const marker of requiredMarkers) {
      if (text.includes(marker)) found.add(marker);
    }
  }
  for (const marker of requiredMarkers) {
    if (!found.has(marker)) {
      failSecurity(`RH toolbox release manifest marker missing from frontend assets: ${marker}`, frontendRoot);
    }
  }
  console.log('  ✅ RH toolbox release manifest is bundled in frontend assets');
}

function checkNoFalToolboxMaker() {
  const forbiddenDirs = [
    path.join(RES, 'tools', 'fal-toolbox-maker'),
    path.join(RES, 'fal-toolbox-maker'),
    path.join(RES, 'app', 'fal-toolbox-maker'),
    path.join(RES, 'app.asar.unpacked', 'fal-toolbox-maker'),
  ];
  for (const p of forbiddenDirs) {
    if (fs.existsSync(p)) {
      failSecurity('FAL toolbox maker must not be shipped to end users:', p);
    }
  }

  const forbiddenText = [
    /FalToolboxMakerNode/,
    /FAL应用制作工具/,
    /fal-toolbox-maker/,
  ];
  for (const p of walkFiles(path.join(RES, 'frontend')).filter(isSmallTextFile)) {
    const text = fs.readFileSync(p, 'utf-8');
    if (forbiddenText.some((re) => re.test(text))) {
      failSecurity('FAL toolbox maker frontend code leaked into packaged assets:', p);
    }
  }
  console.log('  ✅ FAL toolbox maker is not present in packaged resources');
}

function main() {
  console.log('==========================================');
  console.log('[post-build] 验证打包产物');
  console.log('==========================================');

  if (!fs.existsSync(UNPACKED)) {
    console.error('  ❌ dist_electron/win-unpacked 不存在,先跑 npm run dist:dir');
    process.exit(1);
  }

  console.log('[0] Electron app.asar 启动依赖:');
  try {
    const result = assertElectronAppAsar(path.join(RES, 'app.asar'));
    console.log(`  ✅ app.asar startup contract (${result.requiredEntries.length} required files)`);
  } catch (error) {
    missingCount += 1;
    console.error(`  ❌ ${error?.message || error}`);
  }

  console.log('[1] 加密后端字节码:');
  checkFile(path.join(RES, 'backend-enc', 'server.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'config.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'canvas.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'settings.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'proxy.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'externalProviders.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'files.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'imageOps.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'resources.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'themes.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'eagle.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'figma.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'grokOAuth.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'codexCli.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'aiWatermark.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'cloudUploads.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'parseHub.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'achievements.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'topaz.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'vibexBridge.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'videoOps.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'batchTags.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'photoshopBridge.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'feishuBitable.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'webAssets.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'projectRuns.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'projectAssets.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'subflows.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'collaboration.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'routes', 'canvasAgentTools.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'projectDatabase.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'projectDatabaseMigration23.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'projectDatabaseMigration29.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'projectDatabaseMigration30.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetBlobStore.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetUploadManager.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetIndexer.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetPreviewPipeline.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetSemanticModels.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetSemanticWorker.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetSemanticPipeline.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'modelPreviewRenderer.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'assetPublicView.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'runRedaction.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'runLifecycle.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'runErrors.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'runUsage.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'runRecovery.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'canvasAgentTools.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'canvasAgentPublicView.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'services', 'runEvidenceDiagnosis.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'shared', 'canvasNodeSchema.json'));
  checkCanvasAgentIntegrity();
  checkFile(path.join(RES, 'backend-enc', 'collaboration', 'gateway.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'collaboration', 'auth.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'collaboration', 'protocol.t8c'));
  checkFile(path.join(RES, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'));
  checkNoLocalVibexRoute();
  checkFile(path.join(RES, 'backend-enc', 'achievements', 'media.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'achievements', 'store.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'cloudUploads', 'settings.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'cloudUploads', 'uploader.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'extensions', 'runtimeHooks.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'registry.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'mediaResolver.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'adapters.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'openaiCompatible.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'llmMedia.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'modelscope.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'volcengine.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'comfyui.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'providers', 'jimengCli.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'tools', 'aiWatermark', 'runner.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'tools', 'aiWatermark', 'media.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'tools', 'topaz', 'runner.t8c'));
  checkFile(path.join(RES, 'tools', 'asset-semantic', 'semantic_runner.py'));
  checkFile(path.join(RES, 'backend-enc', 'utils', 'duckPayload.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'utils', 'codexCliRunner.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'utils', 'figmaBridge.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'utils', 'parseHubBridge.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'utils', 'runtimeArchive.t8c'));
  checkFile(path.join(RES, 'backend-enc', 'utils', 'safeRemoteMediaFetch.t8c'));

  console.log('\n[2] 前端 dist:');
  checkFile(path.join(RES, 'frontend', 'index.html'));
  checkFile(path.join(RES, 'frontend', 'assets'));
  checkFile(path.join(RES, 'frontend', 'assets', 'face-expression', 't8-ict-neutral-head-v1.glb'));
  checkFile(path.join(RES, 'frontend', 'assets', 'face-expression', 'asset-manifest.json'));
  checkFile(path.join(RES, 'frontend', 'assets', 'face-expression', 'LICENSE-ICT-FaceKit.txt'));
  checkWebImageExtensionResources();
  checkFile(path.join(RES, 'shared', 'achievementManifest.json'));
  checkFile(path.join(RES, 'shared', 'videoTransitions.json'));
  checkFrontendAsset('classic-one-summer-day-', '.mp3');
  checkFrontendAsset('pixel-theme-of-sss-', '.mp3');
  checkFrontendAsset('op-battle-scars-', '.mp3');
  checkFrontendAsset('rh-tide-', '.mp3');
  checkFrontendAsset('rh-hidden-saya-', '.mp3');
  checkFrontendAsset('naruto-shinsei-gyakuten-', '.mp3');
  checkFrontendAsset('eva-decisive-battle-', '.mp3');
  checkFrontendAsset('yyh-unbalanced-kiss-piano-', '.mp3');
  checkFrontendAsset('yyh-hidden-tonight-', '.mp3');
  checkFrontendAsset('slamdunk-kimi-ga-suki-', '.mp3');
  checkFrontendAsset('soccer-tsubasa-burning-hero-', '.mid');
  checkFrontendAsset('dragonball-makafushigi-adventure-', '.mp3');
  checkFrontendAsset('dragonball-shenron-cha-la-head-cha-la-', '.mp3');
  checkFrontendAsset('saint-seiya-pegasus-fantasy-', '.mp3');
  checkFrontendAsset('saint-seiya-hades-last-holy-war-', '.mp3');
  checkFrontendAsset('garden-defense-grasswalk-', '.mp3');
  checkAchievementMedia();

  console.log('\n[3] 清除可能混入的明文后端源码:');
  nukePlainBackend();

  console.log('\n[4] 本地私有扩展分发检查:');
  runLocalPostBuildChecks();
  checkRequiredLocalPrivateArtifacts();

  console.log('\n[5] 去AI水印 sidecar runtime:');
  checkAiWatermarkRuntime();

  console.log('\n[6] ffmpeg sidecar runtime:');
  checkFfmpegRuntime();
  checkFfprobeRuntime();

  console.log('\n[7] ParseHub bridge/runtime:');
  checkParseHubRuntime();

  console.log('\n[8] Figma bridge/plugin:');
  checkFigmaBridgeRuntime();

  console.log('\n[9] Photoshop bridge/plugin:');
  checkPhotoshopBridgeResources();

  console.log('\n[10] RH工具箱制作器分发检查:');
  checkNoRhToolboxMaker();

  console.log('\n[11] RH工具箱发布清单分发检查:');
  checkRhToolboxReleaseManifest();

  console.log('\n[12] FAL应用制作工具分发检查:');
  checkNoFalToolboxMaker();

  console.log('\n[13] GitHub 自动更新资产:');
  checkUpdateArtifacts();

  console.log('\n[14] resources/ 完整结构:');
  listDir(RES);

  if (missingCount > 0) {
    console.error(`\n[post-build] FAILED: ${missingCount} required files are missing`);
    process.exit(1);
  }

  console.log('\n[post-build] DONE ✅');
}

if (require.main === module) main();

module.exports = {
  checkAiWatermarkRuntime,
  checkParseHubRuntime,
  verifyDirectAiWatermarkRuntime,
  verifyDirectParseHubRuntime,
};
