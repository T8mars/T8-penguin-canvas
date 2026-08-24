#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const PRODUCT = pkg.build.productName;
const DIST = path.join(ROOT, 'dist_electron');
const APP = path.join(DIST, 'mac-arm64', `${PRODUCT}.app`);
const RESOURCES = path.join(APP, 'Contents', 'Resources');
const EXECUTABLE = path.join(APP, 'Contents', 'MacOS', PRODUCT);
const BASE = `${PRODUCT}-${pkg.version}-mac-arm64`;
const DMG = path.join(DIST, `${BASE}.dmg`);
const ZIP = path.join(DIST, `${BASE}.zip`);
const LATEST = path.join(DIST, 'latest-mac.yml');

function fail(message) {
  throw new Error(`[post-build-macos] ${message}`);
}

function assertFile(filename, minimumBytes = 1) {
  if (!fs.existsSync(filename)) fail(`missing ${filename}`);
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size < minimumBytes) fail(`invalid or implausibly small file ${filename}`);
  return stat;
}

function assertDirectory(dirname) {
  if (!fs.existsSync(dirname) || !fs.statSync(dirname).isDirectory()) fail(`missing directory ${dirname}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: options.encoding || 'utf8',
    stdio: 'pipe',
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function findFile(root, basename) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name === basename) return full;
    }
  }
  return null;
}

function assertArm64MachO(filename, label) {
  const fileResult = run('/usr/bin/file', [filename]);
  if (!/Mach-O/i.test(fileResult.stdout) || !/arm64/i.test(fileResult.stdout)) {
    fail(`${label} is not an arm64 Mach-O: ${fileResult.stdout.trim()}`);
  }
}

function sha512Base64(filename) {
  return crypto.createHash('sha512').update(fs.readFileSync(filename)).digest('base64');
}

function checkBundle() {
  assertDirectory(APP);
  // Electron's macOS executable is a small Mach-O launcher; the Frameworks
  // directory carries the runtime. Format/architecture/signature are the
  // meaningful gates, not an arbitrary megabyte threshold.
  assertFile(EXECUTABLE, 16 * 1024);
  assertArm64MachO(EXECUTABLE, 'main executable');
  const version = run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(APP, 'Contents', 'Info.plist')]).stdout.trim();
  if (version !== pkg.version) fail(`Info.plist version ${version} does not match ${pkg.version}`);

  assertFile(path.join(RESOURCES, 'frontend', 'index.html'));
  assertFile(path.join(RESOURCES, 'backend-enc', 'server.t8c'));
  assertFile(path.join(RESOURCES, 'backend-enc', 'local-private', 'extensions', 'backend', 'index.t8c'));
  assertFile(path.join(RESOURCES, 'backend-enc', 'local-private', 'recharge', 'backend', 'routes.t8c'));
  assertFile(path.join(RESOURCES, 'agent', 'skills', 'zhenzhen-canvas', 'SKILL.md'));
  assertFile(path.join(RESOURCES, 'tools', 'zcanvas-cli', 'bin', 'zcanvas.cjs'));

  const unpacked = path.join(RESOURCES, 'app.asar.unpacked');
  assertDirectory(unpacked);
  const sqlite = findFile(unpacked, 'better_sqlite3.node');
  if (!sqlite) fail('better_sqlite3.node is missing from app.asar.unpacked');
  assertArm64MachO(sqlite, 'better_sqlite3.node');
  const sharp = findFile(unpacked, 'sharp-darwin-arm64.node');
  if (!sharp) fail('sharp-darwin-arm64.node is missing from app.asar.unpacked');
  assertArm64MachO(sharp, 'sharp-darwin-arm64.node');
}

function checkMediaRuntime() {
  const ffmpeg = path.join(RESOURCES, 'tools', 'ffmpeg', 'ffmpeg');
  const ffprobe = path.join(RESOURCES, 'tools', 'ffmpeg', 'ffprobe');
  assertFile(ffmpeg, 10 * 1024 * 1024);
  assertFile(ffprobe, 10 * 1024 * 1024);
  assertFile(path.join(RESOURCES, 'tools', 'ffmpeg', 'runtime-manifest.json'));
  assertArm64MachO(ffmpeg, 'packaged ffmpeg');
  assertArm64MachO(ffprobe, 'packaged ffprobe');

  const filters = run(ffmpeg, ['-hide_banner', '-h', 'filter=xfade']);
  if (!/xfade/i.test(`${filters.stdout}${filters.stderr}`)) fail('packaged ffmpeg does not expose xfade');
  const encoders = run(ffmpeg, ['-hide_banner', '-encoders']);
  const encoderText = `${encoders.stdout}${encoders.stderr}`;
  if (!/libx264|h264_videotoolbox/i.test(encoderText) || !/aac/i.test(encoderText)) {
    fail('packaged ffmpeg is missing H.264 or AAC encoding support');
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-macos-media-probe-'));
  try {
    const sample = path.join(temp, 'sample.mp4');
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '0.5', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', sample,
    ]);
    assertFile(sample, 1024);
    const probe = run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sample]);
    const parsed = JSON.parse(probe.stdout);
    if (!Array.isArray(parsed.streams) || !parsed.streams.some((stream) => stream.codec_type === 'video')) {
      fail('packaged ffprobe JSON did not contain a video stream');
    }
    console.log('[post-build-macos] packaged ffprobe JSON probe verified');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function checkSigning() {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', APP]);
  const details = run('/usr/bin/codesign', ['-dv', '--verbose=4', APP]);
  const text = `${details.stdout}${details.stderr}`;
  if (process.env.T8_MAC_REQUIRE_SIGNING === '1') {
    if (!/Authority=Developer ID Application:/i.test(text)) fail('signed release lacks a Developer ID Application authority');
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', APP]);
    run('/usr/bin/xcrun', ['stapler', 'validate', APP]);
  } else if (!/Signature=adhoc/i.test(text)) {
    fail('unsigned technical preview must still carry an ad-hoc integrity signature');
  }
}

function checkArtifacts() {
  assertFile(DMG, 50 * 1024 * 1024);
  assertFile(ZIP, 50 * 1024 * 1024);
  assertFile(LATEST, 100);
  run('/usr/bin/hdiutil', ['verify', DMG]);
  run('/usr/bin/unzip', ['-tq', ZIP]);

  const update = yaml.load(fs.readFileSync(LATEST, 'utf8'));
  if (!update || String(update.version) !== pkg.version) fail('latest-mac.yml version mismatch');
  const files = Array.isArray(update.files) ? update.files : [];
  const zipEntry = files.find((entry) => path.basename(String(entry?.url || '')) === path.basename(ZIP));
  if (!zipEntry) fail('latest-mac.yml does not reference the arm64 ZIP');
  if (Number(zipEntry.size) !== fs.statSync(ZIP).size) fail('latest-mac.yml ZIP size mismatch');
  if (String(zipEntry.sha512 || '') !== sha512Base64(ZIP)) fail('latest-mac.yml ZIP sha512 mismatch');
}

function main() {
  if (process.platform !== 'darwin') fail('this verifier must run on macOS');
  checkBundle();
  checkMediaRuntime();
  checkSigning();
  checkArtifacts();
  console.log(`[post-build-macos] verified ${path.basename(DMG)}, ${path.basename(ZIP)}, latest-mac.yml`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exit(1);
  }
}

module.exports = { checkArtifacts, checkBundle, checkMediaRuntime, checkSigning };
