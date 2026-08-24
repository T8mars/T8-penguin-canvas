#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'mac-runtime');

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

  const manifest = {
    schema: 't8-macos-media-runtime-v1',
    platform: process.platform,
    arch: process.arch,
    sources: {
      ffmpegStatic: packageVersion('ffmpeg-static'),
      ffprobeInstaller: packageVersion('@ffprobe-installer/ffprobe'),
    },
    binaries: { ffmpeg, ffprobe },
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
