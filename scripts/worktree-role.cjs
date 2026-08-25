'use strict';

const fs = require('node:fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CORE_WORKTREE_NAME = 't8-penguin-canvas';
const LEGACY_F2_WORKTREE_NAME = 't8-penguin-canvas-release-2.5.7';
const LEGACY_F2_BRANCH = 'codex/f2-reconnect-sync';
const LEGACY_F2_HEAD = '9b6f6a43bc407a3c47a32dd9c0536afa879f256b';

function worktreeBasename(root) {
  return path.basename(path.resolve(String(root || '.'))).toLowerCase();
}

function classifyWorktreePath(root) {
  const name = worktreeBasename(root);
  if (name === CORE_WORKTREE_NAME) return 'core';
  if (/^t8-penguin-canvas-dev-[a-z0-9][a-z0-9._-]*$/i.test(name)) return 'development';
  if (/^t8-penguin-canvas-release(?:-|$)/i.test(name)) return 'release';
  return 'unknown';
}

function isReleaseBranch(branch) {
  return /^codex\/release(?:-|\/)/i.test(String(branch || ''));
}

function isDevelopmentBranch(branch) {
  const value = String(branch || '');
  return /^codex\//i.test(value) && !isReleaseBranch(value);
}

function releaseLabelFromPath(root) {
  const match = /^t8-penguin-canvas-release-(?:v)?(.+)$/i.exec(worktreeBasename(root));
  return match ? String(match[1]).toLowerCase() : '';
}

function releaseLabelFromBranch(branch) {
  const match = /^codex\/release-(?:v)?(.+)$/i.exec(String(branch || ''));
  return match ? String(match[1]).toLowerCase() : '';
}

function evaluateWorktreeRole({
  root,
  branch = '',
  head = '',
  mode = 'inspect',
  allowLegacyF2 = false,
  allowCoreRelease = false,
} = {}) {
  const normalizedMode = String(mode || 'inspect').toLowerCase();
  const pathRole = classifyWorktreePath(root);
  const detached = !String(branch || '');
  const legacyF2 = worktreeBasename(root) === LEGACY_F2_WORKTREE_NAME
    && String(branch || '') === LEGACY_F2_BRANCH;
  const errors = [];
  const warnings = [];

  if (!['inspect', 'core', 'development', 'release'].includes(normalizedMode)) {
    errors.push(`unknown worktree mode: ${normalizedMode}`);
  } else if (normalizedMode === 'core') {
    if (pathRole !== 'core') errors.push('core work must run in the canonical T8-penguin-canvas worktree');
    if (detached || isReleaseBranch(branch)) errors.push('the core worktree must use a non-release branch');
  } else if (normalizedMode === 'development') {
    if (!isDevelopmentBranch(branch)) errors.push('development requires a non-release codex/* branch');
    if (pathRole === 'release') {
      if (legacyF2 && allowLegacyF2) {
        if (String(head || '').toLowerCase() !== LEGACY_F2_HEAD) {
          errors.push('temporary legacy F2 exception is valid only at its frozen base HEAD; extract the work into a development worktree');
        } else {
          warnings.push('temporary legacy F2 exception is active at its frozen base HEAD; finish extraction and do not reuse this layout');
        }
      } else {
        errors.push('feature development is forbidden in a release-named worktree');
      }
    } else if (!['core', 'development'].includes(pathRole)) {
      errors.push('development must use the canonical T8-penguin-canvas path or T8-penguin-canvas-dev-<topic>');
    }
  } else if (normalizedMode === 'release') {
    const coreRelease = allowCoreRelease === true && pathRole === 'core' && isReleaseBranch(branch);
    if (pathRole !== 'release' && !coreRelease) {
      errors.push('formal release requires a release-named worktree or an explicitly authorized canonical-core release branch');
    }
    if (!detached && !isReleaseBranch(branch)) {
      errors.push('formal release requires codex/release-* or a detached fixed commit');
    } else if (!detached && pathRole === 'release') {
      const pathLabel = releaseLabelFromPath(root);
      const branchLabel = releaseLabelFromBranch(branch);
      if (pathLabel && branchLabel && pathLabel !== branchLabel) {
        errors.push(`release path/branch label mismatch: ${pathLabel} != ${branchLabel}`);
      }
    }
  } else {
    if (pathRole === 'release' && legacyF2) {
      warnings.push('legacy F2 development work is checked out in a release-named worktree');
    } else if (pathRole === 'release' && !detached && !isReleaseBranch(branch)) {
      warnings.push('release-named worktree is on a non-release branch');
    } else if (pathRole === 'development' && !isDevelopmentBranch(branch)) {
      warnings.push('development-named worktree is not on a development branch');
    }
  }

  return {
    mode: normalizedMode,
    root: path.resolve(String(root || '.')),
    branch: String(branch || ''),
    detached,
    pathRole,
    legacyF2,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function gitWorktreeCandidate(root) {
  let current = path.resolve(String(root || '.'));
  try {
    if (fs.lstatSync(current).isFile()) current = path.dirname(current);
  } catch {
    return current;
  }
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(String(root || '.'));
    current = parent;
  }
}

function gitSafeDirectoryValue(root) {
  return gitWorktreeCandidate(root).replace(/\\/g, '/');
}

function captureGit(root, args) {
  const result = spawnSync('git', [
    '-c',
    `safe.directory=${gitSafeDirectoryValue(root)}`,
    ...args,
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`cannot inspect git worktree${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function inspectCurrentWorktree(root = process.cwd(), mode = 'inspect', options = {}) {
  const topLevel = captureGit(root, ['rev-parse', '--show-toplevel']);
  const branch = captureGit(topLevel, ['branch', '--show-current']);
  const head = captureGit(topLevel, ['rev-parse', 'HEAD']);
  return {
    ...evaluateWorktreeRole({
      root: topLevel,
      branch,
      head,
      mode,
      allowLegacyF2: options.allowLegacyF2 === true,
      allowCoreRelease: options.allowCoreRelease === true,
    }),
    head,
  };
}

function formatInspection(result) {
  const lines = [
    `[worktree-role] root=${result.root}`,
    `[worktree-role] branch=${result.branch || '(detached)'}`,
    `[worktree-role] head=${result.head || '(unknown)'}`,
    `[worktree-role] pathRole=${result.pathRole} mode=${result.mode}`,
  ];
  result.warnings.forEach((warning) => lines.push(`[worktree-role] warning: ${warning}`));
  result.errors.forEach((error) => lines.push(`[worktree-role] error: ${error}`));
  return lines.join('\n');
}

if (require.main === module) {
  try {
    const mode = process.argv[2] || 'inspect';
    const result = inspectCurrentWorktree(process.cwd(), mode, {
      allowLegacyF2: process.env.T8_ALLOW_LEGACY_F2_WORKTREE === '1',
      allowCoreRelease: process.env.T8_ALLOW_CORE_RELEASE === '1',
    });
    process.stdout.write(`${formatInspection(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`[worktree-role] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CORE_WORKTREE_NAME,
  LEGACY_F2_BRANCH,
  LEGACY_F2_HEAD,
  LEGACY_F2_WORKTREE_NAME,
  classifyWorktreePath,
  evaluateWorktreeRole,
  formatInspection,
  gitSafeDirectoryValue,
  gitWorktreeCandidate,
  inspectCurrentWorktree,
  isDevelopmentBranch,
  isReleaseBranch,
  releaseLabelFromBranch,
  releaseLabelFromPath,
  worktreeBasename,
};
