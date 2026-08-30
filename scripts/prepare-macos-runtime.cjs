#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'mac-runtime');
const INDEXTTS_PYTHON = Object.freeze({
  version: '3.12.13',
  release: '20260807',
  filename: 'cpython-3.12.13+20260807-aarch64-apple-darwin-install_only.tar.gz',
  bytes: 25168985,
  sha256: '4201588fc5051c2ba988abbe1f033d318965ee378fadf7fb7ef79882ba7be84b',
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260807/cpython-3.12.13%2B20260807-aarch64-apple-darwin-install_only.tar.gz',
});

function fail(message) {
  throw new Error(`[prepare-macos-runtime] ${message}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || result.stderr || '').trim();
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function packageVersion(name) {
  return String(require(`${name}/package.json`).version);
}

function inspectMachO(filename, expectedArch) {
  const fileOutput = run('/usr/bin/file', [filename]);
  if (!/Mach-O/i.test(fileOutput)) fail(`${path.basename(filename)} is not a Mach-O executable: ${fileOutput}`);
  const archOutput = run('/usr/bin/lipo', ['-archs', filename]);
  const architectures = archOutput.split(/\s+/).filter(Boolean);
  if (!architectures.includes(expectedArch)) {
    fail(`${path.basename(filename)} does not contain ${expectedArch}: ${architectures.join(', ')}`);
  }
  return { fileOutput, architectures };
}

function copyExecutable(source, name, expectedArch) {
  if (!source || !fs.existsSync(source)) fail(`${name} source binary is missing`);
  const destination = path.join(OUT, name);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);
  const inspection = inspectMachO(destination, expectedArch);
  const versionOutput = run(destination, ['-version']);
  if (!new RegExp(`^${name} version`, 'i').test(versionOutput)) {
    fail(`${name} did not return a recognizable version banner`);
  }
  return {
    filename: name,
    bytes: fs.statSync(destination).size,
    sha256: sha256(destination),
    architectures: inspection.architectures,
    versionBanner: versionOutput.split(/\r?\n/, 1)[0],
  };
}

function prepareIndexTtsPython(expectedArch) {
  const downloads = path.join(OUT, '.downloads');
  const archive = path.join(downloads, INDEXTTS_PYTHON.filename);
  const destination = path.join(OUT, 'indextts25-python');
  fs.mkdirSync(downloads, { recursive: true });
  run('/usr/bin/curl', [
    '--fail', '--location', '--retry', '4', '--retry-all-errors',
    '--output', archive, INDEXTTS_PYTHON.url,
  ]);
  const stat = fs.statSync(archive);
  if (stat.size !== INDEXTTS_PYTHON.bytes) {
    fail(`IndexTTS Python archive size mismatch: ${stat.size} != ${INDEXTTS_PYTHON.bytes}`);
  }
  const digest = sha256(archive);
  if (digest !== INDEXTTS_PYTHON.sha256) {
    fail(`IndexTTS Python archive SHA-256 mismatch: ${digest}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  run('/usr/bin/tar', ['-xzf', archive, '-C', destination]);
  const executable = path.join(destination, 'python', 'bin', 'python3');
  if (!fs.existsSync(executable)) fail('IndexTTS embedded Python executable is missing after extraction');
  fs.chmodSync(executable, 0o755);
  const inspection = inspectMachO(executable, expectedArch);
  const versionBanner = run(executable, ['--version']);
  if (!versionBanner.includes(`Python ${INDEXTTS_PYTHON.version}`)) {
    fail(`unexpected IndexTTS Python version: ${versionBanner}`);
  }
  fs.rmSync(downloads, { recursive: true, force: true });
  return {
    distribution: 'astral-sh/python-build-standalone',
    version: INDEXTTS_PYTHON.version,
    release: INDEXTTS_PYTHON.release,
    archiveBytes: INDEXTTS_PYTHON.bytes,
    archiveSha256: INDEXTTS_PYTHON.sha256,
    executable: path.relative(OUT, executable).replace(/\\/g, '/'),
    executableSha256: sha256(executable),
    architectures: inspection.architectures,
    versionBanner,
  };
}

function main() {
  if (process.platform !== 'darwin') fail('this command must run on a real macOS build host');
  if (process.arch !== 'arm64') fail(`the current release contract requires an Apple Silicon runner, got ${process.arch}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const ffmpegSource = require('ffmpeg-static');
  const ffprobePackage = require('@ffprobe-installer/ffprobe');
  const ffprobeSource = ffprobePackage && ffprobePackage.path;
  const ffmpeg = copyExecutable(ffmpegSource, 'ffmpeg', process.arch);
  const ffprobe = copyExecutable(ffprobeSource, 'ffprobe', process.arch);
  const indexTtsPython = prepareIndexTtsPython(process.arch);

  const manifest = {
    schema: 't8-macos-media-runtime-v1',
    platform: process.platform,
    arch: process.arch,
    sources: {
      ffmpegStatic: packageVersion('ffmpeg-static'),
      ffprobeInstaller: packageVersion('@ffprobe-installer/ffprobe'),
    },
    binaries: { ffmpeg, ffprobe },
    indexTtsPython,
  };
  fs.writeFileSync(
    path.join(OUT, 'runtime-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(`[prepare-macos-runtime] prepared ${process.arch} ffmpeg/ffprobe in ${OUT}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exit(1);
  }
}

module.exports = { inspectMachO, main };
