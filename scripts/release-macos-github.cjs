#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { digestFile, expectedNames } = require('./verify-macos-release.cjs');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const repo = process.env.T8_RELEASE_REPO || process.env.GITHUB_REPOSITORY || 'T8mars/T8-penguin-canvas';
const tag = process.env.T8_RELEASE_TAG || `v${pkg.version}`;
const approval = `mac-release-${pkg.version}`;
const dist = path.join(ROOT, 'dist_electron');

function fail(message) {
  throw new Error(`[release-macos] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function releaseMetadata() {
  const result = run('gh', [
    'release', 'view', tag, '--repo', repo,
    '--json', 'tagName,isDraft,isPrerelease,targetCommitish,body,assets,url',
  ]);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`cannot parse GitHub Release metadata: ${error.message}`);
  }
}

function localArtifacts() {
  const artifacts = new Map();
  for (const name of expectedNames) {
    const filename = path.join(dist, name);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) fail(`missing local macOS artifact ${filename}`);
    artifacts.set(name, {
      name,
      filename,
      size: fs.statSync(filename).size,
      sha256: digestFile(filename, 'sha256', 'hex'),
    });
  }
  return artifacts;
}

function assertSourceAndRelease(release) {
  if (process.env.T8_MAC_RELEASE_APPROVAL !== approval) {
    fail(`refusing to publish without explicit T8_MAC_RELEASE_APPROVAL=${approval}`);
  }
  const sourceTarget = String(process.env.T8_RELEASE_TARGET || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sourceTarget)) fail('T8_RELEASE_TARGET must be the exact macOS source commit');
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
  if (head !== sourceTarget) fail(`macOS source target ${sourceTarget} does not match HEAD ${head}`);
  const sourceRef = String(process.env.T8_MAC_SOURCE_REF || '').trim();
  if (!sourceRef) fail('T8_MAC_SOURCE_REF is required');
  const sourceRefTarget = run('git', ['rev-parse', `${sourceRef}^{commit}`]).stdout.trim().toLowerCase();
  if (sourceRefTarget !== sourceTarget) fail(`macOS source ref ${sourceRef} does not resolve to ${sourceTarget}`);

  if (release.tagName !== tag || release.isDraft || release.isPrerelease) {
    fail(`${tag} must already be a published non-prerelease Release`);
  }
  const existingTarget = String(release.targetCommitish || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(existingTarget)) fail('existing release target is not a fixed source commit');
  if (existingTarget !== sourceTarget && process.env.T8_MAC_APPEND_EXISTING_RELEASE !== '1') {
    fail(`existing release target ${existingTarget} differs from macOS source ${sourceTarget}; set the explicit append boundary`);
  }
  return { sourceTarget, sourceRef, existingTarget };
}

function macReleaseSection(binding, artifacts) {
  const signed = process.env.T8_MAC_REQUIRE_SIGNING === '1';
  const marker = `<!-- t8-macos-release-v1 macSource=${binding.sourceTarget} sourceRef=${binding.sourceRef} signed=${signed} -->`;
  const digestRows = [...artifacts.values()]
    .map((item) => `- \`${item.name}\`: ${item.size.toLocaleString('en-US')} bytes / SHA-256 \`${item.sha256}\``)
    .join('\n');
  return {
    marker,
    text: `${marker}\n\n## macOS Apple Silicon\n\n`
      + `- 支持 Apple Silicon（arm64），最低 macOS 12；下载 DMG 后拖入“应用程序”。\n`
      + (signed
        ? '- 已使用 Apple Developer ID 签名并完成 Apple 公证；自动更新使用同一 Release 的 `latest-mac.yml` 与 ZIP。\n'
        : '- 本次为首次技术预览：仅做 ad-hoc 完整性签名，尚无 Apple Developer ID 与公证。首次打开请在 Finder 中右键应用并选择“打开”，系统仍会明确提示来源。\n')
      + `- Mac 构建源码固定为 \`${binding.sourceRef}\` / \`${binding.sourceTarget}\`；既有 v3.0.0 Windows Tag 和安装包未移动、未覆盖。\n`
      + '- 云端 Provider、画布、数据库、素材与内置 FFmpeg/FFprobe 已打包；Windows 专用的去水印/ParseHub Python 离线运行时未冒充为 Mac 能力，相关本地工具需要用户另行安装兼容 Python 环境。\n\n'
      + `${digestRows}\n`,
  };
}

function updateReleaseNotes(release, binding, artifacts) {
  const section = macReleaseSection(binding, artifacts);
  const body = String(release.body || '');
  const existingMarker = body.match(/<!-- t8-macos-release-v1[^>]*-->/)?.[0] || '';
  if (existingMarker && existingMarker !== section.marker) {
    fail(`Release already contains a different macOS provenance marker: ${existingMarker}`);
  }
  if (existingMarker) return;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-macos-release-notes-'));
  try {
    const notes = path.join(temp, 'notes.md');
    fs.writeFileSync(notes, `${body.trim()}\n\n${section.text.trim()}\n`, 'utf8');
    run('gh', ['release', 'edit', tag, '--repo', repo, '--notes-file', notes]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function uploadMissingAssets(release, artifacts) {
  const remote = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  const missing = [];
  for (const item of artifacts.values()) {
    const existing = remote.get(item.name);
    if (!existing) {
      missing.push(item.filename);
      continue;
    }
    const digest = String(existing.digest || '').replace(/^sha256:/i, '').toLowerCase();
    if (Number(existing.size) !== item.size || digest !== item.sha256) {
      fail(`refusing to overwrite a different existing macOS asset: ${item.name}`);
    }
    console.log(`[release-macos] remote asset already matches: ${item.name}`);
  }
  if (!missing.length) return;
  // Equivalent CLI: gh release upload <tag> <assets...> --repo <repo>. Deliberately no --clobber.
  run('gh', ['release', 'upload', tag, ...missing, '--repo', repo], { inherit: true });
}

function main() {
  const artifacts = localArtifacts();
  const before = releaseMetadata();
  const binding = assertSourceAndRelease(before);
  uploadMissingAssets(before, artifacts);
  const uploaded = releaseMetadata();
  if (String(uploaded.targetCommitish).toLowerCase() !== binding.existingTarget) {
    fail('existing release target changed while appending macOS assets');
  }
  updateReleaseNotes(uploaded, binding, artifacts);
  const after = releaseMetadata();
  if (String(after.targetCommitish).toLowerCase() !== binding.existingTarget) {
    fail('existing release target changed while updating macOS notes');
  }
  run(process.execPath, [path.join(ROOT, 'scripts', 'verify-macos-release.cjs')], { inherit: true });
  console.log(`[release-macos] published and verified ${tag}: ${after.url}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exit(1);
  }
}

module.exports = { assertSourceAndRelease, macReleaseSection, uploadMissingAssets };
