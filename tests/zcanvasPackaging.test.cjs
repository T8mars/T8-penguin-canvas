'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Electron release resources carry the same versioned zcanvas CLI and Skill sources', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const resources = packageJson.build.extraResources;
  const skill = resources.find((item) => item.to === 'agent/skills/zhenzhen-canvas');
  const cli = resources.find((item) => item.to === 'tools/zcanvas-cli');
  assert.equal(skill.from, '.agents/skills/zhenzhen-canvas');
  assert.deepEqual(skill.filter, ['**/*']);
  assert.equal(cli.from, 'tools/zcanvas-cli');
  assert.ok(cli.filter.includes('bin/**/*'));
  assert.ok(cli.filter.includes('src/**/*'));
  assert.ok(cli.filter.includes('commandCatalog.json'));
  assert.ok(cli.filter.includes('creativeCapabilityManifest.json'));
  assert.ok(cli.filter.includes('generated/**/*'));
  assert.ok(cli.filter.includes('manifest.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, cli.from, 'manifest.json'), 'utf8')).creativeCapabilityGraph, 'generated/creative-capability-graph.json');
  assert.equal(packageJson.scripts.prebuild, 'npm run feature-sync:check && npm run i18n:check');
  assert.equal(fs.existsSync(path.join(root, skill.from, 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(root, cli.from, 'bin', 'zcanvas.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, cli.from, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(root, cli.from, 'commandCatalog.json')), true);
  assert.equal(fs.existsSync(path.join(root, cli.from, 'generated', 'creative-capabilities.json')), true);
  assert.equal(fs.existsSync(path.join(root, cli.from, 'generated', 'creative-capability-graph.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'backend', 'src', 'shared', 'creativeCapabilityGraph.json')), true);
});
