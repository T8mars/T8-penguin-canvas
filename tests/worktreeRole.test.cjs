'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LEGACY_F2_HEAD,
  classifyWorktreePath,
  evaluateWorktreeRole,
  inspectCurrentWorktree,
  isDevelopmentBranch,
  isReleaseBranch,
} = require('../scripts/worktree-role.cjs');
const {
  classifyReleaseWorktreeStatus,
} = require('../scripts/release-worktree.cjs');

function root(name) {
  return path.resolve('E:\\PenguinPravite', name);
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

test('worktree path and branch roles are deterministic across core, dev and release layouts', () => {
  assert.equal(classifyWorktreePath(root('T8-penguin-canvas')), 'core');
  assert.equal(classifyWorktreePath(root('T8-penguin-canvas-dev-f6-review')), 'development');
  assert.equal(classifyWorktreePath(root('T8-penguin-canvas-release-v2.6.0')), 'release');
  assert.equal(classifyWorktreePath(root('random-copy')), 'unknown');
  assert.equal(isDevelopmentBranch('codex/f6-review'), true);
  assert.equal(isDevelopmentBranch('codex/release-v2.6.0'), false);
  assert.equal(isReleaseBranch('codex/release-v2.6.0'), true);
  assert.equal(isReleaseBranch('main'), false);
});

test('real worktree inspection is read-only and works without global safe-directory mutation', () => {
  const inspected = inspectCurrentWorktree(PROJECT_ROOT, 'inspect');
  assert.equal(path.resolve(inspected.root), PROJECT_ROOT);
  assert.match(inspected.head, /^[a-f0-9]{40}$/);
});

test('development rejects release paths except the one explicit legacy F2 pair', () => {
  const rejected = evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-2.5.7'),
    branch: 'codex/f2-reconnect-sync',
    mode: 'development',
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join(' '), /forbidden in a release-named worktree/);

  const allowed = evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-2.5.7'),
    branch: 'codex/f2-reconnect-sync',
    head: LEGACY_F2_HEAD,
    mode: 'development',
    allowLegacyF2: true,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.legacyF2, true);
  assert.match(allowed.warnings.join(' '), /temporary legacy F2 exception/);

  const movedHead = evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-2.5.7'),
    branch: 'codex/f2-reconnect-sync',
    head: '33b945d8e753ee79540ee8ef397b3b547dc57fad',
    mode: 'development',
    allowLegacyF2: true,
  });
  assert.equal(movedHead.ok, false);
  assert.match(movedHead.errors.join(' '), /frozen base HEAD/);

  const copiedException = evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-2.5.8'),
    branch: 'codex/f2-reconnect-sync',
    head: LEGACY_F2_HEAD,
    mode: 'development',
    allowLegacyF2: true,
  });
  assert.equal(copiedException.ok, false);
});

test('development accepts the canonical core and optional dedicated development paths', () => {
  const core = evaluateWorktreeRole({
    root: root('T8-penguin-canvas'),
    branch: 'codex/vibex-workbench-node',
    mode: 'development',
  });
  assert.equal(core.ok, true);

  const development = evaluateWorktreeRole({
    root: root('T8-penguin-canvas-dev-next-topic'),
    branch: 'codex/next-topic',
    mode: 'development',
  });
  assert.equal(development.ok, true);
});

test('formal release requires both a release path and a release branch or detached commit', () => {
  assert.equal(evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-v2.6.0'),
    branch: 'codex/release-v2.6.0',
    mode: 'release',
  }).ok, true);
  assert.equal(evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-v2.6.0'),
    branch: '',
    mode: 'release',
  }).ok, true);
  assert.equal(evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-v2.6.0'),
    branch: 'codex/f6-review',
    mode: 'release',
  }).ok, false);
  const mismatched = evaluateWorktreeRole({
    root: root('T8-penguin-canvas-release-v2.6.0'),
    branch: 'codex/release-v2.6.1',
    mode: 'release',
  });
  assert.equal(mismatched.ok, false);
  assert.match(mismatched.errors.join(' '), /path\/branch label mismatch/);
  assert.equal(evaluateWorktreeRole({
    root: root('T8-penguin-canvas'),
    branch: 'codex/release-v2.6.0',
    mode: 'release',
  }).ok, false);
  assert.equal(evaluateWorktreeRole({
    root: root('T8-penguin-canvas'),
    branch: 'codex/release-v3.0.1',
    mode: 'release',
    allowCoreRelease: true,
  }).ok, true);
  assert.equal(evaluateWorktreeRole({
    root: root('T8-penguin-canvas'),
    branch: 'codex/not-a-release',
    mode: 'release',
    allowCoreRelease: true,
  }).ok, false);
});

test('release cleanliness keeps sidecars unstaged and rejects every staged or source change', () => {
  const result = classifyReleaseWorktreeStatus([
    ' M tools/ffmpeg-runtime/ffmpeg.exe',
    ' M tools/remove-ai-watermarks-runtime/README.md',
    'M  tools/ffmpeg-runtime/ffmpeg.exe',
    ' M src/App.tsx',
    '?? unexpected.txt',
  ].join('\n'));
  assert.deepEqual(result.permitted, [
    ' M tools/ffmpeg-runtime/ffmpeg.exe',
    ' M tools/remove-ai-watermarks-runtime/README.md',
  ]);
  assert.deepEqual(result.unexpected, [
    'M  tools/ffmpeg-runtime/ffmpeg.exe',
    ' M src/App.tsx',
    '?? unexpected.txt',
  ]);
});

test('root development commands fail closed through the role gate and use the Electron native ABI for backend development', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const scripts = packageJson.scripts || {};
  for (const lifecycle of ['predev', 'predev:vite', 'predev:backend', 'preelectron:dev']) {
    assert.equal(scripts[lifecycle], 'node scripts/worktree-role.cjs development', lifecycle);
  }
  assert.equal(scripts['worktree:development'], 'node scripts/worktree-role.cjs development');
  assert.equal(scripts['worktree:core'], 'node scripts/worktree-role.cjs core');
  assert.equal(scripts['worktree:release'], 'node scripts/worktree-role.cjs release');
  assert.equal(scripts['worktree:integration-audit'], 'node scripts/audit-worktree-integration.cjs');
  assert.match(scripts['dev:backend'], /ELECTRON_RUN_AS_NODE=1 electron\b/);
  assert.match(scripts['dev:backend'], /backend\/src\/server\.js$/);
  assert.doesNotMatch(scripts.dev, /cd backend|npm start/);
});
