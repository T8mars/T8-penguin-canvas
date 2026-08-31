#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { assertLatestYamlArtifact } = require('./latest-yml.cjs');
const { assertSealedReleaseRecovery } = require('./release-provenance.cjs');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const version = pkg.version;
const cliArgs = process.argv.slice(2);
const prepublish = cliArgs.includes('--prepublish');
const metadataOnly = cliArgs.includes('--metadata-only');
const recoveryManifest = cliArgs.includes('--recovery-manifest');
const tag = cliArgs.find((argument) => !argument.startsWith('--'))
  || process.env.T8_RELEASE_TAG
  || `v${version}`;
const repo = process.env.T8_RELEASE_REPO || process.env.GITHUB_REPOSITORY || 'T8mars/T8-penguin-canvas';
const productName = pkg.build && pkg.build.productName ? pkg.build.productName : 'T8-PenguinCanvas';
const installerName = `${productName}-Setup-${version}.exe`;
const blockmapName = `${installerName}.blockmap`;
const macBaseName = `${productName}-${version}-mac-arm64`;
const allowedMacAssetNames = [`${macBaseName}.dmg`, `${macBaseName}.zip`, 'latest-mac.yml'];
const distDir = path.join(ROOT, 'dist_electron');
const releaseTarget = String(process.env.T8_RELEASE_TARGET || '').toLowerCase();
const releaseRemote = process.env.T8_RELEASE_REMOTE || 'origin';
const expectedTag = `v${version}`;

