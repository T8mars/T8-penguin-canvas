'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('../config');

const CODEX_DISABLED_MESSAGE = 'Codex CLI 不可用：请确认已安装并登录 Codex CLI，或在节点高级设置中填写可执行文件路径。';
const CODEX_WINDOWS_APPS_MESSAGE = '检测到 WindowsApps Codex 入口不可直接 spawn，请清空节点里的 Codex 路径，让 T8 自动使用 npm 的 codex.cmd，或填写 C:\\Users\\<用户名>\\AppData\\Roaming\\npm\\codex.cmd。';
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv)(?:[?#].*)?$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac|opus)(?:[?#].*)?$/i;
const MODEL3D_EXT_RE = /\.(glb|gltf|obj|stl|fbx|usdz|zip)(?:[?#].*)?$/i;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeSegment(value, fallback = 'item') {
  const text = String(value || '').trim();
  const cleaned = text
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function codexWorkspaceRoot() {
  return path.join(config.DATA_DIR, 'codex-workspaces');
}

function outputCodexDir() {
  return path.join(config.OUTPUT_DIR, 'codex');
}

function assertInside(baseDir, filePath) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(filePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('素材路径不在允许目录内');
  }
  return resolved;
}

function createCodexWorkspace(options = {}) {
  const nodeId = safeSegment(options.nodeId || 'codex-node');
  const sessionId = safeSegment(options.sessionId || `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  const explicitDir = String(options.workspaceDir || '').trim();
  const dir = explicitDir ? path.resolve(explicitDir) : path.join(codexWorkspaceRoot(), nodeId, sessionId);
  const inputDir = path.join(dir, 'inputs');
  const outputDir = path.join(dir, 'outputs');
  ensureDir(inputDir);
  ensureDir(outputDir);
  return { dir, inputDir, outputDir, nodeId, sessionId };
}

function defaultCodexExecutable() {
  return process.env.T8_CODEX_CLI_PATH || process.env.CODEX_CLI_PATH || 'codex';
}

function pathEnvValue(env = process.env) {
  return String(env.PATH || env.Path || env.path || '');
}

function uniquePush(list, value) {
  const text = String(value || '').trim();
  if (!text || list.includes(text)) return;
  list.push(text);
}

function isWindowsAppsPath(value) {
  return /[\\/]WindowsApps[\\/]/i.test(String(value || ''));
}

function hasPathSeparator(value) {
  return /[\\/]/.test(String(value || ''));
}

function winNeedsShell(command) {
  return /\.(cmd|bat)$/i.test(String(command || ''));
}

function codexCandidateScore(file) {
  const text = String(file || '');
  const ext = path.extname(text).toLowerCase();
  let score = 0;
  if (isWindowsAppsPath(text)) score += 80;
  if (ext === '.cmd') score += 0;
  else if (ext === '.exe') score += 4;
  else if (ext === '.bat') score += 8;
  else if (ext === '.ps1') score += 70;
  else score += 50;
  if (/[\\/]npm[\\/]codex\.cmd$/i.test(text)) score -= 10;
  return score;
}

function findCodexCandidates(command, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const raw = String(command || 'codex').trim() || 'codex';
  const candidates = [];
  if (hasPathSeparator(raw)) {
    uniquePush(candidates, raw);
    if (platform === 'win32' && !path.extname(raw)) {
      ['.cmd', '.exe', '.bat'].forEach((ext) => uniquePush(candidates, `${raw}${ext}`));
    }
    return candidates.filter((file) => fs.existsSync(file));
  }

  const dirs = [];
  if (platform === 'win32') {
    const appData = String(env.APPDATA || '').trim();
    const userProfile = String(env.USERPROFILE || '').trim();
    if (appData) uniquePush(dirs, path.join(appData, 'npm'));
    if (userProfile) uniquePush(dirs, path.join(userProfile, 'AppData', 'Roaming', 'npm'));
  }
  pathEnvValue(env).split(path.delimiter).forEach((dir) => uniquePush(dirs, dir));

  const names = platform === 'win32'
    ? [`${raw}.cmd`, `${raw}.exe`, `${raw}.bat`, raw, `${raw}.ps1`]
    : [raw];
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) uniquePush(candidates, file);
    }
  }
  return candidates.sort((a, b) => codexCandidateScore(a) - codexCandidateScore(b));
}

function resolveCodexExecutable(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const requested = String(options.executablePath || defaultCodexExecutable()).trim() || 'codex';
  const candidates = findCodexCandidates(requested, { env, platform });
  const command = candidates[0] || requested;
  return {
    requested,
    command,
    executable: command,
    shell: platform === 'win32' && winNeedsShell(command),
    resolved: candidates.length > 0,
    fromWindowsApps: isWindowsAppsPath(command),
    candidates,
  };
}

function spawnCodexProcess(args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const resolved = resolveCodexExecutable({
    executablePath: options.executablePath,
    env,
    platform: options.platform,
  });
  const child = spawn(resolved.command, args, {
    cwd: options.cwd || config.BASE_DIR,
    shell: resolved.shell,
    windowsHide: true,
    detached: Boolean(options.detached),
    stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
    env,
  });
  child.__codexResolved = resolved;
  return child;
}

function runCodexCommand(args, options = {}) {
  return new Promise((resolve) => {
    let child;
    const startedAt = Date.now();
    const done = (patch) => {
      if (!child || !child.__codexDone) {
        if (child) child.__codexDone = true;
        resolve({
          code: null,
          stdout: '',
          stderr: '',
          elapsedMs: Date.now() - startedAt,
          ...(patch || {}),
        });
      }
    };
    try {
      child = spawnCodexProcess(args, options);
    } catch (error) {
      const resolved = resolveCodexExecutable({
        executablePath: options.executablePath,
        env: { ...process.env, ...(options.env || {}) },
        platform: options.platform,
      });
      done({
        code: null,
        error,
        executable: resolved.executable,
        resolved,
        message: error?.message || String(error),
      });
      return;
    }
    if (child.stdin) child.stdin.end();
    const resolved = child.__codexResolved;
    let stdout = '';
    let stderr = '';
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15000));
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      done({
        code: null,
        stdout,
        stderr,
        executable: resolved.executable,
        resolved,
        message: 'Codex CLI 命令超时',
      });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({
        code: null,
        stdout,
        stderr,
        error,
        executable: resolved.executable,
        resolved,
        message: error?.message || String(error),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({
        code,
        stdout,
        stderr,
        executable: resolved.executable,
        resolved,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

function codexUnavailableMessage(result, fallback = '') {
  const message = String(fallback || result?.message || result?.stderr || result?.stdout || '').trim();
  const windowsApps = result?.resolved?.fromWindowsApps || isWindowsAppsPath(result?.executable) || /WindowsApps|spawn EPERM/i.test(message);
  const detail = windowsApps ? CODEX_WINDOWS_APPS_MESSAGE : message;
  return `${CODEX_DISABLED_MESSAGE} ${detail || ''}`.trim();
}

function parseCodexFeatureList(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 3) return null;
      const enabledText = parts[parts.length - 1];
      const name = parts[0];
      const stage = parts.slice(1, -1).join(' ');
      if (!/^[a-z0-9_/-]+$/i.test(name)) return null;
      return {
        name,
        stage,
        enabled: /^true$/i.test(enabledText),
      };
    })
    .filter(Boolean);
}

async function listCodexFeatures(options = {}) {
  const result = await runCodexCommand(['features', 'list'], {
    executablePath: options.executablePath,
    env: options.env,
    platform: options.platform,
    timeoutMs: options.timeoutMs || 12000,
  });
  if (result.code !== 0) return [];
  return parseCodexFeatureList(result.stdout);
}

function buildCodexLoginStartInvocation(options = {}) {
  const resolved = resolveCodexExecutable(options);
  const args = options.deviceAuth ? ['login', '--device-auth'] : ['login'];
  return {
    ...resolved,
    args,
    commandText: formatCodexCommandForDisplay(resolved.executable, args),
  };
}

function quoteCmdArg(value) {
  const text = String(value || '');
  return `"${text.replace(/"/g, '""')}"`;
}

function formatCodexCommandForDisplay(executable, args = []) {
  const exe = String(executable || 'codex').trim() || 'codex';
  const renderedExe = /\s/.test(exe) ? quoteCmdArg(exe) : exe;
  return [renderedExe, ...args.map((arg) => {
    const text = String(arg || '');
    return /\s/.test(text) ? quoteCmdArg(text) : text;
  })].join(' ');
}

function escapeCmdEchoText(value) {
  return String(value || '').replace(/([&<>|^])/g, '^$1').replace(/%/g, '%%');
}

function writeCodexLoginCmdScript(invocation) {
  const dir = path.join(config.DATA_DIR, 'codex-login');
  ensureDir(dir);
  const filePath = path.join(dir, 'open-codex-login.cmd');
  const commandLine = formatCodexCommandForDisplay(invocation.executable || invocation.command || 'codex', invocation.args);
  const content = [
    '@echo off',
    'chcp 65001 > nul',
    'title T8 Codex CLI 登录',
    'echo.',
    'echo T8 Codex CLI 登录流程',
    'echo ------------------------------------------------------------',
    'echo 1. 如果浏览器打开 OpenAI/Codex 授权页，请在浏览器完成登录。',
    'echo 2. 如果终端显示验证码或确认链接，请按终端提示完成授权。',
    'echo 3. 登录完成后回到 T8 画布，点击 Codex 节点里的“刷新”。',
    'echo.',
    `echo 即将执行: ${escapeCmdEchoText(commandLine)}`,
    'echo.',
    commandLine,
    'set T8_CODEX_LOGIN_EXIT=%ERRORLEVEL%',
    'echo.',
    'if "%T8_CODEX_LOGIN_EXIT%"=="0" (',
    '  echo Codex 登录命令已结束。请回到 T8 画布点击“刷新”。',
    ') else (',
    '  echo Codex 登录命令返回错误码 %T8_CODEX_LOGIN_EXIT%。',
    '  echo 如果这里没有打开浏览器，请复制节点里的 codex login 命令，在普通 CMD 或 PowerShell 中手动运行。',
    ')',
    'echo.',
    'pause',
    '',
  ].join('\r\n');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function startCodexLoginInVisibleTerminal(invocation, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return null;
  const scriptPath = writeCodexLoginCmdScript(invocation);
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" ${quoteCmdArg(scriptPath)}`], {
    cwd: config.BASE_DIR,
    windowsHide: false,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return {
    started: true,
    mode: 'visible-terminal',
    executable: invocation.executable,
    command: invocation.commandText,
    scriptPath,
    message: '已打开可见的 Codex 登录窗口；请在新窗口或浏览器完成登录，完成后回到节点点击刷新。',
  };
}

function startCodexLogin(options = {}) {
  const invocation = buildCodexLoginStartInvocation(options);
  try {
    const visible = startCodexLoginInVisibleTerminal(invocation, options);
    if (visible) return visible;
    const child = spawnCodexProcess(invocation.args, {
      executablePath: options.executablePath,
      cwd: config.BASE_DIR,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return {
      started: true,
      executable: child.__codexResolved?.executable || invocation.executable,
      command: invocation.commandText,
      mode: 'background',
      message: '已打开 Codex CLI 登录流程；完成浏览器登录后回到节点点刷新。若没有任何窗口，请复制 codex login 命令到终端手动运行。',
    };
  } catch (error) {
    return {
      started: false,
      executable: invocation.executable,
      command: invocation.commandText,
      message: `${CODEX_DISABLED_MESSAGE} ${error?.message || error}`,
    };
  }
}

function normalizeAvailableFeatureNames(value) {
  const names = new Set();
  if (!Array.isArray(value)) return names;
  for (const item of value) {
    if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'enabled') && item.enabled !== true) {
      continue;
    }
    const name = typeof item === 'string' ? item : item?.name;
    const text = String(name || '').trim();
    if (text) names.add(text);
  }
  return names;
}

function pushSupportedFeature(args, featureName, availableFeatureNames) {
  if (!availableFeatureNames.has(featureName)) return false;
  args.push('--enable', featureName);
  return true;
}

function normalizeCliArgs(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replace(/^"|"$/g, '')) || [];
}

function stripUnsupportedCodexEnableArgs(args, availableFeatureNames) {
  const allowed = availableFeatureNames instanceof Set
    ? availableFeatureNames
    : normalizeAvailableFeatureNames(availableFeatureNames);
  const out = [];
  const list = Array.isArray(args) ? args : normalizeCliArgs(args);
  for (let i = 0; i < list.length; i += 1) {
    const item = String(list[i] || '').trim();
    if (!item) continue;
    if (item === '--enable' || item === '--enable-feature') {
      const featureName = String(list[i + 1] || '').trim();
      if (featureName && allowed.has(featureName)) {
        out.push(item, featureName);
      }
      i += 1;
      continue;
    }
    const inline = item.match(/^(--enable(?:-feature)?)=(.+)$/);
    if (inline) {
      const featureName = inline[2].trim();
      if (featureName && allowed.has(featureName)) out.push(item);
      continue;
    }
    out.push(item);
  }
  return out;
}

function isUnknownFeatureFlagError(message) {
  return /Unknown feature flag|unrecognized feature|unsupported feature|unexpected argument.*--enable/i.test(String(message || ''));
}

function buildCodexExecArgs(options = {}) {
  const args = ['exec', '--json'];
  const model = String(options.model || '').trim();
  const profile = String(options.profile || '').trim();
  const sandbox = String(options.sandbox || 'workspace-write').trim();
  const approvalPolicy = String(options.approvalPolicy || options.askForApproval || 'never').trim();
  const reasoningEffort = String(options.reasoningEffort || '').trim();
  const availableFeatureNames = normalizeAvailableFeatureNames(
    options.availableFeatures || options.featureNames || options.features,
  );
  const extraArgs = stripUnsupportedCodexEnableArgs(normalizeCliArgs(options.extraArgs), availableFeatureNames);

  if (model) args.push('--model', model);
  if (profile) args.push('--profile', profile);
  if (sandbox) args.push('--sandbox', sandbox);
  if (approvalPolicy) args.push('-c', `approval_policy="${approvalPolicy.replace(/"/g, '\\"')}"`);
  if (reasoningEffort) args.push('-c', `model_reasoning_effort="${reasoningEffort.replace(/"/g, '\\"')}"`);
  if (options.webSearch || options.search) pushSupportedFeature(args, 'web_search', availableFeatureNames);
  if (options.includePlanTool || options.plan) pushSupportedFeature(args, 'plan_tool', availableFeatureNames);
  if (options.imageGeneration || options.generateImage) pushSupportedFeature(args, 'image_generation', availableFeatureNames);
  if (options.skipGitRepoCheck !== false && !extraArgs.includes('--skip-git-repo-check')) {
    args.push('--skip-git-repo-check');
  }

  const images = Array.isArray(options.images) ? options.images : [];
  for (const image of images) {
    const text = String(image || '').trim();
    if (text) args.push('-i', text);
  }

  for (const item of extraArgs) {
    args.push(item);
  }

  args.push(options.useStdinPrompt === false ? String(options.prompt || '') : '-');
  return args;
}

function resolveCanvasFileUrlToPath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const clean = text.split('?')[0].split('#')[0];
  const mounts = [
    { prefix: '/files/input/', dir: config.INPUT_DIR },
    { prefix: '/input/', dir: config.INPUT_DIR },
    { prefix: '/files/output/', dir: config.OUTPUT_DIR },
    { prefix: '/output/', dir: config.OUTPUT_DIR },
  ];
  const mount = mounts.find((item) => clean.startsWith(item.prefix));
  if (!mount) return '';
  const rel = decodeURIComponent(clean.slice(mount.prefix.length));
  const resolved = assertInside(mount.dir, path.join(mount.dir, rel));
  return fs.existsSync(resolved) ? resolved : '';
}

function writeDataImageToWorkspace(value, workspace) {
  const text = String(value || '').trim();
  const match = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,(.+)$/i.exec(text);
  if (!match) return '';
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  ensureDir(workspace.inputDir);
  const filePath = path.join(workspace.inputDir, `reference-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return filePath;
}

function resolveCodexInputImages(images, workspace) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(images) ? images : []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    let resolved = resolveCanvasFileUrlToPath(text);
    if (!resolved && /^data:image\//i.test(text)) resolved = writeDataImageToWorkspace(text, workspace);
    if (!resolved && /^[a-z]+:\/\//i.test(text)) resolved = text;
    if (!resolved && fs.existsSync(text)) resolved = path.resolve(text);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function parseCodexJsonLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { type: 'raw', text };
  }
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => !isReasoningContent(item))
      .map((item) => contentText(item))
      .filter(Boolean)
      .join('');
  }
  if (content && typeof content === 'object') {
    if (isReasoningContent(content)) return '';
    return content.text || content.delta || content.output_text || content.content || '';
  }
  return '';
}

function isReasoningContent(value) {
  if (!value || typeof value !== 'object') return false;
  const type = String(value.type || value.kind || '').toLowerCase();
  const role = String(value.role || '').toLowerCase();
  return role === 'reasoning' || /reasoning|thought|thinking|scratchpad/.test(type);
}

function extractTextDelta(event) {
  if (!event || typeof event !== 'object') return '';
  if (isReasoningContent(event) || isReasoningContent(event.item) || isReasoningContent(event.message)) return '';
  if (typeof event.delta === 'string') return event.delta;
  if (typeof event.text_delta === 'string') return event.text_delta;
  if (typeof event.output_text_delta === 'string') return event.output_text_delta;
  if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') return event.delta;
  if (event.type === 'message.delta' && typeof event.text === 'string') return event.text;
  if (event.type === 'raw' && typeof event.text === 'string') return event.text + '\n';
  const choice = event.choices && event.choices[0];
  if (choice?.delta?.content) return String(choice.delta.content);
  if (choice?.text) return String(choice.text);
  if (event.item && (event.item.role === 'assistant' || event.item.type === 'agent_message' || event.item.type === 'message')) {
    return contentText(event.item.content || event.item.message || event.item.text);
  }
  if (event.message && event.message.role === 'assistant') {
    return contentText(event.message.content || event.message.text);
  }
  return '';
}

function shouldForwardCodexStderr(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  return lines.some((line) => (
    !/\bWARN\b\s+codex_core/i.test(line)
    && !/^Reading prompt from stdin/i.test(line)
  ));
}

function shouldForwardCodexProgress(message, event = {}) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/^(thread|turn|item)\.(started|completed)$/i.test(text)) return false;
  if (/^Reading prompt from stdin/i.test(text)) return false;
  if (event?.type === 'feature.skipped' && event?.feature === 'plan_tool') return false;
  return true;
}

function kindFromUrl(url) {
  const text = String(url || '');
  if (IMAGE_EXT_RE.test(text) || /^data:image\//i.test(text)) return 'image';
  if (VIDEO_EXT_RE.test(text) || /^data:video\//i.test(text)) return 'video';
  if (AUDIO_EXT_RE.test(text) || /^data:audio\//i.test(text)) return 'audio';
  if (MODEL3D_EXT_RE.test(text)) return 'model3d';
  return '';
}

function cleanArtifactCandidateUrl(value) {
  return String(value || '')
    .trim()
    .replace(/^<(.+)>$/s, '$1')
    .replace(/^['"](.+)['"]$/s, '$1')
    .replace(/[.,;，。；]+$/g, '')
    .trim();
}

function extractArtifactsFromText(text) {
  const seen = new Set();
  const out = [];
  const source = String(text || '');
  const candidates = [];
  const mdRe = /!\[[^\]]*]\(\s*(?:<([^>]+)>|([^)\s]+))\s*\)|\[[^\]]+]\(\s*(?:<([^>]+)>|([^)\s]+))\s*\)/g;
  let match;
  while ((match = mdRe.exec(source))) candidates.push(match[1] || match[2] || match[3] || match[4]);
  const looseRe = /https?:\/\/[^\s"'<>),，。；]+|\/files\/(?:input|output)\/[^\s"'<>),，。；]+|[A-Za-z]:[\\/][^\s"'<>),，。；]+|\.{1,2}\/[^\s"'<>),，。；]+/g;
  while ((match = looseRe.exec(source))) candidates.push(match[0]);
  const relativePathRe = /(?:[\w.-]+[\\/])+(?:[\w .()[\]-]+)\.(?:png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|mkv|mp3|wav|ogg|m4a|flac|aac|opus|glb|gltf|obj|stl|fbx|usdz|zip)(?:[?#][^\s"'<>),，。；]+)?/gi;
  while ((match = relativePathRe.exec(source))) {
    const before = source[match.index - 1] || '';
    if (before === '/' || before === '\\' || before === ':') continue;
    candidates.push(match[0]);
  }

  for (const candidate of candidates) {
    const url = cleanArtifactCandidateUrl(candidate);
    const kind = kindFromUrl(url);
    if (!kind) continue;
    const key = `${kind}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `codex-artifact-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`,
      kind,
      url,
      urls: [url],
      title: path.basename(url.split(/[?#]/)[0]) || `${kind} artifact`,
      status: 'completed',
      progress: 100,
    });
  }
  return out;
}

function normalizeArtifactUrl(filePathOrUrl, baseDir = '', cache) {
  const text = String(filePathOrUrl || '').trim();
  if (!text) return '';
  if (text.startsWith('/files/')) return text;
  if (/^https?:\/\//i.test(text) || /^data:/i.test(text)) return text;
  const abs = path.isAbsolute(text) ? text : path.resolve(baseDir || process.cwd(), text);
  if (!fs.existsSync(abs)) return '';
  if (cache?.has(abs)) return cache.get(abs);
  ensureDir(outputCodexDir());
  const suffix = crypto.randomBytes(4).toString('hex');
  const ext = path.extname(abs) || '.bin';
  const filename = `codex_${Date.now()}_${suffix}${ext}`;
  const target = path.join(outputCodexDir(), filename);
  fs.copyFileSync(abs, target);
  const url = `/files/output/codex/${filename}`;
  if (cache) cache.set(abs, url);
  return url;
}

function defaultCodexGeneratedImageDirs() {
  const home = process.env.HOME || os.homedir?.() || '';
  const codexHome = process.env.CODEX_HOME || (home ? path.join(home, '.codex') : '');
  return codexHome ? [path.join(codexHome, 'generated_images')] : [];
}

function extractArtifactsFromWorkspace(workspace, cache, options = {}) {
  const dirs = [
    workspace?.outputDir,
    workspace?.dir,
    ...(Array.isArray(options.extraDirs) ? options.extraDirs : []),
  ].filter(Boolean);
  const out = [];
  const seen = new Set();
  const createdAfterMs = Number(options.createdAfterMs || 0);
  const visit = (dir, depth = 0) => {
    if (!dir || depth > 3 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '.agents', '.codex'].includes(entry.name)) visit(full, depth + 1);
        continue;
      }
      const kind = kindFromUrl(full);
      if (!kind) continue;
      const stat = fs.statSync(full);
      if (createdAfterMs > 0 && stat.mtimeMs + 1000 < createdAfterMs) continue;
      const url = normalizeArtifactUrl(full, '', cache);
      const key = `${kind}:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `codex-file-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`,
        kind,
        url,
        urls: [url],
        title: entry.name,
        status: 'completed',
        progress: 100,
      });
    }
  };
  dirs.forEach((dir) => visit(dir, 0));
  return out;
}

function dedupeArtifacts(artifacts) {
  const seen = new Set();
  const out = [];
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const key = `${artifact.kind || ''}:${artifact.url || (artifact.urls || []).join('|') || artifact.text || artifact.title || ''}`;
    if (seen.has(key)) {
      const existingIndex = out.findIndex((item) => {
        const existingKey = `${item.kind || ''}:${item.url || (item.urls || []).join('|') || item.text || item.title || ''}`;
        return existingKey === key;
      });
      if (existingIndex >= 0) out.splice(existingIndex, 1);
    }
    seen.add(key);
    out.push(artifact);
  }
  return out;
}

function collectCodexRunArtifacts(fullText, workspace, startedAt) {
  const artifactUrlCache = new Map();
  const artifactsByText = extractArtifactsFromText(fullText)
    .map((item) => {
      const url = normalizeArtifactUrl(item.url, workspace.dir, artifactUrlCache);
      const urls = (item.urls || []).map((candidate) => normalizeArtifactUrl(candidate, workspace.dir, artifactUrlCache)).filter(Boolean);
      return {
        ...item,
        url,
        urls: urls.length ? urls : (url ? [url] : []),
      };
    })
    .filter((item) => item.url || item.urls?.length);
  const artifactsByWorkspace = extractArtifactsFromWorkspace(workspace, artifactUrlCache, {
    createdAfterMs: startedAt,
    extraDirs: defaultCodexGeneratedImageDirs(),
  });
  return dedupeArtifacts([...artifactsByText, ...artifactsByWorkspace]);
}

function parseFrontmatter(raw) {
  const text = String(raw || '');
  const data = {};
  if (!text.startsWith('---')) return data;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return data;
  const body = text.slice(3, end).split(/\r?\n/);
  for (const line of body) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*["']?(.+?)["']?\s*$/);
    if (m) data[m[1]] = m[2];
  }
  return data;
}

function skillSummaryFromMarkdown(raw) {
  const text = String(raw || '');
  const front = parseFrontmatter(text);
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const firstParagraph = text
    .replace(/^---[\s\S]*?\n---/, '')
    .split(/\r?\n\r?\n/)
    .map((part) => part.replace(/^#+\s*/gm, '').trim())
    .find(Boolean);
  return {
    name: front.name || heading || '',
    description: front.description || firstParagraph || '',
    category: front.category || '',
  };
}

function skillBodyFromMarkdown(raw) {
  let text = String(raw || '').replace(/^---[\s\S]*?\n---/, '').trimStart();
  text = text.replace(/^#\s+.+(?:\r?\n)+/, '').trimStart();
  return text.trim();
}

function collectPluginSkillRoots(codexHome) {
  const bases = [
    path.join(codexHome, 'plugins', 'cache'),
    path.join(codexHome, '.tmp', 'plugins'),
  ];
  const roots = [];
  const visit = (dir, depth = 0) => {
    if (!dir || depth > 7 || !fs.existsSync(dir)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['node_modules', '.git', 'tmp', 'temp'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'skills') {
        uniquePush(roots, full);
        continue;
      }
      visit(full, depth + 1);
    }
  };
  bases.forEach((base) => visit(base, 0));
  return roots;
}

function defaultSkillRoots(workspaceDir, env = process.env) {
  const roots = [];
  const home = String(env.USERPROFILE || env.HOME || os.homedir()).trim() || os.homedir();
  const envHome = String(env.CODEX_HOME || path.join(home, '.codex')).trim();
  uniquePush(roots, path.join(envHome, 'skills'));
  uniquePush(roots, path.join(envHome, 'skills', '.system'));
  for (const root of collectPluginSkillRoots(envHome)) uniquePush(roots, root);
  uniquePush(roots, path.join(home, '.agents', 'skills'));
  uniquePush(roots, path.join(config.BASE_DIR, '.agents', 'skills'));
  if (workspaceDir) uniquePush(roots, path.join(workspaceDir, '.agents', 'skills'));
  return roots;
}

function listCodexSkills(options = {}) {
  const workspaceDir = options.workspaceDir || '';
  const env = options.env || process.env;
  const roots = Array.isArray(options.roots) && options.roots.length > 0
    ? [...options.roots, ...(workspaceDir ? [path.join(workspaceDir, '.agents', 'skills')] : [])]
    : defaultSkillRoots(workspaceDir, env);
  const out = [];
  const seen = new Set();

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const scope = workspaceDir && path.resolve(root).startsWith(path.resolve(workspaceDir))
      ? 'project'
      : 'global';
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(root, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const raw = fs.readFileSync(skillPath, 'utf8');
      const front = parseFrontmatter(raw);
      const summary = skillSummaryFromMarkdown(raw);
      const name = safeSegment(front.name || entry.name, entry.name);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({
        id: `${scope}:${name}`,
        name,
        description: String(summary.description || '').replace(/\s+/g, ' ').slice(0, 240),
        category: String(summary.category || '').trim(),
        body: scope === 'project' ? skillBodyFromMarkdown(raw) : undefined,
        scope,
        path: skillPath,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function projectSkillDir(workspaceDir, name) {
  const workspaceRoot = path.resolve(workspaceDir || '');
  const safeName = safeSegment(name, 'creator-skill');
  const dir = path.resolve(path.join(workspaceRoot, '.agents', 'skills', safeName));
  if (!workspaceRoot || !dir.startsWith(workspaceRoot)) throw new Error('Skill 路径越界');
  return { workspaceRoot, safeName, dir, skillPath: path.join(dir, 'SKILL.md') };
}

function createProjectSkill(options = {}) {
  const workspaceDir = path.resolve(options.workspaceDir || createCodexWorkspace(options).dir);
  const rawName = String(options.name || '').trim();
  const name = safeSegment(rawName, 'creator-skill');
  const title = String(options.title || rawName || name).trim();
  const description = String(options.description || '创作者自定义 Codex Skill。').trim();
  const category = String(options.category || '未分类').trim() || '未分类';
  const body = String(options.body || '').trim();
  const { dir, skillPath } = projectSkillDir(workspaceDir, name);
  ensureDir(dir);
  const content = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `category: ${category}`,
    '---',
    '',
    `# ${title}`,
    '',
    body || [
      '## 用途',
      description,
      '',
      '## 工作方式',
      '- 先理解创作目标、平台、受众和参考素材。',
      '- 输出可直接复制到图像/视频模型的提示词。',
      '- 给出 2-4 个风格变体和明确的二次修改建议。',
    ].join('\n'),
    '',
  ].join('\n');
  fs.writeFileSync(skillPath, content, 'utf8');
  return {
    id: `project:${name}`,
    name,
    title,
    description,
    category,
    body: body || [
      '## 用途',
      description,
      '',
      '## 工作方式',
      '- 先理解创作目标、平台、受众和参考素材。',
      '- 输出可直接复制到图像/视频模型的提示词。',
      '- 给出 2-4 个风格变体和明确的二次修改建议。',
    ].join('\n'),
    scope: 'project',
    path: skillPath,
  };
}

function updateProjectSkill(options = {}) {
  const workspaceDir = path.resolve(options.workspaceDir || '');
  const oldName = safeSegment(options.oldName || options.name, 'creator-skill');
  const nextName = safeSegment(options.name || oldName, oldName);
  const oldSkill = projectSkillDir(workspaceDir, oldName);
  const nextSkill = projectSkillDir(workspaceDir, nextName);
  if (!fs.existsSync(oldSkill.skillPath)) throw new Error(`项目 Skill 不存在：${oldName}`);
  if (oldName !== nextName && fs.existsSync(nextSkill.dir)) throw new Error(`项目 Skill 已存在：${nextName}`);
  const skill = createProjectSkill({
    ...options,
    workspaceDir,
    name: nextName,
  });
  if (oldName !== nextName && fs.existsSync(oldSkill.dir)) {
    fs.rmSync(oldSkill.dir, { recursive: true, force: true });
  }
  return skill;
}

function deleteProjectSkill(options = {}) {
  const workspaceDir = path.resolve(options.workspaceDir || '');
  const name = safeSegment(options.name, 'creator-skill');
  const { dir, safeName } = projectSkillDir(workspaceDir, name);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return {
    deleted: true,
    name: safeName,
    workspaceDir,
  };
}

function makeCreatorPrompt(body = {}) {
  const prompt = String(body.prompt || body.text || '').trim();
  const preset = String(body.preset || '').trim();
  const selectedSkillNames = Array.isArray(body.selectedSkillNames)
    ? body.selectedSkillNames.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const selectedSkillText = selectedSkillNames.join(' ');
  const imageGenerationIntent = body.llmOnly === true
    ? false
    : body.imageGeneration === true
      || /(^|[\s$:/_-])(imagegen|imagen|image-generation|image_generation|generate-image|图片生成|图像生成)([\s$:/_-]|$)/i.test(selectedSkillText)
      || body.mode === 'image';
  const instructions = [];
  instructions.push('你是 T8 画布中的 Codex 创作者 Agent，优先服务图像、视频、文案、分镜、提示词和创作质检。');
  instructions.push('除非用户明确要求写代码，否则输出面向创作交付：清晰的提示词、分镜、改稿建议、可执行步骤和素材使用说明。');
  if (selectedSkillNames.length > 0) {
    instructions.push(`请优先调用这些 Skill：${selectedSkillNames.map((name) => `$${name}`).join(' ')}。`);
  }
  if (preset) instructions.push(`当前创作预设：${preset}。`);
  if (Array.isArray(body.referenceTexts) && body.referenceTexts.length > 0) {
    instructions.push(`上游文本素材：\n${body.referenceTexts.join('\n\n')}`);
  }
  const images = Array.isArray(body.images)
    ? body.images.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (images.length > 0) {
    const imageList = images
      .slice(0, 8)
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n');
    instructions.push([
      `参考图使用约束：已随命令附加 ${images.length} 张参考图，它们是本轮图像/改图任务的主要视觉依据。`,
      imageList ? `参考图列表：\n${imageList}` : '',
      '- 生成或改图时必须优先继承参考图的主体身份、构图关系、服装/发型/色彩/材质/光影等关键线索。',
      '- 除非用户明确要求彻底重绘风格，不要脱离参考图另起炉灶，不要生成与参考图无关的新角色或新画面。',
      '- 如果参考图读取失败，必须明确说明读取失败并退回可执行提示词，不要假装已经使用参考图。',
    ].filter(Boolean).join('\n'));
  }
  if (Array.isArray(body.videos) && body.videos.length > 0) {
    instructions.push(`已连接 ${body.videos.length} 个视频素材；如果不能直接读取视频，请先基于文件名和用户描述生成分镜/改稿方案。`);
  }
  if (Array.isArray(body.audios) && body.audios.length > 0) {
    instructions.push(`已连接 ${body.audios.length} 个音频素材；如果不能直接读取音频，请先基于文件名和用户描述生成声音/配音方案。`);
  }
  const presetHint = `${preset} ${body.mode || ''} ${body.command || ''}`;
  if (imageGenerationIntent || (/图像|image|商品图|product/i.test(presetHint) && body.llmOnly !== true)) {
    instructions.push('图像生成模式：如果当前 Codex CLI 提供 image_generation 工具，必须直接生成图片文件，并在最终回复中给出 Markdown 图片链接或本地文件路径；不要只输出提示词文本。只有在工具确实不可用时，才明确说明工具不可用并退回输出可投喂 Midjourney / Seedream / GPT Image 的完整提示词。');
  }
  instructions.push('如果生成了图片、视频、音频或文件，请在最终回复中用 Markdown 链接列出产物路径，方便画布自动收集。');
  instructions.push(`用户任务：\n${prompt || '请根据上游素材给出创作方案。'}`);
  return instructions.join('\n\n');
}

function sendSse(res, event, payload = {}) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, event, ...payload })}\n\n`);
}

async function runCodexExecStream(body = {}, handlers = {}) {
  const workspace = createCodexWorkspace(body);
  const images = resolveCodexInputImages(body.images, workspace);
  const prompt = makeCreatorPrompt({ ...body, images });
  const availableFeatures = await listCodexFeatures({
    executablePath: body.executablePath,
    timeoutMs: 8000,
  }).catch(() => []);
  const availableFeatureNames = normalizeAvailableFeatureNames(availableFeatures);
  if ((body.webSearch || body.search) && !availableFeatureNames.has('web_search')) {
    handlers.onProgress?.('当前 Codex CLI 未提供 web_search feature，已跳过 Web Search CLI 开关。', { type: 'feature.skipped', feature: 'web_search' });
  }
  if ((body.imageGeneration || body.generateImage) && !availableFeatureNames.has('image_generation')) {
    handlers.onProgress?.('当前 Codex CLI 未提供 image_generation feature，已要求 Codex 明确退回提示词方案。', { type: 'feature.skipped', feature: 'image_generation' });
  }
  const args = buildCodexExecArgs({
    ...body,
    prompt,
    images,
    includePlanTool: body.includePlanTool === true,
    imageGeneration: body.imageGeneration === true || body.generateImage === true,
    availableFeatures,
  });
  const startedAt = Date.now();

  const executeAttempt = (attemptArgs) => new Promise((resolve, reject) => {
    if (handlers.signal?.aborted) {
      reject(new Error('Codex 任务已停止'));
      return;
    }

    let child;
    let settled = false;
    let fullText = '';
    let stderrText = '';
    let stdoutBuffer = '';

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (handlers.signal && onAbort) handlers.signal.removeEventListener('abort', onAbort);
      fn(value);
    };

    const onAbort = () => {
      try { child?.kill(); } catch { /* ignore */ }
      settle(reject, new Error('Codex 任务已停止'));
    };

    try {
      child = spawnCodexProcess(attemptArgs, {
        executablePath: body.executablePath,
        cwd: workspace.dir,
        env: {
          T8_CODEX_WORKSPACE: workspace.dir,
          T8_CODEX_OUTPUT_DIR: workspace.outputDir,
        },
      });
    } catch (error) {
      settle(reject, new Error(`${CODEX_DISABLED_MESSAGE} ${error.message || error}`));
      return;
    }

    if (handlers.signal) handlers.signal.addEventListener('abort', onAbort, { once: true });

    if (child.__codexResolved?.fromWindowsApps) {
      handlers.onProgress?.('检测到 WindowsApps Codex 入口，建议使用 npm 安装的 codex.cmd 或在节点设置中填写真实路径。', { type: 'executable.warning' });
    }

    if (child.stdin) child.stdin.end(prompt);

    child.on('error', (error) => {
      settle(reject, new Error(`${CODEX_DISABLED_MESSAGE} ${error.message || error}`));
    });

    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
      let index = stdoutBuffer.indexOf('\n');
      while (index >= 0) {
        const line = stdoutBuffer.slice(0, index);
        stdoutBuffer = stdoutBuffer.slice(index + 1);
        const event = parseCodexJsonLine(line);
        if (event) {
          handlers.onRawEvent?.(event);
          const delta = extractTextDelta(event);
          if (delta) {
            fullText += delta;
            handlers.onDelta?.(delta, event);
          }
          const progressMessage = event?.type && !delta ? String(event.type) : '';
          if (shouldForwardCodexProgress(progressMessage, event)) handlers.onProgress?.(progressMessage, event);
        }
        index = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderrText += chunk.toString('utf8');
      const message = chunk.toString('utf8').trim();
      if (shouldForwardCodexStderr(message)) handlers.onProgress?.(message, { type: 'stderr', message });
    });

    child.on('close', (code) => {
      if (handlers.signal?.aborted) {
        settle(reject, new Error('Codex 任务已停止'));
        return;
      }
      if (stdoutBuffer.trim()) {
        const event = parseCodexJsonLine(stdoutBuffer);
        const delta = extractTextDelta(event);
        if (delta) {
          fullText += delta;
          handlers.onDelta?.(delta, event);
        }
      }
      if (code !== 0) {
        const partialArtifacts = collectCodexRunArtifacts(fullText, workspace, startedAt);
        const error = new Error(stderrText.trim() || `Codex CLI 退出码 ${code}`);
        error.partialText = fullText.trim();
        error.artifacts = partialArtifacts;
        error.workspace = workspace.dir;
        error.executable = child.__codexResolved?.executable;
        error.elapsedMs = Date.now() - startedAt;
        settle(reject, error);
        return;
      }
      const artifacts = collectCodexRunArtifacts(fullText, workspace, startedAt);
      settle(resolve, {
        text: fullText.trim(),
        reply: fullText.trim(),
        artifacts,
        workspace: workspace.dir,
        executable: child.__codexResolved?.executable,
        elapsedMs: Date.now() - startedAt,
        status: 'completed',
        progress: 100,
      });
    });
  });

  try {
    return await executeAttempt(args);
  } catch (error) {
    if (handlers.signal?.aborted) throw error;
    if (isUnknownFeatureFlagError(error?.message || '')) {
      const retryArgs = stripUnsupportedCodexEnableArgs(args, new Set());
      if (retryArgs.join('\u0000') !== args.join('\u0000')) {
        handlers.onProgress?.('当前 Codex CLI 不支持某个 feature flag，已移除 --enable 参数重试一次。', { type: 'feature.retry' });
        return await executeAttempt(retryArgs);
      }
    }
    throw error;
  }
}

async function probeCodexStatus(options = {}) {
  const version = await runCodexCommand(['--version'], {
    executablePath: options.executablePath,
    env: options.env,
    platform: options.platform,
    timeoutMs: options.timeoutMs || 15000,
  });
  if (version.code !== 0) {
    return {
      available: false,
      executable: version.executable || String(options.executablePath || defaultCodexExecutable()).trim() || 'codex',
      resolved: version.resolved,
      message: codexUnavailableMessage(version),
    };
  }

  const login = await runCodexCommand(['login', 'status'], {
    executablePath: options.executablePath,
    env: options.env,
    platform: options.platform,
    timeoutMs: options.timeoutMs || 15000,
  });
  const loginText = (login.stdout || login.stderr || '').trim();
  if (login.code !== 0) {
    return {
      available: false,
      executable: version.executable,
      resolved: version.resolved,
      version: version.stdout.trim(),
      authStatus: loginText,
      message: loginText || 'Codex CLI 已安装，但还没有登录。请点击“打开登录”或在终端运行 codex login。',
    };
  }

  const features = await listCodexFeatures({
    executablePath: options.executablePath,
    env: options.env,
    platform: options.platform,
    timeoutMs: 12000,
  }).catch(() => []);

  return {
    available: true,
    executable: version.executable,
    resolved: version.resolved,
    version: version.stdout.trim(),
    authStatus: loginText || 'Logged in',
    features,
    featureNames: features.map((feature) => feature.name),
    message: loginText ? `Codex CLI 可用：${loginText}` : 'Codex CLI 可用',
  };
}

module.exports = {
  CODEX_DISABLED_MESSAGE,
  CODEX_WINDOWS_APPS_MESSAGE,
  buildCodexExecArgs,
  parseCodexFeatureListForTests: parseCodexFeatureList,
  parseCodexJsonLine,
  extractTextDelta,
  shouldForwardCodexStderrForTests: shouldForwardCodexStderr,
  shouldForwardCodexProgressForTests: shouldForwardCodexProgress,
  extractArtifactsFromText,
  extractArtifactsFromWorkspaceForTests: extractArtifactsFromWorkspace,
  normalizeArtifactUrlForTests: normalizeArtifactUrl,
  resolveCodexInputImagesForTests: resolveCodexInputImages,
  resolveCodexExecutable,
  buildCodexLoginStartInvocation,
  startCodexLogin,
  listCodexSkills,
  createProjectSkill,
  updateProjectSkill,
  deleteProjectSkill,
  createCodexWorkspace,
  listCodexFeatures,
  makeCreatorPrompt,
  runCodexExecStream,
  probeCodexStatus,
  sendSse,
  stripUnsupportedCodexEnableArgsForTests: stripUnsupportedCodexEnableArgs,
  isUnknownFeatureFlagErrorForTests: isUnknownFeatureFlagError,
};
