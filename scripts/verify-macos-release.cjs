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
const repo = process.env.T8_RELEASE_REPO || process.env.GITHUB_REPOSITORY || 'T8mars/T8-penguin-canvas';
const tag = process.env.T8_RELEASE_TAG || `v${pkg.version}`;
const base = `${pkg.build.productName}-${pkg.version}-mac-arm64`;
const expectedNames = [`${base}.dmg`, `${base}.zip`, 'latest-mac.yml'];

function fail(message) {
  throw new Error(`[verify-macos-release] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function digestFile(filename, algorithm, encoding = 'hex') {
  const hash = crypto.createHash(algorithm);
  const fd = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest(encoding);
}

function sha256(filename) {
  return digestFile(filename, 'sha256', 'hex');
}

function releaseMetadata() {
  const result = run('gh', [
    'release', 'view', tag, '--repo', repo,
    '--json', 'tagName,isDraft,isPrerelease,targetCommitish,body,assets,url',
  ]);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`cannot parse release metadata: ${error.message}`);
  }
}

function verifyDownloadedAsset(filename, asset) {
  const stat = fs.statSync(filename);
  if (stat.size !== Number(asset.size)) fail(`${asset.name} size differs from GitHub metadata`);
  const actualSha256 = sha256(filename);
  const remoteDigest = String(asset.digest || '').replace(/^sha256:/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(remoteDigest)) fail(`${asset.name} has no valid GitHub sha256 digest`);
  if (actualSha256 !== remoteDigest) fail(`${asset.name} sha256 differs from GitHub metadata`);
  console.log(`[verify-macos-release] downloaded macOS release asset ${asset.name}: ${stat.size} bytes sha256=${actualSha256}`);
  return { name: asset.name, size: stat.size, sha256: actualSha256 };
}

function main() {
  const release = releaseMetadata();
  if (release.tagName !== tag || release.isDraft || release.isPrerelease) {
    fail(`${tag} must be a published non-prerelease release`);
  }
  if (!/^[a-f0-9]{40}$/i.test(String(release.targetCommitish || ''))) {
    fail('existing release target is not a fixed 40-character commit');
  }
  const sourceTarget = String(process.env.T8_RELEASE_TARGET || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sourceTarget)) fail('T8_RELEASE_TARGET must bind the exact macOS source commit');
  if (!String(release.body || '').includes(`macSource=${sourceTarget}`)) {
    fail('release notes do not bind the published macOS assets to the exact source commit');
  }

  const assets = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  for (const name of expectedNames) {
    if (!assets.has(name)) fail(`GitHub Release is missing ${name}`);
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-macos-release-verify-'));
  try {
    const verified = new Map();
    for (const name of expectedNames) {
      run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', temp]);
      const filename = path.join(temp, name);
      if (!fs.existsSync(filename)) fail(`downloaded macOS release asset is missing: ${name}`);
      verified.set(name, verifyDownloadedAsset(filename, assets.get(name)));
    }

    const update = yaml.load(fs.readFileSync(path.join(temp, 'latest-mac.yml'), 'utf8'));
    if (!update || String(update.version || '') !== pkg.version) fail('latest-mac.yml version mismatch');
    const zipName = `${base}.zip`;
    const zipEntry = (Array.isArray(update.files) ? update.files : [])
      .find((entry) => path.basename(String(entry?.url || '')) === zipName);
    if (!zipEntry) fail(`latest-mac.yml does not reference ${zipName}`);
    if (Number(zipEntry.size) !== verified.get(zipName).size) fail('latest-mac.yml ZIP size mismatch');
    const zipSha512 = digestFile(path.join(temp, zipName), 'sha512', 'base64');
    if (String(zipEntry.sha512 || '') !== zipSha512) fail('latest-mac.yml ZIP sha512 mismatch');

    console.log(JSON.stringify({
      schema: 't8-macos-release-verification-v1',
      repo,
      tag,
      releaseTarget: release.targetCommitish,
      macSource: sourceTarget,
      assets: Object.fromEntries(verified),
      url: release.url,
    }, null, 2));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exit(1);
  }
}

module.exports = { digestFile, expectedNames, verifyDownloadedAsset };