function fail(message) {
  throw new Error(String(message));
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) fail(`gh failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    fail(`gh ${args.join(' ')} exited with ${result.status}${detail ? `\n${detail}` : ''}`);
  }
  return result;
}

function releaseIsMarkedLatest() {
  const result = runGh([
    'release',
    'list',
    '--repo',
    repo,
    '--limit',
    '100',
    '--json',
    'tagName,isLatest,isDraft,isPrerelease',
  ], { capture: true });
  let releases;
  try {
    releases = JSON.parse(result.stdout);
  } catch (_) {
    fail('cannot parse GitHub release list while verifying Latest status');
  }
  return releases.some((release) => (
    release.tagName === tag
    && release.isLatest === true
    && release.isDraft === false
    && release.isPrerelease === false
  ));
}

function hashFile(filePath, algorithm, encoding = 'hex') {
  const hash = crypto.createHash(algorithm);
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest(encoding);
}

function remoteTagTarget() {
  const result = spawnSync('git', [
    'ls-remote',
    releaseRemote,
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(`cannot resolve remote tag ${tag}`);
  const rows = String(result.stdout || '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row.length >= 2);
  const peeled = rows.find((row) => row[1] === `refs/tags/${tag}^{}`);
  return String((peeled || rows[0] || [])[0] || '').toLowerCase();
}

function withReleaseTemp(action) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't8pc-release-'));
  try {
    return action(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertExactReleaseAssets(assets, expectedNames, allowedAdditionalNames = []) {
  if (!Array.isArray(assets)) fail('release assets metadata is invalid');
  const names = assets.map((asset) => String(asset?.name || ''));
  if (names.some((name) => !name)) fail('release contains an unnamed asset');
  if (new Set(names).size !== names.length) fail('release contains duplicate asset names');
  const expected = new Set(expectedNames);
  if (expected.size !== expectedNames.length || expected.has('')) fail('expected release asset names are invalid');
  const allowedAdditional = new Set(allowedAdditionalNames);
  if (allowedAdditional.size !== allowedAdditionalNames.length || allowedAdditional.has('')) {
    fail('allowed additional release asset names are invalid');
  }
  if (allowedAdditionalNames.some((name) => expected.has(name))) {
    fail('allowed additional release asset names overlap required assets');
  }
  for (const required of expectedNames) {
    if (!names.includes(required)) fail(`missing release asset: ${required}`);
  }
  const allowed = new Set([...expectedNames, ...allowedAdditionalNames]);
  const unexpected = names.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) fail(`unexpected release asset: ${unexpected.join(', ')}`);
  return new Map(assets.map((asset) => [asset.name, asset]));
}

function assertReleaseAssetMetadata(assetByName, expectedByName) {
  for (const [name, expected] of expectedByName) {
    const asset = assetByName.get(name);
    const advertisedSize = Number(asset?.size || 0);
    if (advertisedSize !== expected.size) fail(`release asset size mismatch: ${name}`);
    const advertisedDigest = String(asset?.digest || '').toLowerCase();
    if (advertisedDigest !== `sha256:${expected.sha256}`) {
      fail(`release asset advertised SHA-256 mismatch: ${name}`);
    }
  }
}

function main() {
  if (!/^[a-f0-9]{40}$/.test(releaseTarget)) {
    fail('T8_RELEASE_TARGET must be the exact 40-character source commit SHA');
  }
  if (tag !== expectedTag) {
    fail(`automatic-update tag must be ${expectedTag}, received ${tag}`);
  }
  console.log(
    `[verify-release] repo=${repo} tag=${tag} phase=${prepublish ? 'prepublish' : 'final'} mode=${
      recoveryManifest
        ? (metadataOnly ? 'sealed-recovery-metadata' : 'sealed-recovery-full-download')
        : (metadataOnly ? 'local-metadata' : 'local-full-download')
    }`,
  );
  const result = runGh(['release', 'view', tag, '--repo', repo, '--json', 'tagName,url,assets,isDraft,isPrerelease,isImmutable,publishedAt,targetCommitish'], {
    capture: true,
  });
  const data = JSON.parse(result.stdout);
  if (data.tagName !== tag) fail(`release tag mismatch: expected ${tag}, received ${data.tagName}`);
  if (prepublish) {
    if (!data.isDraft || data.isPrerelease) {
      fail(`${tag} prepublish verification requires a stable draft release`);
    }
  } else if (data.isDraft || data.isPrerelease) {
    fail(`${tag} must be a published non-prerelease automatic-update release`);
  }
  const tagTarget = remoteTagTarget();
  if (tagTarget && tagTarget !== releaseTarget) {
    fail(`remote tag ${tag} targets ${tagTarget}, expected ${releaseTarget}`);
  }
  if (!tagTarget) {
    if (!prepublish) fail(`remote tag ${tag} is missing, expected ${releaseTarget}`);
    if (String(data.targetCommitish || '').toLowerCase() !== releaseTarget) {
      fail(`draft ${tag} targets ${data.targetCommitish || '(missing)'}, expected ${releaseTarget}`);
    }
  }
  const expectedAssetNames = [installerName, blockmapName, 'latest.yml'];
  const assetByName = assertExactReleaseAssets(
    data.assets,
    expectedAssetNames,
    prepublish ? [] : allowedMacAssetNames,
  );
  let expectedByName;
  let sealedRecovery;
  if (recoveryManifest) {
    sealedRecovery = assertSealedReleaseRecovery({
      root: ROOT,
      pkg,
      target: releaseTarget,
      nonce: process.env.T8_RELEASE_BUILD_NONCE,
    });
    expectedByName = new Map(
      Object.values(sealedRecovery.recovery.artifacts).map((artifact) => [
        artifact.name,
        { size: artifact.size, sha256: artifact.sha256 },
      ]),
    );
  } else {
    expectedByName = new Map();
    for (const name of expectedAssetNames) {
      const localPath = path.join(distDir, name);
      if (!fs.existsSync(localPath)) fail(`local release artifact is missing: ${path.relative(ROOT, localPath)}`);
      const localStat = fs.statSync(localPath);
      expectedByName.set(name, {
        size: localStat.size,
        sha256: hashFile(localPath, 'sha256'),
      });
    }
  }
  assertReleaseAssetMetadata(assetByName, expectedByName);

  if (!metadataOnly) {
    withReleaseTemp((tmp) => {
      runGh([
        'release',
        'download',
        tag,
        '--repo',
        repo,
        '--pattern',
        installerName,
        '--pattern',
        blockmapName,
        '--pattern',
        'latest.yml',
        '--dir',
        tmp,
        '--clobber',
      ]);
      for (const name of expectedAssetNames) {
        const remotePath = path.join(tmp, name);
        if (!fs.existsSync(remotePath)) fail(`downloaded release artifact is missing: ${name}`);
        const remoteStat = fs.statSync(remotePath);
        if (recoveryManifest) {
          const expected = expectedByName.get(name);
          if (remoteStat.size !== expected.size) fail(`release asset size mismatch: ${name}`);
          if (hashFile(remotePath, 'sha256') !== expected.sha256) {
            fail(`release asset SHA-256 mismatch: ${name}`);
          }
        } else {
          const localPath = path.join(distDir, name);
          const localStat = fs.statSync(localPath);
          if (localStat.size !== remoteStat.size) fail(`release asset size mismatch: ${name}`);
          if (hashFile(localPath, 'sha256') !== hashFile(remotePath, 'sha256')) {
            fail(`release asset SHA-256 mismatch: ${name}`);
          }
        }
      }

      const latestPath = path.join(tmp, 'latest.yml');
      const latest = fs.readFileSync(latestPath, 'utf-8');
      const downloadedInstallerPath = path.join(tmp, installerName);
      const installerSha512 = hashFile(downloadedInstallerPath, 'sha512', 'base64');
      const installerSize = fs.statSync(downloadedInstallerPath).size;
      if (recoveryManifest
        && installerSha512 !== sealedRecovery.recovery.artifacts.installer.sha512) {
        fail('downloaded installer SHA-512 does not match sealed release recovery');
      }
      try {
        assertLatestYamlArtifact({
          text: latest,
          version,
          installerName,
          installerSha512,
          installerSize,
          label: 'downloaded latest.yml',
        });
      } catch (error) {
        fail(error?.message || String(error));
      }
    });
  }

  const isLatest = prepublish ? false : releaseIsMarkedLatest();
  if (!prepublish && !isLatest) fail(`${tag} is not marked as GitHub Latest`);

  console.log(`[verify-release] assets ok: ${installerName}, ${blockmapName}, latest.yml`);
  console.log(`[verify-release] url: ${data.url}`);
  console.log(`[verify-release] latest: ${prepublish ? 'not-required-before-publish' : (isLatest ? 'yes' : 'no')}`);
  console.log(
    `[verify-release] artifact verification: ${
      recoveryManifest
        ? (
          metadataOnly
            ? 'sealed recovery manifest + GitHub digest/size metadata'
            : 'downloaded bytes + sealed recovery manifest + GitHub digest metadata'
        )
        : (metadataOnly ? 'local bytes + GitHub digest/size metadata' : 'downloaded bytes + GitHub digest metadata')
    }`,
  );
  console.log(`[verify-release] GitHub immutable: ${data.isImmutable === true ? 'yes' : 'no (publisher-level no-overwrite only)'}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[verify-release] ${error?.message || String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertExactReleaseAssets,
  assertReleaseAssetMetadata,
  main,
  withReleaseTemp,
};
