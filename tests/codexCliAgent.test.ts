import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

function readOptional(rel: string) {
  try {
    return read(rel);
  } catch {
    return '';
  }
}

test('Codex CLI Agent is registered as a creator-facing canvas node', () => {
  const types = read('../src/types/canvas.ts');
  const registry = read('../src/config/nodeRegistry.ts');
  const ports = read('../src/config/portTypes.ts');
  const canvas = read('../src/components/Canvas.tsx');
  const sidebar = read('../src/components/Sidebar.tsx');
  const features = read('../features.json');
  const roadmap = read('../roadmap.md');

  assert.match(types, /'codex-cli-agent'/);
  assert.match(types, /'codex'/);
  assert.match(registry, /type:\s*'codex-cli-agent'[\s\S]*label:\s*'Codex CLI Agent'[\s\S]*category:\s*'codex'/);
  assert.match(registry, /codex:\s*\{\s*label:\s*'CODEX CLI'/);
  assert.match(ports, /'codex-cli-agent':\s*\{\s*inputs:\s*\['text', 'image', 'video', 'audio'\],\s*outputs:\s*\['text', 'image', 'video', 'audio', 'model3d'\]/);
  assert.match(canvas, /CodexCliAgentNode/);
  assert.match(canvas, /import\('\.\/nodes\/CodexCliAgentNode'\)/);
  assert.match(canvas, /'codex-cli-agent': CodexCliAgentNode/);
  assert.match(sidebar, /'codex-cli-agent': 'TerminalSquare'/);
  assert.match(features, /codexCliCreatorAgent/);
  assert.match(roadmap, /Codex CLI 创作者 Agent 节点/);
});

test('Codex CLI Agent studio derives readable text colors for themed controls', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');
  const palette = readOptional('../src/utils/readableStudioPalette.ts');

  assert.match(palette, /createReadableStudioPalette/);
  assert.match(palette, /readableTextOn/);
  assert.match(node, /createReadableStudioPalette/);
  assert.match(node, /readableTextOn/);
  assert.match(node, /studioAccentText/);
  assert.match(node, /studioHeaderText/);
  assert.match(node, /const activeControlText = readableTextOn\(accent, isDark\)/);
  assert.match(node, /segmentedControlButtonStyle/);
  assert.match(node, /\.\.\.segmentedControlButtonStyle\(active\)/);
  assert.match(node, /style=\{segmentedControlButtonStyle\(artifactLibraryTab === 'image'\)\}/);
  assert.match(node, /style=\{segmentedControlButtonStyle\(artifactLibraryTab === 'text'\)\}/);
  assert.doesNotMatch(node, /artifactLibraryTab === 'image' \? activeControlText : inactiveControlText/);
  assert.doesNotMatch(node, /artifactLibraryTab === 'text' \? activeControlText : inactiveControlText/);
  assert.doesNotMatch(node, /color:\s*active \? activeControlText : inactiveControlText/);
  assert.doesNotMatch(palette, /accentText:\s*PIXEL_INVERSE_TEXT/);
  assert.doesNotMatch(palette, /headerText:\s*PIXEL_TEXT/);
  assert.doesNotMatch(node, /color:\s*isDark \? '#04111f' : '#fff'/);
});

test('Codex CLI backend exposes status, skill, workspace, and streaming routes', () => {
  const server = read('../backend/src/server.js');
  const route = read('../backend/src/routes/codexCli.js');
  const service = read('../src/services/codexCli.ts');

  assert.match(server, /const codexCliRouter = require\('\.\/routes\/codexCli'\)/);
  assert.match(server, /app\.use\('\/api\/codex-cli', codexCliRouter\)/);
  assert.match(route, /router\.get\('\/status'/);
  assert.match(route, /router\.post\('\/login\/start'/);
  assert.match(route, /router\.get\('\/skills'/);
  assert.match(route, /router\.post\('\/skills\/project'/);
  assert.match(route, /router\.put\('\/skills\/project\/:name'/);
  assert.match(route, /router\.delete\('\/skills\/project\/:name'/);
  assert.match(route, /router\.post\('\/agent\/stream'/);
  assert.match(route, /text\/event-stream/);
  assert.match(route, /turn\.started/);
  assert.match(route, /message\.delta/);
  assert.match(route, /artifact\.completed/);
  assert.match(route, /tool\.progress/);
  assert.match(route, /turn\.failed/);
  assert.match(route, /event:\s*'done'|sendSse\(res,\s*'done'/);
  assert.match(route, /req\.on\('close'/);
  assert.match(route, /signal:/);
  assert.match(service, /streamCodexCliAgent/);
  assert.match(service, /startCodexCliLogin/);
  assert.match(service, /command\?: string/);
  assert.match(service, /scriptPath\?: string/);
  assert.match(service, /getCodexCliSkills/);
  assert.match(service, /createCodexProjectSkill/);
  assert.match(service, /updateCodexProjectSkill/);
  assert.match(service, /deleteCodexProjectSkill/);
  assert.match(service, /extractCodexStreamDeltaForTests/);
  assert.match(service, /codexRouteMissingMessageForTests/);
  assert.match(service, /Codex CLI 后端路由未加载/);
});

test('Codex project skill manager updates categories, renames, and deletes skills', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const root = mkdtempSync(path.join(tmpdir(), 't8-codex-skill-crud-'));
  const workspace = path.join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const emptyRoot = path.join(root, 'empty-skills');
  mkdirSync(emptyRoot, { recursive: true });

  const created = runner.createProjectSkill({
    workspaceDir: workspace,
    name: 'portrait-style',
    title: '人像风格',
    description: '商业人像风格规范',
    category: '人像',
    body: '## 调用时机\n\n用于人像图像生成。',
  });
  assert.equal(created.category, '人像');

  const listed = runner.listCodexSkills({ roots: [emptyRoot], workspaceDir: workspace });
  const listedSkill = listed.find((item: any) => item.name === 'portrait-style');
  assert.equal(listedSkill.category, '人像');
  assert.match(listedSkill.body, /用于人像图像生成/);

  const updated = runner.updateProjectSkill({
    workspaceDir: workspace,
    oldName: 'portrait-style',
    name: 'portrait-commercial',
    title: '商业人像',
    description: '商业棚拍人像规范',
    category: '商业',
    body: '## 输出格式\n\n给出主提示词、负面词和构图。',
  });
  assert.equal(updated.name, 'portrait-commercial');
  assert.equal(updated.category, '商业');
  assert.equal(existsSync(path.join(workspace, '.agents', 'skills', 'portrait-style')), false);
  assert.equal(existsSync(path.join(workspace, '.agents', 'skills', 'portrait-commercial', 'SKILL.md')), true);

  const renamedList = runner.listCodexSkills({ roots: [emptyRoot], workspaceDir: workspace });
  assert.equal(renamedList.some((item: any) => item.name === 'portrait-style'), false);
  assert.match(renamedList.find((item: any) => item.name === 'portrait-commercial').body, /负面词/);

  const deleted = runner.deleteProjectSkill({ workspaceDir: workspace, name: 'portrait-commercial' });
  assert.equal(deleted.deleted, true);
  assert.equal(existsSync(path.join(workspace, '.agents', 'skills', 'portrait-commercial')), false);
});

test('Codex CLI runner builds safe exec args, parses JSONL, and extracts artifacts', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');

  const args = runner.buildCodexExecArgs({
    prompt: '生成一组赛博朋克角色提示词',
    model: 'gpt-5.2',
    profile: 'creator',
    sandbox: 'workspace-write',
    approvalPolicy: 'never',
    reasoningEffort: 'high',
    webSearch: true,
    includePlanTool: true,
    availableFeatures: ['web_search'],
    images: ['input/ref.png'],
    extraArgs: ['--skip-git-repo-check'],
  });

  assert.deepEqual(args.slice(0, 2), ['exec', '--json']);
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('gpt-5.2'));
  assert.ok(args.includes('--profile'));
  assert.ok(args.includes('creator'));
  assert.ok(args.includes('--sandbox'));
  assert.ok(args.includes('workspace-write'));
  assert.ok(args.includes('-c'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.ok(args.includes('--enable'));
  assert.ok(args.includes('web_search'));
  assert.doesNotMatch(args.join(' '), /plan_tool/);
  assert.doesNotMatch(args.join(' '), /--search|--plan|--ask-for-approval/);
  assert.ok(args.includes('-i'));
  assert.ok(args.includes('input/ref.png'));
  assert.equal(args.at(-1), '-');
  assert.doesNotMatch(args.join(' '), /赛博朋克角色提示词/);

  const unsupportedFeatureArgs = runner.buildCodexExecArgs({
    prompt: 'hello',
    webSearch: true,
    includePlanTool: true,
    availableFeatures: ['image_generation'],
  });
  assert.doesNotMatch(unsupportedFeatureArgs.join(' '), /web_search|plan_tool/);

  const imageFeatureArgs = runner.buildCodexExecArgs({
    prompt: '生成图片',
    imageGeneration: true,
    availableFeatures: ['image_generation'],
  });
  assert.match(imageFeatureArgs.join(' '), /image_generation/);

  const disabledFeatureArgs = runner.buildCodexExecArgs({
    prompt: 'hello',
    webSearch: true,
    includePlanTool: true,
    availableFeatures: [
      { name: 'web_search', enabled: true },
      { name: 'plan_tool', enabled: false },
      { name: 'image_generation', enabled: false },
    ],
    extraArgs: ['--enable', 'plan_tool', '--enable=image_generation', '--enable', 'web_search'],
  });
  assert.match(disabledFeatureArgs.join(' '), /web_search/);
  assert.doesNotMatch(disabledFeatureArgs.join(' '), /plan_tool|image_generation/);
  assert.deepEqual(
    runner.stripUnsupportedCodexEnableArgsForTests(['exec', '--enable', 'plan_tool', '--enable=web_search', '--json'], new Set(['web_search'])),
    ['exec', '--enable=web_search', '--json'],
  );
  assert.equal(runner.isUnknownFeatureFlagErrorForTests('Error: Unknown feature flag: plan_tool'), true);

  const parsed = runner.parseCodexJsonLine('{"type":"item.completed","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}');
  assert.equal(parsed.type, 'item.completed');
  assert.equal(runner.extractTextDelta(parsed), 'hello');
  assert.equal(
    runner.extractTextDelta(runner.parseCodexJsonLine('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"通过"}}')),
    '通过',
  );
  assert.equal(
    runner.extractTextDelta(runner.parseCodexJsonLine('{"type":"item.completed","item":{"type":"reasoning","content":[{"type":"reasoning_text","text":"内部思考"}]}}')),
    '',
  );
  assert.equal(runner.shouldForwardCodexStderrForTests('2026-06-11T18:07:39Z  WARN codex_core_plugins::loader: noisy'), false);
  assert.equal(runner.shouldForwardCodexStderrForTests('error: unexpected argument'), true);

  const artifacts = runner.extractArtifactsFromText('完成：![hero](/files/output/hero.png) 和 /files/output/storyboard.mp4');
  assert.deepEqual(artifacts.map((item: any) => item.kind), ['image', 'video']);
  const relativeWindowsArtifacts = runner.extractArtifactsFromText('保存到了 agent-123\\outputs\\beauty-portrait.png');
  assert.equal(relativeWindowsArtifacts[0].kind, 'image');
  assert.match(relativeWindowsArtifacts[0].url, /agent-123\\outputs\\beauty-portrait\.png/);
  const finalCoverArtifacts = runner.extractArtifactsFromText('产物：\n- [最终封面](<E:/tmp/output/imagen/bernini_bilibili_cover_9x16_final.png>)');
  assert.equal(finalCoverArtifacts[0].kind, 'image');
  assert.equal(finalCoverArtifacts[0].url, 'E:/tmp/output/imagen/bernini_bilibili_cover_9x16_final.png');
  assert.equal(finalCoverArtifacts[0].title, 'bernini_bilibili_cover_9x16_final.png');
  const windowsMarkdownArtifacts = runner.extractArtifactsFromText(
    '产物路径：\n![B站封面](E:\\PenguinPravite\\T8-penguin-canvas\\data\\codex-workspaces\\node\\session\\output\\imagegen\\bilibili-bernini-cover-9x16.png)',
  );
  assert.equal(windowsMarkdownArtifacts[0].kind, 'image');
  assert.match(windowsMarkdownArtifacts[0].url, /bilibili-bernini-cover-9x16\.png$/);

  const imagePrompt = runner.makeCreatorPrompt({ preset: '图像生成', prompt: '生成一张霓虹企鹅海报' });
  assert.match(imagePrompt, /image_generation/);
  assert.match(imagePrompt, /Markdown 图片链接|本地文件路径/);

  const featureList = runner.parseCodexFeatureListForTests('image_generation stable true\nstandalone_web_search under development false\n');
  assert.deepEqual(featureList.map((item: any) => item.name), ['image_generation', 'standalone_web_search']);

  const workspace = mkdtempSync(path.join(tmpdir(), 't8-codex-artifact-'));
  mkdirSync(path.join(workspace, 'output'), { recursive: true });
  writeFileSync(path.join(workspace, 'output', 'neon.png'), 'png');
  const normalized = runner.normalizeArtifactUrlForTests('output/neon.png', workspace);
  assert.match(normalized, /^\/files\/output\/codex\/codex_.*\.png$/);
  assert.equal(runner.normalizeArtifactUrlForTests('/app/userdata/.codex/generated_images/run/_image_id_.png', workspace), '');

  const scanRoot = mkdtempSync(path.join(tmpdir(), 't8-codex-artifact-scan-'));
  const scanOutput = path.join(scanRoot, 'output', 'imagen');
  mkdirSync(scanOutput, { recursive: true });
  const oldFile = path.join(scanOutput, 'old-from-previous-run.png');
  writeFileSync(oldFile, 'old');
  const oldTime = new Date(Date.now() - 60_000);
  utimesSync(oldFile, oldTime, oldTime);
  const scanStartedAt = Date.now();
  const newFile = path.join(scanOutput, 'bernini_bilibili_cover_9x16_final.png');
  writeFileSync(newFile, 'new');
  const scannedArtifacts = runner.extractArtifactsFromWorkspaceForTests(
    { dir: scanRoot, outputDir: path.join(scanRoot, 'output') },
    new Map(),
    { createdAfterMs: scanStartedAt },
  );
  assert.equal(scannedArtifacts.some((item: any) => item.title === 'old-from-previous-run.png'), false);
  assert.equal(scannedArtifacts.some((item: any) => item.title === 'bernini_bilibili_cover_9x16_final.png'), true);

  const codexGeneratedRoot = mkdtempSync(path.join(tmpdir(), 't8-codex-generated-'));
  const codexGeneratedRun = path.join(codexGeneratedRoot, '019f1e24-run');
  mkdirSync(codexGeneratedRun, { recursive: true });
  const generatedImage = path.join(codexGeneratedRun, 'ig_real_image.png');
  writeFileSync(generatedImage, 'png');
  const generatedArtifacts = runner.extractArtifactsFromWorkspaceForTests(
    { dir: scanRoot, outputDir: path.join(scanRoot, 'empty-output') },
    new Map(),
    { createdAfterMs: scanStartedAt, extraDirs: [codexGeneratedRoot] },
  );
  assert.equal(generatedArtifacts.some((item: any) => item.title === 'ig_real_image.png'), true);
  assert.match(generatedArtifacts.find((item: any) => item.title === 'ig_real_image.png')?.url || '', /^\/files\/output\/codex\/codex_.*\.png$/);
});

test('Codex CLI runner resolves canvas image URLs to readable local files', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const config = require('../backend/src/config.js');
  mkdirSync(config.INPUT_DIR, { recursive: true });
  const fileName = `codex-ref-${Date.now()}.png`;
  const filePath = path.join(config.INPUT_DIR, fileName);
  writeFileSync(filePath, 'png');

  const workspace = mkdtempSync(path.join(tmpdir(), 't8-codex-image-input-'));
  const resolved = runner.resolveCodexInputImagesForTests([
    `/files/input/${fileName}`,
    filePath,
    'https://example.com/remote.png',
  ], { dir: workspace, inputDir: path.join(workspace, 'inputs') });

  assert.equal(resolved[0], filePath);
  assert.equal(resolved[1], 'https://example.com/remote.png');
  assert.equal(resolved.length, 2);
  const args = runner.buildCodexExecArgs({ prompt: '参考图改稿', images: resolved });
  assert.ok(args.includes(filePath));
  assert.ok(args.includes('https://example.com/remote.png'));
});

test('Codex CLI runner prefers runnable Windows npm shims and can build login invocations', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const root = mkdtempSync(path.join(tmpdir(), 't8-codex-bin-'));
  const npmDir = path.join(root, 'npm');
  const windowsApps = path.join(root, 'WindowsApps');
  mkdirSync(npmDir, { recursive: true });
  mkdirSync(windowsApps, { recursive: true });
  writeFileSync(path.join(npmDir, 'codex'), '#!/bin/sh\n');
  writeFileSync(path.join(npmDir, 'codex.cmd'), '@echo codex\n');
  writeFileSync(path.join(windowsApps, 'codex.exe'), '');

  const resolved = runner.resolveCodexExecutable({
    executablePath: 'codex',
    env: {
      PATH: `${npmDir}${path.delimiter}${windowsApps}`,
      APPDATA: root,
      USERPROFILE: root,
    },
  });
  assert.equal(resolved.command, path.join(npmDir, 'codex.cmd'));
  assert.equal(resolved.shell, true);
  assert.equal(resolved.fromWindowsApps, false);

  const login = runner.buildCodexLoginStartInvocation({ executablePath: 'codex', env: { PATH: npmDir } });
  assert.equal(login.args[0], 'login');
  assert.equal(login.shell, true);
  assert.match(login.commandText, /codex\.cmd"? login/);

  const deviceLogin = runner.buildCodexLoginStartInvocation({ executablePath: 'codex', env: { PATH: npmDir }, deviceAuth: true });
  assert.deepEqual(deviceLogin.args, ['login', '--device-auth']);
  assert.match(deviceLogin.commandText, /--device-auth/);

  const runnerSource = read('../backend/src/utils/codexCliRunner.js');
  assert.match(runnerSource, /writeCodexLoginCmdScript/);
  assert.match(runnerSource, /startCodexLoginInVisibleTerminal/);
  assert.match(runnerSource, /windowsHide:\s*false/);
  assert.match(runnerSource, /登录完成后回到 T8 画布/);
});

test('Codex CLI status probe reports unavailable CLI without throwing HTTP-breaking errors', async () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const missingExecutable = path.join(tmpdir(), `missing-codex-${Date.now()}.exe`);

  const status = await runner.probeCodexStatus({ executablePath: missingExecutable });

  assert.equal(status.available, false);
  assert.equal(status.executable, missingExecutable);
  assert.match(status.message, /Codex CLI 不可用/);
});

test('Codex CLI status probe explains WindowsApps shim failures without 500s', async () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const root = mkdtempSync(path.join(tmpdir(), 't8-codex-windowsapps-'));
  const windowsApps = path.join(root, 'WindowsApps');
  mkdirSync(windowsApps, { recursive: true });
  const windowsAppsCodex = path.join(windowsApps, 'codex.exe');
  writeFileSync(windowsAppsCodex, '');

  const status = await runner.probeCodexStatus({
    executablePath: windowsAppsCodex,
    env: { PATH: windowsApps },
    timeoutMs: 1000,
  });

  assert.equal(status.available, false);
  assert.equal(status.executable, windowsAppsCodex);
  assert.match(status.message, /Codex CLI 不可用/);
  assert.match(status.message, /WindowsApps Codex 入口/);
  assert.match(status.message, /codex\.cmd/);
});

test('Codex CLI status probe honors custom PATH env while checking login and features', async () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const root = mkdtempSync(path.join(tmpdir(), 't8-codex-env-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const isWin = process.platform === 'win32';
  const fakeCodex = path.join(bin, isWin ? 'codex.cmd' : 'codex');
  writeFileSync(fakeCodex, isWin
    ? '@echo off\r\nif "%1"=="--version" (echo codex-cli 9.9.9& exit /b 0)\r\nif "%1"=="login" if "%2"=="status" (echo Logged in using Test& exit /b 0)\r\nif "%1"=="features" if "%2"=="list" (echo image_generation stable true& exit /b 0)\r\necho unexpected %* 1>&2\r\nexit /b 2\r\n'
    : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using Test"; exit 0; fi\nif [ "$1" = "features" ] && [ "$2" = "list" ]; then echo "image_generation stable true"; exit 0; fi\necho "unexpected $*" >&2\nexit 2\n');
  if (!isWin) chmodSync(fakeCodex, 0o755);

  const status = await runner.probeCodexStatus({
    executablePath: 'codex',
    env: {
      PATH: bin,
      Path: bin,
      APPDATA: root,
      USERPROFILE: root,
    },
    timeoutMs: 5000,
  });

  assert.equal(status.available, true);
  assert.equal(status.version, 'codex-cli 9.9.9');
  assert.equal(status.authStatus, 'Logged in using Test');
  assert.deepEqual(status.featureNames, ['image_generation']);
});

test('Codex skill scanner discovers global and project skills with creator metadata', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const root = mkdtempSync(path.join(tmpdir(), 't8-codex-skills-'));
  const globalDir = path.join(root, 'global');
  const projectDir = path.join(root, 'workspace', '.agents', 'skills', 'poster-director');
  mkdirSync(path.join(globalDir, 'imagegen'), { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(globalDir, 'imagegen', 'SKILL.md'), '---\nname: imagegen\ndescription: Generate bitmap images.\n---\n# Imagegen\n');
  writeFileSync(path.join(projectDir, 'SKILL.md'), '# 海报导演\n\n用于把商品图变成海报主视觉。');

  const skills = runner.listCodexSkills({
    roots: [globalDir],
    workspaceDir: path.join(root, 'workspace'),
  });

  assert.deepEqual(skills.map((item: any) => item.name).sort(), ['imagegen', 'poster-director']);
  assert.equal(skills.find((item: any) => item.name === 'poster-director').scope, 'project');
  assert.match(skills.find((item: any) => item.name === 'imagegen').description, /Generate bitmap images/);
});

test('Codex skill scanner imports system and plugin-cache skills used by Codex', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const root = mkdtempSync(path.join(tmpdir(), 't8-codex-plugin-skills-'));
  const codexHome = path.join(root, '.codex');
  const systemSkill = path.join(codexHome, 'skills', '.system', 'openai-docs');
  const pluginSkill = path.join(codexHome, 'plugins', 'cache', 'openai-curated', 'creative', 'c6ea566d', 'skills', 'shot-explorer');
  const tmpPluginSkill = path.join(codexHome, '.tmp', 'plugins', 'plugins', 'superpowers', 'skills', 'using-superpowers');
  mkdirSync(systemSkill, { recursive: true });
  mkdirSync(pluginSkill, { recursive: true });
  mkdirSync(tmpPluginSkill, { recursive: true });
  writeFileSync(path.join(systemSkill, 'SKILL.md'), '---\nname: openai-docs\ndescription: Use official OpenAI docs.\n---\n# OpenAI Docs\n');
  writeFileSync(path.join(pluginSkill, 'SKILL.md'), '---\nname: shot-explorer\ndescription: Explore camera angle variants.\n---\n# Shot Explorer\n');
  writeFileSync(path.join(tmpPluginSkill, 'SKILL.md'), '---\nname: using-superpowers\ndescription: Load the Superpowers routing skill.\n---\n# Using Superpowers\n');

  const skills = runner.listCodexSkills({
    workspaceDir: path.join(root, 'workspace'),
    env: {
      CODEX_HOME: codexHome,
      USERPROFILE: root,
      HOME: root,
      PATH: '',
    },
  });

  assert.ok(skills.find((item: any) => item.name === 'openai-docs'), 'system skill should be visible');
  assert.ok(skills.find((item: any) => item.name === 'shot-explorer'), 'plugin-cache skill should be visible');
  assert.ok(skills.find((item: any) => item.name === 'using-superpowers'), 'tmp plugin skill should be visible');
  assert.match(skills.find((item: any) => item.name === 'shot-explorer').description, /camera angle/);
});

test('Codex creator node exposes simplified mode, studio mode, external skills, and user presets', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /Codex 创作台/);
  assert.match(node, /Codex 简约生成/);
  assert.match(node, /SYSTEM_CREATOR_PRESETS:\s*CreatorPreset\[\]\s*=\s*\[\]/);
  assert.match(node, /DEFAULT_CREATOR_PRESET/);
  assert.match(node, /CODEX_MODEL_OPTIONS/);
  assert.match(node, /codexModelMode/);
  assert.match(node, /gpt-5\.5/);
  assert.match(node, /gpt-5\.4-mini/);
  assert.match(node, /gpt-5\.3-codex-spark/);
  assert.match(node, /gpt-5\.3-codex/);
  assert.match(node, /创作模板/);
  assert.match(node, /模板工坊/);
  assert.match(node, /Skill 列表/);
  assert.match(node, /会话列表/);
  assert.match(node, /新建会话/);
  assert.match(node, /项目管理/);
  assert.match(node, /codexStudioSessions/);
  assert.match(node, /newCodexStudioSession/);
  assert.match(node, /switchCodexStudioSession/);
  assert.match(node, /CREATOR_SKILL_ALLOWLIST/);
  assert.match(node, /skillPurposeLabel/);
  assert.match(node, /renderPresetSelect/);
  assert.match(node, /renderSkillDropdown/);
  assert.match(node, /renderCompactCreatorControls/);
  assert.match(node, /skillSearchQuery/);
  assert.match(node, /scoreSkillMatch/);
  assert.match(node, /filteredCreatorSkills/);
  assert.match(node, /data-codex-skill-search/);
  assert.match(node, /data-codex-skill-option/);
  assert.match(node, /data-codex-skill-picker-portal/);
  assert.match(node, /openSkillPickerFromPrompt/);
  assert.match(node, /data-codex-prompt-frame-source="simple"/);
  assert.match(node, /data-codex-prompt-frame-source="studio"/);
  assert.match(node, /skillPickerOpen/);
  assert.doesNotMatch(node, /filteredCreatorSkills\.slice\(0,\s*16\)/);
  assert.doesNotMatch(node, /max-h-44 overflow-y-auto/);
  assert.doesNotMatch(node, /creatorPresets:\s*CreatorPreset\[\]\s*=\s*\[/);
  assert.match(node, /LLM_DEFAULT_CODEX_MODEL = 'gpt-5\.4-mini'/);
  assert.match(node, /IMG_DEFAULT_CODEX_MODEL = 'gpt-5\.5'/);
  assert.match(node, /autoCodexModelForRunIntent/);
  assert.match(node, /codexModelManual/);
  assert.match(node, /codexModelAutoPatchForRunIntent\(nextIntent\)/);
  assert.match(node, /extractSlashSkillReferences/);
  assert.match(node, /selectedSkillNamesForRun/);
  assert.match(node, /shouldForceImageGeneration/);
  assert.match(node, /codexRunIntent/);
  assert.match(node, /data-codex-run-intent/);
  assert.match(node, /data-codex-run-intent-option=\{item\.id\}/);
  assert.match(node, /data-codex-run-intent-active=\{active \? 'true' : 'false'\}/);
  assert.match(node, /aria-pressed=\{active\}/);
  assert.match(node, /data-codex-run-intent-summary=\{codexRunIntent\}/);
  assert.match(node, /当前：\{codexRunIntent === 'img'/);
  assert.match(node, /IMG 生图模式 · 默认 gpt-5\.5 \+ imagegen/);
  assert.match(node, /LLM 文字模式 · 默认 gpt-5\.4 mini/);
  assert.match(node, /label:\s*'LLM'/);
  assert.match(node, /label:\s*'IMG'/);
  assert.match(node, /llmOnly:\s*runIntent === 'llm'/);
  assert.match(node, /\/Skill/);
  assert.match(node, /工作台工具/);
  assert.match(node, /studioToolPanel/);
  assert.match(node, /codex-simple-prompt-frame/);
  assert.match(node, /absolute inset-4/);
  assert.match(node, /min-h-0 flex-1/);
  assert.match(node, /minHeight:\s*180/);
  assert.match(node, /minHeight:\s*150/);
  assert.match(node, /codexStopRunning/);
  assert.match(node, /abortRef\.current\?\.abort/);
  assert.match(node, /artifactMaterials/);
  assert.match(node, /@ 产物/);
  assert.match(node, /MaterialPreviewSection/);
  assert.match(node, /data-codex-studio-input-materials="true"/);
  assert.match(node, /上游素材 · Agent 输入/);
  assert.match(node, /orderedInputTexts/);
  assert.match(node, /inputMaterialTotal/);
  assert.match(node, /normalizeExcludedMaterialIds/);
  assert.match(node, /filterExcludedMaterials/);
  assert.match(node, /excludeMaterialId/);
  assert.match(node, /countExcludedMaterials/);
  assert.match(node, /onExcludeUpstream=\{excludeUpstreamMaterial\}/);
  assert.match(node, /onRestoreExcluded=\{restoreExcludedMaterials\}/);
  assert.match(node, /selectedSkillNames/);
  assert.match(node, /createCodexProjectSkill/);
  assert.match(node, /版本树/);
  assert.match(node, /质量检查/);
  assert.match(node, /streamCodexCliAgent/);
  assert.match(node, /publishArtifact/);
  assert.match(node, /saveArtifactToResourceLibrary/);
  assert.match(node, /useRunTrigger\(id, handleQuickRun, 'codex-cli-agent'\)/);
  assert.match(node, /artifactLibraryTab/);
  assert.match(node, /data-codex-artifact-tab/);
  assert.match(node, /activeControlText/);
  assert.match(node, /inactiveControlBg/);
  assert.match(node, /visibleStudioArtifacts/);
  assert.match(node, /renderArtifactCard/);
  assert.match(node, /deleteArtifact/);
  assert.match(node, /data-codex-artifact-action="delete"/);
  assert.match(node, /data-codex-artifact-zoom-trigger/);
  assert.match(node, /data-codex-artifact-zoom-preview/);
  assert.match(node, /100%/);
  assert.match(node, /renderSimpleCompletionSummary/);
  assert.match(node, /queueArtifactEdit\(artifact, true\)[\s\S]*变体/);
  assert.doesNotMatch(node, /renderArtifactPreview\(latestArtifact\)/);
  assert.doesNotMatch(node, />\s*转视频\s*</);
  assert.doesNotMatch(node, /creatorPresets\.slice\(0,\s*6\)\.map/);
  assert.doesNotMatch(node, /renderPresetList\(true\)/);
  assert.doesNotMatch(node, /renderSkillList\(true\)/);
  assert.doesNotMatch(node, /renderPresetList\(false\)/);
  assert.doesNotMatch(node, /renderSkillList\(false\)/);
  assert.doesNotMatch(node, /const renderPresetList/);
  assert.doesNotMatch(node, /const renderSkillList/);
  assert.doesNotMatch(node, /const renderModeSelect/);
  assert.doesNotMatch(node, /background:\s*msg\.role === 'tool'/);
  assert.match(node, /data-codex-studio-thread/);
  assert.match(node, /studioThreadScrollRef/);
  assert.match(node, /data-codex-studio-copyable/);
  assert.match(node, /data-codex-message-copyable/);
  assert.match(node, /copyCodexMessage/);
  assert.match(node, /stopImmediatePropagation/);
  assert.match(node, /document\.addEventListener\('pointerdown', stopSelectableTextGesture, true\)/);
  assert.match(node, /userSelect:\s*'text'/);
  assert.match(node, /nodrag nopan nowheel min-h-0 flex-1 overflow-auto/);
  assert.match(node, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(node, /data-codex-message-role/);
  assert.match(node, /w-full min-w-0/);
});

test('Codex creator studio exposes sortable visible input materials without deleting source nodes', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');
  const canvas = read('../src/components/Canvas.tsx');

  assert.match(canvas, /'codex-cli-agent':\s*\{[\s\S]*materialOrder:\s*\[\]/);
  assert.match(canvas, /'codex-cli-agent':\s*\{[\s\S]*excludedMaterialIds:\s*\[\]/);
  assert.match(node, /const visibleUpstreamImages = useMemo\([\s\S]*filterExcludedMaterials\(upstream\.images, excludedMaterialIds\)/);
  assert.match(node, /const studioConsumedMaterialIds = useMemo/);
  assert.match(node, /const activeUpstreamImages = useMemo\([\s\S]*studioOpen && !persistMaterials \? filterExcludedMaterials\(visibleUpstreamImages, studioConsumedMaterialIds\) : visibleUpstreamImages/);
  assert.match(node, /const orderedTexts = useOrderedMaterials\(activeUpstreamTexts, materialOrder\)/);
  assert.doesNotMatch(node, /const orderedTexts = useOrderedMaterials\(\[\.\.\.visibleUpstreamTexts, \.\.\.artifactMaterials/);
  assert.match(node, /const orderedImages = useOrderedMaterials\(activeUpstreamImages, materialOrder\)/);
  assert.match(node, /const setMaterialOrder = useCallback\(\(nextOrder: string\[\]\) => update\(\{ materialOrder: nextOrder \}\)/);
  assert.match(node, /if \(material\.origin !== 'upstream'\) return/);
  assert.match(node, /excludedMaterialIds: excludeMaterialId\(excludedMaterialIds, material\.id\)/);
  assert.match(node, /materialOrder: materialOrder\.filter\(\(itemId: string\) => itemId !== material\.id\)/);
  assert.match(node, /update\(\{ excludedMaterialIds: \[\] \}\)/);
  assert.match(node, /<MaterialPreviewSection[\s\S]*texts=\{orderedInputTexts\}[\s\S]*images=\{orderedImages\}[\s\S]*videos=\{orderedVideos\}[\s\S]*audios=\{orderedAudios\}/);
  assert.match(node, /finishPatch\.codexStudioConsumedMaterialIds = mergeMaterialIds\(studioConsumedMaterialIds, consumedIds\)/);
  assert.match(node, /codexPersistMaterials: event\.currentTarget\.checked[\s\S]*codexStudioConsumedMaterialIds: \[\]/);
});

test('Codex creator prompt promotes slash skill references and image skills', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');

  const prompt = runner.makeCreatorPrompt({
    preset: '提示词增强',
    mode: 'prompt',
    prompt: '生成一个美女图片',
    selectedSkillNames: ['imagen'],
  });

  assert.match(prompt, /\$imagen/);
  assert.match(prompt, /必须直接生成图片文件/);
  assert.match(prompt, /不要只输出提示词文本/);
});

test('Codex creator prompt does not auto-enable image generation in LLM mode', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');

  const prompt = runner.makeCreatorPrompt({
    preset: '默认创作',
    mode: 'chat',
    prompt: '生成一个美女图片',
    selectedSkillNames: [],
    llmOnly: true,
  });

  assert.doesNotMatch(prompt, /必须直接生成图片文件/);
  assert.doesNotMatch(prompt, /image_generation/);
});

test('Codex simple creator mode has explicit LLM IMG intent, model defaults, imagegen default skill, and image-first publishing', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /data-codex-simple-run-intent=\{codexRunIntent\}/);
  assert.match(node, /data-codex-simple-input-materials="true"/);
  assert.match(node, /const shouldClearPromptAfterRun = studioOpen && !persistPrompt/);
  assert.doesNotMatch(node, /if \(!persistPrompt\) startPatch\.codexQuickPrompt = ''/);
  assert.doesNotMatch(node, /if \(!persistPrompt\) finishPatch\.codexQuickPrompt = ''/);
  assert.match(node, /const runIntent: CodexRunIntent = codexRunIntent/);
  assert.doesNotMatch(node, /studioOpen \? codexRunIntent : 'auto'/);
  assert.match(node, /codexModelAutoPatchForRunIntent\(nextIntent\)/);
  assert.match(node, /findDefaultImageGenerationSkill/);
  assert.match(node, /codexAutoImagegenSkillName/);
  assert.match(node, /updateCodexRunIntent[\s\S]*nextIntent === 'img'[\s\S]*codexSelectedSkillNames/);
  assert.match(node, /codexRunIntent === 'llm'[\s\S]*codexAutoImagegenSkillName/);
  assert.doesNotMatch(node, /rawSkillNamesForRun\.push\(defaultImageGenerationSkill\.name\)/);
  assert.match(node, /selectAutoPublishArtifact/);
  assert.match(node, /selectAutoPublishArtifact\(runArtifactsForPublish,\s*runIntent,\s*latest\)/);
});

test('Codex creator exposes compact imagegen parameter lists and chips near prompt inputs', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /CODEX_IMAGEGEN_PARAM_LISTS/);
  assert.match(node, /CODEX_IMAGEGEN_QUICK_PARAMS/);
  assert.match(node, /appendCommaSeparatedPromptToken/);
  assert.match(node, /renderImagegenQuickParamBar/);
  assert.match(node, /data-codex-imagegen-param-bar=\{placement\}/);
  assert.match(node, /data-codex-imagegen-param-list=\{group\.label\}/);
  assert.match(node, /data-codex-imagegen-param=\{item\.value\}/);
  assert.match(node, /const CODEX_IMAGEGEN_QUICK_PARAMS = \[\s*\{ label: '1:1'[\s\S]*\{ label: '16:9'[\s\S]*\{ label: '9:16'[\s\S]*\{ label: '4:3'[\s\S]*\{ label: '3:4'[\s\S]*\{ label: '21:9'[\s\S]*\{ label: '9:21'[\s\S]*\{ label: '1K'[\s\S]*\{ label: '2K'[\s\S]*\{ label: '4K'/);
  assert.doesNotMatch(node, /const CODEX_IMAGEGEN_QUICK_PARAMS = \[[\s\S]*?\{ label: '4:5'/);
  assert.match(node, /label:\s*'文\+图'[\s\S]*value:\s*'文字和图片同时生成'/);
  assert.match(node, /label:\s*'比例'[\s\S]*value:\s*'9:21'/);
  assert.match(node, /label:\s*'尺寸'[\s\S]*value:\s*'1024x1536'/);
  assert.match(node, /label:\s*'质量'[\s\S]*value:\s*'high detail'/);
  assert.match(node, /label:\s*'风格'[\s\S]*value:\s*'cinematic'/);
  assert.match(node, /value:\s*'9:16'/);
  assert.match(node, /codexQuickPrompt: appendCommaSeparatedPromptToken\(quickPrompt, value\)/);
  assert.match(node, /renderImagegenQuickParamBar\('studio'\)[\s\S]*<MentionPromptInput/);
  assert.match(node, /<MentionPromptInput[\s\S]*renderImagegenQuickParamBar\('simple'\)/);
});

test('Codex creator prompt treats connected images as binding visual references', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');

  const prompt = runner.makeCreatorPrompt({
    preset: '图像生成',
    mode: 'image',
    prompt: '改成活动海报',
    selectedSkillNames: ['imagegen'],
    images: ['C:\\tmp\\reference.png'],
  });

  assert.match(prompt, /参考图使用约束/);
  assert.match(prompt, /主体身份/);
  assert.match(prompt, /不要脱离参考图另起炉灶/);
  assert.match(prompt, /如果参考图读取失败/);
});

test('Codex simple run accepts upstream image-only tasks and sends image references', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /buildImageOnlyPrompt/);
  assert.match(node, /imagesForRun\.length/);
  assert.match(node, /请填写任务，或连接上游图片/);
  assert.match(node, /promptForRun/);
  assert.match(node, /images:\s*imagesForRun/);
});

test('Codex creator node remains draggable and exposes setup/login guidance', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /data-codex-cli-agent-root/);
  assert.match(node, /data-codex-drag-surface/);
  assert.doesNotMatch(node, /className="nodrag nowheel"\s+style=\{rootStyle\}/);
  assert.match(node, /clearRecoverableCodexError/);
  assert.match(node, /codexStatusPanel/);
  assert.match(node, /startCodexCliLogin/);
  assert.match(node, /正在打开 Codex 登录窗口/);
  assert.match(node, /CODEX_LOGIN_FLOW_STEPS/);
  assert.match(node, /copyCodexSetupCommand/);
  assert.match(node, /codexLoginCommand/);
  assert.match(node, /friendlyCodexErrorMessage/);
  assert.match(node, /登录 Codex CLI/);
  assert.match(node, /打开登录/);
  assert.match(node, /复制安装命令/);
  assert.match(node, /普通 CMD 或 PowerShell/);
  assert.match(node, /登录流程/);
  assert.match(node, /需要登录或填写 Codex CLI 路径/);
  assert.match(node, /检测详情/);
  assert.match(node, /后端路由未加载/);
});

test('Codex creator node implements roadmap creator workflow extras', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /renderProjectSkillEditor/);
  assert.match(node, /buildCreatorBriefBlock/);
  assert.match(node, /codexBriefSubject/);
  assert.match(node, /codexStyleLock/);
  assert.match(node, /codexTargetPlatform/);
  assert.match(node, /codexBatchVariantCount/);
  assert.match(node, /createVariantPrompt/);
  assert.doesNotMatch(node, /createVideoPrompt/);
  assert.match(node, /openArtifactSendModal/);
  assert.match(node, /批量变体/);
  assert.match(node, /风格锁定/);
  assert.match(node, /平台转换/);
  assert.match(node, /自动负面词/);
  assert.match(node, /发送画布/);
});

test('Codex creator node keeps template and project-skill editors out of the narrow studio sidebar', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /studioToolPanel/);
  assert.match(node, /codexStudioTool/);
  assert.match(node, /data-codex-studio-tool="template-workshop"/);
  assert.match(node, /data-codex-studio-tool="project-skill"/);
  assert.doesNotMatch(node, /creatorSkillTemplates\.map/);
  assert.doesNotMatch(node, /让 Codex 生成/);
  assert.match(node, /data-codex-empty-template-option/);
});

test('Codex template and project skill workshops expose category, rename, and delete management', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /codexPresetDraftCategory/);
  assert.match(node, /codexTemplateCategoryFilter/);
  assert.match(node, /codexTemplateSelectCategory/);
  assert.match(node, /visibleSelectableCreatorPresets/);
  assert.match(node, /editingPresetId/);
  assert.match(node, /saveCustomPreset/);
  assert.match(node, /editCustomPreset/);
  assert.match(node, /deleteCustomPreset/);
  assert.match(node, /data-codex-template-category/);
  assert.match(node, /data-codex-template-category="select-filter"/);
  assert.match(node, /NO_CREATOR_PRESET_ID/);
  assert.match(node, />无模板</);
  assert.match(node, /hasActiveCreatorPreset/);
  assert.doesNotMatch(node, /item\.id === presetId \|\| item\.label === presetId \|\| item\.mode === mode/);
  assert.match(node, /data-codex-template-action="rename"/);
  assert.match(node, /data-codex-template-action="delete"/);
  assert.match(node, /skillDraftCategory/);
  assert.match(node, /editingSkillName/);
  assert.match(node, /projectSkillCategoryFilter/);
  assert.match(node, /updateCodexProjectSkill/);
  assert.match(node, /deleteCodexProjectSkill/);
  assert.match(node, /data-codex-project-skill-category/);
  assert.match(node, /data-codex-skill-action="rename"/);
  assert.match(node, /data-codex-skill-action="delete"/);
  assert.match(node, /保存修改/);
  assert.match(node, /重命名/);
  assert.match(node, /删除/);
});

test('Codex selected creator template survives IMG mode and is sent as explicit instructions', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /buildPresetInstructionBlock/);
  assert.match(node, /当前创作模板/);
  assert.match(node, /模板分类/);
  assert.match(node, /模板指令/);
  assert.match(node, /const presetInstruction = hasActiveCreatorPreset/);
  assert.match(node, /buildPresetInstructionBlock\(runPreset,\s*forceImageGeneration\)/);
  assert.match(node, /runPreset = hasActiveCreatorPreset[\s\S]*\? currentPreset/);
  assert.match(node, /const runMode = forceImageGeneration \? 'image' : runPreset\.mode/);
  assert.doesNotMatch(node, /const runPreset = forceImageGeneration \? imagePreset : currentPreset/);
});

test('Codex template and project skill workshops support import and export migration', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /templateImportInputRef/);
  assert.match(node, /projectSkillImportInputRef/);
  assert.match(node, /exportCustomPresets/);
  assert.match(node, /importCustomPresets/);
  assert.match(node, /exportProjectSkills/);
  assert.match(node, /importProjectSkills/);
  assert.match(node, /t8-codex-creator-templates/);
  assert.match(node, /t8-codex-project-skills/);
  assert.match(node, /导入/);
  assert.match(node, /导出/);
  assert.match(node, /accept="application\/json"/);
});

test('Codex creator run preferences and studio layout use the full conversation lane', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /codexAutoPublishOutput/);
  assert.match(node, /codexPersistPrompt/);
  assert.match(node, /codexPersistMaterials/);
  assert.match(node, /生成后自动发布到画布输出/);
  assert.match(node, /提示词持久化/);
  assert.match(node, /素材持久化/);
  assert.match(node, /studioAutoPublishOutput = d\.codexAutoPublishOutput === true/);
  assert.match(node, /autoPublishOutput = studioOpen \? studioAutoPublishOutput : true/);
  assert.match(node, /renderRunPreferenceControls = \(compact = false, showPersistence = true, showAutoPublish = true\)/);
  assert.match(node, /showAutoPublish &&/);
  assert.match(node, /showPersistence &&/);
  assert.match(node, /renderRunPreferenceControls\(!showManage, !showManage, !showManage\)/);
  assert.doesNotMatch(node, /renderRunPreferenceControls\(!showManage, !showManage\)/);
  assert.doesNotMatch(node, /codexAutoPublishOutput !== false/);
  assert.match(node, /const autoPublishArtifact = selectAutoPublishArtifact\(runArtifactsForPublish,\s*runIntent,\s*latest\)/);
  assert.match(node, /if \(autoPublishArtifact && autoPublishOutput\) publishArtifact\(autoPublishArtifact\)/);
  assert.match(node, /data-codex-studio-thread-inner/);
  assert.doesNotMatch(node, /mx-auto max-w-4xl space-y-5/);
  assert.match(node, /max-w-\[92%\]/);
});

test('Codex creator studio keeps session memory with automatic compression', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /CODEX_STUDIO_CONTEXT_DEFAULT_LIMIT = 30/);
  assert.match(node, /CODEX_STUDIO_CONTEXT_MAX_LIMIT = 80/);
  assert.match(node, /codexContextSummary/);
  assert.match(node, /codexContextCompressedCount/);
  assert.match(node, /codexContextLimit/);
  assert.match(node, /function buildCodexStudioMemoryContext/);
  assert.match(node, /function buildCodexStudioMemoryPrompt/);
  assert.match(node, /studioOpen \? buildCodexStudioMemoryContext\(messagesRef\.current/);
  assert.match(node, /const studioMemoryPrompt = studioMemory \? buildCodexStudioMemoryPrompt\(studioMemory\) : ''/);
  assert.match(node, /studioMemoryPrompt/);
  assert.match(node, /本轮创作台会话记忆/);
  assert.match(node, /codexContextSummary: ''/);
  assert.match(node, /codexContextCompressedCount: 0/);
  assert.match(node, /contextSummary: String\(d\.codexContextSummary/);
  assert.match(node, /contextCompressedCount: clampInteger\(d\.codexContextCompressedCount/);
  assert.match(node, /已压缩 \{codexContextCompressedCount\} 条历史为长期记忆/);
  assert.doesNotMatch(node, /studioMemoryPrompt[\s\S]{0,160}simple/);
});

test('Codex creator keeps streaming and history data canvas-performant', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /CODEX_MESSAGE_STORAGE_CHAR_LIMIT/);
  assert.match(node, /CODEX_ARTIFACT_TEXT_STORAGE_CHAR_LIMIT/);
  assert.match(node, /CODEX_STUDIO_SESSION_STORAGE_LIMIT/);
  assert.match(node, /function trimCodexStorageText/);
  assert.match(node, /function compactCodexStudioSessionForCanvas/);
  assert.match(node, /content:\s*trimCodexStorageText\(content,/);
  assert.match(node, /text:\s*trimCodexStorageText\(text,\s*CODEX_ARTIFACT_TEXT_STORAGE_CHAR_LIMIT\)/);
  assert.match(node, /compactCodexStudioSessionForCanvas\(current\)/);
  assert.match(node, /slice\(0,\s*CODEX_STUDIO_SESSION_STORAGE_LIMIT\)/);

  const deltaHandler = /onDelta:\s*\(delta\)\s*=>\s*\{([\s\S]*?)\n\s*\},\n\s*onEvent:/.exec(node)?.[1] || '';
  assert.match(deltaHandler, /streamedText \+= delta/);
  assert.match(deltaHandler, /setStreamingReply\(streamedText\)/);
  assert.doesNotMatch(deltaHandler, /setMessages\(/);
  assert.doesNotMatch(deltaHandler, /replaceAssistant\(streamedText/);
  assert.match(node, /msg\.status === 'running' && msg\.role === 'assistant' \? streamingReply/);
});

test('Codex CLI Agent ports stay grouped around the node middle', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.match(node, /function codexAgentHandleTop\(index: number, count: number\)/);
  assert.match(node, /return '50%'/);
  assert.match(node, /calc\(50%/);
  assert.match(node, /top: codexAgentHandleTop\(0, 4\)/);
  assert.match(node, /top: codexAgentHandleTop\(3, 4\)/);
  assert.match(node, /top: codexAgentHandleTop\(0, 5\)/);
  assert.match(node, /top: codexAgentHandleTop\(4, 5\)/);
  assert.doesNotMatch(node, /top: 94/);
  assert.doesNotMatch(node, /top: 260/);
});

test('Codex creator product library supports durable deletion and batch cleanup', () => {
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');
  const runner = read('../backend/src/utils/codexCliRunner.js');
  const route = read('../backend/src/routes/codexCli.js');

  assert.match(node, /codexDeletedArtifactKeys/);
  assert.match(node, /artifactDeleteKeys/);
  assert.match(node, /artifactMatchesDeletedKeys/);
  assert.match(node, /filterDeletedArtifacts\(sanitizeArtifacts\(d\.codexArtifacts\), deletedArtifactKeys\)/);
  assert.match(node, /if \(artifactMatchesDeletedKeys\(stored, deletedArtifactKeysRef\.current\)\) return null/);
  assert.match(node, /filterDeletedArtifacts\(sanitizeArtifacts\(target\.artifacts\), deletedArtifactKeysRef\.current\)/);
  assert.match(node, /deleteArtifacts/);
  assert.match(node, /codexStudioSessions: nextSessions/);
  assert.match(node, /artifactBatchMode/);
  assert.match(node, /selectedArtifactIds/);
  assert.match(node, /删选中/);
  assert.match(node, /全选当前/);
  assert.match(node, /已清空 Codex 产物库/);
  assert.match(node, /outputText:\s*''/);
  assert.match(node, /prompt:\s*''/);
  assert.match(node, /lastPrompt:\s*''/);
  assert.match(node, /generatedImages:\s*\[\]/);
  assert.match(node, /directImageUrls:\s*\[\]/);
  assert.match(runner, /function collectCodexRunArtifacts/);
  assert.match(runner, /return dedupeArtifacts\(\[\.\.\.artifactsByText,\s*\.\.\.artifactsByWorkspace]\)/);
  assert.match(runner, /partialArtifacts/);
  assert.match(runner, /error\.artifacts\s*=\s*partialArtifacts/);
  assert.match(route, /const errorArtifacts = Array\.isArray\(error\?\.artifacts\)/);
  assert.match(route, /for \(const artifact of errorArtifacts\)/);
  assert.doesNotMatch(node, /artifactStableTitle\(artifact\)/);
  assert.doesNotMatch(node, /downloadName\(artifact\.url \|\| urls\[0\] \|\| '', ''\)/);
});

test('Codex creator filters raw CLI progress and does not persist slash Skill calls', () => {
  const runner = require('../backend/src/utils/codexCliRunner.js');
  const node = read('../src/components/nodes/CodexCliAgentNode.tsx');

  assert.equal(runner.shouldForwardCodexProgressForTests('thread.started', { rawType: 'thread.started' }), false);
  assert.equal(runner.shouldForwardCodexProgressForTests('item.completed', { rawType: 'item.completed' }), false);
  assert.equal(runner.shouldForwardCodexProgressForTests('Reading prompt from stdin...', {}), false);
  assert.equal(runner.shouldForwardCodexProgressForTests('当前 Codex CLI 未提供 plan_tool feature，已跳过 Plan Tool CLI 开关。', { type: 'feature.skipped', feature: 'plan_tool' }), false);
  assert.equal(runner.shouldForwardCodexProgressForTests('正在生成图像...', {}), true);

  assert.match(node, /function shouldStoreTextArtifact/);
  assert.doesNotMatch(node, /if \(hasMedia\) return false/);
  assert.match(node, /role === 'tool' && !shouldDisplayCodexToolMessage/);
  assert.match(node, /if \(shouldDisplayCodexToolMessage\(event, msg\)\) appendToolMessage\(msg\)/);
  assert.match(node, /selectedRunnableSkillNames/);
  assert.match(node, /codexSelectedSkillNames: selectedRunnableSkillNames/);
  assert.doesNotMatch(node, /skillPickerMode === 'slash'[\s\S]{0,600}codexSelectedSkillNames/);
});
