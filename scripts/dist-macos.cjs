#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const approval = `mac-release-${pkg.version}`;
const remote = process.env.T8_RELEASE_REMOTE || 'origin';
const OPTIONAL_SIGNING_ENV = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];

function fail(message) {
  console.error(`[dist-macos] ${message}`);
  process.exit(1);
}

function run(label, command, args, options = {}) {
  console.log(`[dist-macos] ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    fail(`${label} failed with status ${result.status ?? 'unknown'}${result.error ? `: ${result.error.message}` : ''}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function sourceRemoteRef(sourceRef) {
  if (/^refs\//.test(sourceRef)) return sourceRef;
  if (/^v\d+\.\d+\.\d+(?:[-.].*)?$/.test(sourceRef)) return `refs/tags/${sourceRef}`;
  return `refs/heads/${sourceRef}`;
}

function remoteRefCommit(output, ref) {
  const entries = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/, 2))
    .filter(([sha, name]) => /^[a-f0-9]{40}$/i.test(sha || '') && Boolean(name));
  const peeled = entries.find(([, name]) => name === `${ref}^{}`);
  const direct = entries.find(([, name]) => name === ref);
  return String((peeled || direct || [])[0] || '').toLowerCase();
}

function assertSource() {
  if (process.platform !== 'darwin') fail('macOS packages must be built on a real Mac');
  if (process.arch !== 'arm64') fail(`Apple Silicon release requires arm64, got ${process.arch}`);
  if (process.env.T8_MAC_RELEASE_APPROVAL !== approval) {
    fail(`refusing to build without explicit T8_MAC_RELEASE_APPROVAL=${approval}`);
  }
  const target = String(process.env.T8_RELEASE_TARGET || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(target)) fail('T8_RELEASE_TARGET must be an exact 40-character source commit');
  const head = capture('git', ['rev-parse', 'HEAD']).toLowerCase();
  if (head !== target) fail(`T8_RELEASE_TARGET ${target} does not match HEAD ${head}`);

  const sourceRef = String(process.env.T8_MAC_SOURCE_REF || '').trim();
  if (!sourceRef) fail('T8_MAC_SOURCE_REF is required for reproducible remote source binding');
  const ref = sourceRemoteRef(sourceRef);
  const remoteTarget = remoteRefCommit(capture('git', ['ls-remote', remote, ref, `${ref}^{}`]), ref);
  if (remoteTarget !== target) fail(`${remote}/${ref} points to ${remoteTarget || '(missing)'}, expected ${target}`);

  const tracked = capture('git', ['status', '--porcelain=v1', '--untracked-files=no']);
  if (tracked) fail(`tracked source is not clean:\n${tracked}`);
  return target;
}

function removePreviousArtifacts() {
  const dist = path.join(ROOT, 'dist_electron');
  const expectedPrefix = `${pkg.build.productName || pkg.name}-${pkg.version}-mac-arm64`;
  const targets = [
    path.join(dist, 'mac-arm64'),
    path.join(dist, `${expectedPrefix}.dmg`),
    path.join(dist, `${expectedPrefix}.zip`),
    path.join(dist, 'latest-mac.yml'),
  ];
  for (const target of targets) {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(`${path.resolve(dist)}${path.sep}`)) fail(`unsafe cleanup target ${resolved}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function main() {
  const target = assertSource();
  removePreviousArtifacts();
  const requireSigning = process.env.T8_MAC_REQUIRE_SIGNING === '1';
  const env = {
    ...process.env,
    T8_RELEASE_TARGET: target,
    T8_REQUIRE_LOCAL_PRIVATE: '1',
    T8_ENABLE_LOCAL_PRIVATE: '1',
    T8_DISABLE_LOCAL_EXTENSIONS: '0',
    T8_REQUIRE_AI_WATERMARK_RUNTIME: '0',
    T8_REQUIRE_PARSEHUB_RUNTIME: '0',
    T8_REQUIRE_RUNTIME_ARCHIVES: '0',
    T8_REQUIRE_UPDATE_ARTIFACTS: '1',
  };
  for (const key of OPTIONAL_SIGNING_ENV) {
    if (!String(env[key] || '').trim()) delete env[key];
  }

  run('frontend and encrypted backend', 'npm', ['run', 'prepack:enc'], { env });
  run('native macOS FFmpeg and FFprobe runtime', 'npm', ['run', 'prepack:mac-runtime'], { env });
  run('Electron native module rebuild', 'npm', ['run', 'rebuild:electron:mac'], { env });

  const builderArgs = ['--mac', '--arm64', '--config.npmRebuild=false', '--publish', 'never'];
  if (!requireSigning) builderArgs.push('--config.mac.identity=-');
  run(
    requireSigning ? 'signed/notarized macOS DMG and ZIP' : 'ad-hoc signed macOS technical preview DMG and ZIP',
    path.join(ROOT, 'node_modules', '.bin', 'electron-builder'),
    builderArgs,
    { env },
  );
  run('macOS post-build checks', process.execPath, [path.join(ROOT, 'electron', '_post_build_macos.cjs')], { env });
  console.log(`[dist-macos] complete for ${target}`);
}

if (require.main === module) main();

module.exports = { remoteRefCommit, sourceRemoteRef };
