const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CdpClient,
  assertPortAvailable,
  findFreePort,
  focusLauncherAndOpen,
  graphSnapshot,
  launch,
  pressKey,
  requestJson,
  sleep,
  stopProcess,
  waitForEvaluation,
  waitForHtml,
  waitForJson,
} = require('./verify-creator-agent-p4-ui.cjs');

const ROOT = path.resolve(__dirname, '..');
const SYSTEM_TEMP = path.resolve(process.env.TEMP || process.env.TMP || path.join(ROOT, '.tmp'));
const QA_PARENT = path.resolve(
  process.env.T8_CREATOR_AGENT_QA_PARENT || path.join(SYSTEM_TEMP, 't8-penguin-canvas-qa'),
);
const QA_ROOT = path.join(QA_PARENT, 'creator-agent-p4-electron');
const USER_DATA = path.join(QA_ROOT, 'user-data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'creator-agent-p4-electron');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const FRONTEND_PORT = 11422;
const BACKEND_PORT = 18766;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}/`;
const TIMEOUT_MS = 60_000;
const LAYOUT_ONLY = process.argv.includes('--layout-only');
const DARK_THEME = process.argv.includes('--dark');
const EMULATED_TOUCH = process.argv.includes('--touch');
const EMULATED_SETTINGS_FAILURE = process.argv.includes('--settings-failure');
const SCALE_ARGUMENT = process.argv.find((argument) => argument.startsWith('--scale='));
const DEVICE_SCALE_FACTOR = SCALE_ARGUMENT
  ? Number(SCALE_ARGUMENT.slice('--scale='.length))
  : 1;
assert.ok(
  DEVICE_SCALE_FACTOR === 1 || DEVICE_SCALE_FACTOR === 2,
  'Electron Creator 验收只允许 --scale=1 或 --scale=2',
);
const EVIDENCE_SUFFIX = DEVICE_SCALE_FACTOR === 1 && !DARK_THEME && !EMULATED_TOUCH && !EMULATED_SETTINGS_FAILURE
  ? ''
  : `-${DARK_THEME ? 'dark' : 'light'}-${Math.round(DEVICE_SCALE_FACTOR * 100)}pct${EMULATED_TOUCH ? '-touch' : ''}${EMULATED_SETTINGS_FAILURE ? '-settings-error' : ''}`;

function assertInside(parent, candidate, label) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝清理非 ${label} 目录: ${candidatePath}`);
  }
  return candidatePath;
}

function resetQaDirectories() {
  const qaRoot = assertInside(QA_PARENT, QA_ROOT, 'QA 临时');
  const artifactDir = assertInside(path.join(ROOT, 'artifacts'), ARTIFACT_DIR, 'QA 证据');
  fs.rmSync(qaRoot, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  [
    `layout-report${EVIDENCE_SUFFIX}.json`,
    `creator-agent-electron-toolbar-safe-area${EVIDENCE_SUFFIX}.png`,
    `creator-agent-electron-toolbar-overlap${EVIDENCE_SUFFIX}.png`,
    `toolbar-overlap${EVIDENCE_SUFFIX}.json`,
    `failure${EVIDENCE_SUFFIX}.json`,
  ].forEach((filename) => fs.rmSync(path.join(artifactDir, filename), { force: true }));
}

function normalizedPath(value) {
  return path.resolve(String(value || '')).toLowerCase();
}

async function waitForElectronPage(debugPort) {
  const targetList = await waitForJson(
    `http://127.0.0.1:${debugPort}/json/list`,
    (items) => Array.isArray(items) && items.some((item) => (
      item.type === 'page'
      && item.url.startsWith(FRONTEND_URL)
      && item.webSocketDebuggerUrl
    )),
    TIMEOUT_MS,
  );
  return targetList.find((item) => (
    item.type === 'page'
    && item.url.startsWith(FRONTEND_URL)
    && item.webSocketDebuggerUrl
  ));
}

async function captureScreenshot(cdp, filename) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  const target = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  return target;
}

async function dismissStartupPosterIfPresent(cdp, waitMs = 2_500) {
  // The poster intentionally waits for the canvas readiness gate, so it can
  // appear shortly after React's root is already populated. Poll for that
  // bounded delay instead of racing the delayed presentation effect.
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const dismissed = await cdp.evaluate(`(() => {
      const close = document.querySelector('.t8-startup-poster__close');
      if (!close) return false;
      close.click();
      return true;
    })()`);
    if (dismissed) {
      await waitForEvaluation(cdp, `!document.querySelector('[data-canvas-floating-ui="startup-poster-carousel"]')`);
      return true;
    }
    await sleep(100);
  }
  return false;
}

async function waitForProcessExit(child, timeoutMs = 20_000) {
  if (!child || child.exitCode != null || child.signalCode != null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    child.once('exit', onExit);
  });
}

async function touchLauncherAndOpen(cdp) {
  const point = await cdp.evaluate(`(() => {
    const button = document.querySelector('button[data-canvas-floating-ui="creator-agent-launcher"]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    window.__t8CreatorShellStartedAt = performance.now();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, 'Creator Agent 启动按钮缺少触控坐标');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const readiness = await waitForEvaluation(cdp, `(() => {
    const panel = document.querySelector('[data-canvas-floating-ui="creator-agent-panel"]');
    if (!panel || panel.dataset.shellReadinessStatus === 'pending-paint') return null;
    return {
      elapsedMs: performance.now() - Number(window.__t8CreatorShellStartedAt || 0),
      schema: panel.dataset.shellReadinessSchema || '',
      commitMs: Number(panel.dataset.shellCommitMs || 0),
      paintReadyMs: Number(panel.dataset.shellPaintReadyMs || 0),
      targetMs: Number(panel.dataset.shellTargetMs || 0),
      status: panel.dataset.shellReadinessStatus || '',
      surface: panel.classList.contains('is-loading-shell') ? 'fallback' : 'creator-v2',
    };
  })()`);
  assert.equal(readiness.schema, 't8-creator-agent-shell-readiness-receipt-v1');
  assert.equal(readiness.targetMs, 300);
  assert.equal(readiness.status, 'within-target');
  assert.ok(readiness.elapsedMs <= 300, `Creator Agent 触控打开耗时超标: ${readiness.elapsedMs}ms`);
  return readiness;
}

async function run() {
  assert.equal(fs.existsSync(ELECTRON), true, '缺少项目锁定的 Electron 可执行文件');
  await assertPortAvailable(BACKEND_PORT);
  await assertPortAvailable(FRONTEND_PORT);
  resetQaDirectories();

  const debugPort = await findFreePort();
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const vite = launch(process.execPath, [
    path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(FRONTEND_PORT),
    '--strictPort',
  ], {
    env: {
      ...process.env,
      T8_FIGMA_BRIDGE_AUTOSTART: '0',
      TEMP: SYSTEM_TEMP,
      TMP: SYSTEM_TEMP,
    },
  });
  let electron = null;
  let cdp = null;
  let requestedGracefulClose = false;

  try {
    await waitForHtml(FRONTEND_URL);
    electron = launch(ELECTRON, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${USER_DATA}`,
      '--remote-allow-origins=*',
      `--force-device-scale-factor=${DEVICE_SCALE_FACTOR}`,
      path.join(ROOT, 'electron', 'main.cjs'),
    ], {
      env: {
        ...electronEnv,
        NODE_ENV: 'development',
        T8PC_PACKAGED: '0',
        T8PC_DEV_SERVER_URL: FRONTEND_URL,
        T8PC_DEV_DATA_ROOT: USER_DATA,
        T8_FIGMA_BRIDGE_AUTOSTART: '0',
        TEMP: QA_ROOT,
        TMP: QA_ROOT,
      },
    });

    const page = await waitForElectronPage(debugPort);
    assert.ok(page?.webSocketDebuggerUrl, '没有找到 Electron 主窗口调试目标');
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();

    const browserErrors = [];
    cdp.onEvent((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        browserErrors.push(
          message.params?.exceptionDetails?.exception?.description
          || message.params?.exceptionDetails?.text
          || 'runtime exception',
        );
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        browserErrors.push(message.params.entry.text || 'console error');
      }
    });
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Log.enable'),
      cdp.send('Network.enable'),
      cdp.send('Accessibility.enable'),
    ]);
    if (EMULATED_TOUCH) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await cdp.send('Page.bringToFront');
    // The trusted preload is already present on the lightweight startup shell.
    // Waiting for it alone lets the test navigate while Electron's initial
    // loadURL() is still in flight, which aborts the real renderer load and can
    // incorrectly trip the startup failure deadline.  Require the actual
    // canvas renderer shell before the test creates a canvas and performs its
    // first reload. The Creator launcher and canvas-create control may both be
    // absent while the restored catalog decides its initial empty state; the
    // populated React root on the real Vite URL is the stable shell boundary.
    await waitForEvaluation(cdp, `location.href.startsWith(${JSON.stringify(FRONTEND_URL)})
      && Boolean(window.t8pc?.getInfo)
      && document.readyState === 'complete'
      && Boolean(document.querySelector('#root')?.childElementCount)`);
    await dismissStartupPosterIfPresent(cdp);

    const electronInfo = await cdp.evaluate(`window.t8pc.getInfo()`);
    assert.equal(electronInfo.packaged, false, 'Electron 开发窗口被误标为 packaged');
    assert.equal(electronInfo.backendPort, BACKEND_PORT, 'Electron 没有使用预期的隔离后端端口');
    assert.equal(electronInfo.version, require(path.join(ROOT, 'package.json')).version);
    assert.equal(
      normalizedPath(electronInfo.userData).startsWith(normalizedPath(USER_DATA)),
      true,
      `Electron userData 未隔离到 QA 目录: ${electronInfo.userData}`,
    );

    const backendUrl = `http://127.0.0.1:${electronInfo.backendPort}`;
    await waitForJson(`${backendUrl}/api/status`, (payload) => payload?.ok === true);
    const created = await requestJson(`${backendUrl}/api/canvas`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Creator Agent P4 Electron QA' }),
    });
    const canvasId = created.data.id;
    const projectId = 'project-local';
    const before = (await requestJson(`${backendUrl}/api/canvas/${encodeURIComponent(canvasId)}`)).data;
    const beforeRevision = before.revision;
    const beforeGraph = graphSnapshot(before);

    await cdp.evaluate(`localStorage.setItem('t8-canvas-active-id-v1', ${JSON.stringify(canvasId)}); true`);
    const firstTimeOrigin = await cdp.evaluate('performance.timeOrigin');
    await cdp.send('Page.navigate', { url: FRONTEND_URL });
    await waitForEvaluation(cdp, `performance.timeOrigin !== ${Number(firstTimeOrigin)}
      && Boolean(window.t8pc?.getInfo)
      && document.readyState === 'complete'
      && Boolean(document.querySelector('#root')?.childElementCount)`);
    await waitForEvaluation(cdp, `Boolean(document.querySelector('[data-canvas-floating-ui="creator-agent-launcher"]'))`);
    await dismissStartupPosterIfPresent(cdp);

    const runtimeIdentity = await cdp.evaluate(`(() => ({
      title: document.title,
      userAgent: navigator.userAgent,
      hasNodeRequire: typeof window.require !== 'undefined',
      hasProcess: typeof window.process !== 'undefined',
      hasTrustedPreload: Boolean(window.t8pc?.agentControl?.getConnectionSummary),
    }))()`);
    assert.match(runtimeIdentity.userAgent, /Electron\//, '主窗口不是 Electron renderer');
    assert.equal(runtimeIdentity.hasNodeRequire, false, 'renderer 暴露了 Node require');
    assert.equal(runtimeIdentity.hasProcess, false, 'renderer 暴露了 Node process');
    assert.equal(runtimeIdentity.hasTrustedPreload, true, '可信 preload API 缺失');

    const connectionSummary = await cdp.evaluate(`window.t8pc.agentControl.getConnectionSummary()`);
    assert.equal(connectionSummary.success, true, 'Electron Agent Control IPC 摘要不可用');
    assert.equal(
      JSON.stringify(connectionSummary).toLowerCase().includes('token'),
      false,
      'Electron Agent Control 公开摘要泄露 token 字段',
    );
    const updater = await cdp.evaluate(`window.t8pc.updater.getStatus()`);
    assert.equal(updater.packaged, false);
    assert.equal(updater.status, 'disabled');
    assert.match(String(updater.message || ''), /开发模式/);

    if (EMULATED_SETTINGS_FAILURE) {
      await cdp.send('Network.setBlockedURLs', {
        urls: ['*api/creator-agent/v2/settings*'],
      });
    }

    if (DARK_THEME) {
      const switchedTheme = await cdp.evaluate(`(() => {
        if (document.documentElement.getAttribute('data-theme-mode') === 'dark') return true;
        const button = [...document.querySelectorAll('button')].find((item) => (
          item.getAttribute('title') === '切换到深色主题'
          || item.getAttribute('title') === 'Switch to dark theme'
        ));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      assert.equal(switchedTheme, true, '找不到真实主题切换按钮');
      await waitForEvaluation(cdp, `document.documentElement.getAttribute('data-theme-mode') === 'dark'`);
    }

    const shellReadiness = EMULATED_TOUCH
      ? await touchLauncherAndOpen(cdp)
      : await focusLauncherAndOpen(cdp);
    await waitForEvaluation(cdp, `(() => {
      const panel = document.querySelector('[data-canvas-floating-ui="creator-agent-panel"]');
      return Boolean(panel && !panel.classList.contains('is-loading-shell'));
    })()`);
    const creatorV2ReadyElapsedMs = await cdp.evaluate(
      `performance.now() - Number(window.__t8CreatorShellStartedAt || performance.now())`,
    );
    const layout = await waitForEvaluation(cdp, `(() => {
      const toolbar = document.querySelector('.t8-canvas-toolbar');
      const panel = document.querySelector('[data-canvas-floating-ui="creator-agent-panel"]');
      const topbarActions = document.querySelector('.t8-topbar-actions');
      if (!toolbar || !panel || !topbarActions) return null;
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom,
          width: value.width, height: value.height };
      };
      const touchTargets = [...panel.querySelectorAll('button')]
        .map((element) => ({ ...rect(element), name: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim() }))
        .filter((value) => value.width > 0 && value.height > 0);
      const topbarActionsRect = rect(topbarActions);
      const visibleTopbarActions = [...topbarActions.children]
        .map((element) => ({ ...rect(element), name: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim() }))
        .filter((value) => value.width > 0 && value.height > 0);
      const clippedTopbarActions = visibleTopbarActions.filter((value) => (
        value.left < Math.max(0, topbarActionsRect.left)
        || value.right > Math.min(innerWidth, topbarActionsRect.right)
      ));
      return { toolbar: rect(toolbar), panel: rect(panel),
        firstScreen: panel.classList.contains('is-first-screen'),
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio,
        themeMode: document.documentElement.getAttribute('data-theme-mode'),
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        topbarActions: topbarActionsRect,
        visibleTopbarActionCount: visibleTopbarActions.length,
        clippedTopbarActionCount: clippedTopbarActions.length,
        clippedTopbarActions,
        touchTargets };
    })()`);
    const overlapsToolbar = !(
      layout.panel.right <= layout.toolbar.left
      || layout.panel.left >= layout.toolbar.right
      || layout.panel.bottom <= layout.toolbar.top
      || layout.panel.top >= layout.toolbar.bottom
    );
    if (overlapsToolbar) {
      const screenshot = await captureScreenshot(cdp, `creator-agent-electron-toolbar-overlap${EVIDENCE_SUFFIX}.png`);
      const overlapEvidence = { layout, overlapsToolbar, shellReadiness, screenshot };
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, `toolbar-overlap${EVIDENCE_SUFFIX}.json`),
        `${JSON.stringify(overlapEvidence, null, 2)}\n`,
        'utf8',
      );
      process.stderr.write(`[creator-layout] ${JSON.stringify(overlapEvidence)}\n`);
    }
    assert.equal(overlapsToolbar, false, 'Creator Agent 面板遮挡了画布顶部控制条');
    assert.ok(layout.panel.top >= 60, `Creator Agent 顶部安全区不足: ${layout.panel.top}px`);
    assert.ok(layout.panel.bottom <= layout.viewport.height - 10,
      `Creator Agent 底部没有收紧: ${layout.panel.bottom}/${layout.viewport.height}px`);
    assert.equal(layout.horizontalOverflow, false, 'Creator Agent 或画布在当前缩放下产生横向溢出');
    assert.ok(layout.visibleTopbarActionCount > 0, '顶部动作区没有可见操作');
    if (layout.clippedTopbarActionCount) {
      process.stderr.write(`[creator-topbar-clipped] ${JSON.stringify(layout.clippedTopbarActions)}\n`);
    }
    assert.equal(layout.clippedTopbarActionCount, 0, '顶部动作在当前缩放下被裁切');
    assert.equal(layout.devicePixelRatio, DEVICE_SCALE_FACTOR, 'Electron 没有应用要求的设备缩放');
    assert.equal(layout.themeMode, DARK_THEME ? 'dark' : 'light', 'Creator Agent 主题状态不符合验收模式');
    assert.equal(layout.firstScreen, true, '首次空白创作界面没有使用紧凑高度');
    assert.ok(layout.panel.height <= 500.5, `首次空白创作界面超过 500px: ${layout.panel.height}px`);
    if (EMULATED_TOUCH) {
      assert.ok(layout.touchTargets.length >= 8, `Creator Agent V2 可见触控目标不足: ${layout.touchTargets.length}`);
      assert.equal(
        layout.touchTargets.every((target) => target.width >= 44 && target.height >= 44),
        true,
        'Creator Agent 在触控媒体查询下存在小于 44px 的按钮',
      );
    }

    if (LAYOUT_ONLY) {
      await waitForEvaluation(cdp, `Boolean(document.querySelector('.t8-creator-v2-readiness'))`);
      if (EMULATED_SETTINGS_FAILURE) {
        await waitForEvaluation(cdp, `(() => {
          const readiness = document.querySelector('.t8-creator-v2-readiness');
          return Boolean(readiness
            && /创作模型暂时没有连上|Could not reach the creative model/u.test(readiness.textContent || '')
            && /重新读取|Try again/u.test(readiness.querySelector('button')?.textContent || ''));
        })()`);
      }
      await dismissStartupPosterIfPresent(cdp);
      const accessibilityTree = await cdp.send('Accessibility.getFullAXTree');
      const accessibleDialog = (accessibilityTree.nodes || []).find((node) => (
        node.role?.value === 'dialog'
        && /创作助手|Creator Agent/.test(String(node.name?.value || ''))
      ));
      assert.ok(accessibleDialog, '无障碍树中缺少具名 Creator Agent dialog');
      const expectedAccessibleControls = [
        /历史|History/u,
        /新对话|New conversation/u,
        /生成设置|Generation settings/u,
        /收起创作助手|Minimize Creator Agent/u,
        /关闭|Close/u,
        /描述你想做的作品|Describe what you want to make/u,
        /添加附件|Add attachment/u,
        /画布|canvas/iu,
      ];
      const accessibleControls = (accessibilityTree.nodes || [])
        .filter((node) => !node.ignored && ['button', 'textbox'].includes(String(node.role?.value || '')))
        .map((node) => ({ role: node.role.value, name: String(node.name?.value || '') }))
        .filter((node) => node.name && expectedAccessibleControls.some((pattern) => pattern.test(node.name)));
      expectedAccessibleControls.forEach((pattern) => assert.ok(
        accessibleControls.some((control) => pattern.test(control.name)),
        `无障碍树中缺少具名控件: ${pattern}`,
      ));
      const keyboardFocusOrder = [];
      assert.equal(await cdp.evaluate(`(() => {
        const first = document.querySelector('.t8-creator-v2-header nav button');
        first?.focus();
        return document.activeElement === first;
      })()`), true, 'Creator Agent 首个头部按钮无法取得焦点');
      for (let index = 0; index < 8; index += 1) {
        keyboardFocusOrder.push(await cdp.evaluate(`(() => {
          const element = document.activeElement;
          return element?.getAttribute?.('aria-label') || element?.getAttribute?.('title') || element?.textContent?.trim() || '';
        })()`));
        await pressKey(cdp, 'Tab');
      }
      assert.equal(new Set(keyboardFocusOrder.filter(Boolean)).size, keyboardFocusOrder.filter(Boolean).length,
        'Creator Agent 首屏键盘焦点顺序出现重复或卡住');
      const screenshot = await captureScreenshot(
        cdp,
        `creator-agent-electron-toolbar-safe-area${EVIDENCE_SUFFIX}.png`,
      );
      assert.equal(
        await cdp.evaluate(`Boolean(document.querySelector('.t8-creator-v2-readiness'))`),
        true,
        '隔离的未配置环境没有给出明确 API 配置引导',
      );
      assert.equal(
        await cdp.evaluate(`Boolean(document.querySelector('.t8-creator-v2-composer button.is-send:disabled'))`),
        true,
        '未配置真实 LLM 时发送按钮不应可用',
      );
      const report = {
        schema: 't8-creator-agent-layout-electron-acceptance-v1',
        scope: 'development-electron-layout-no-provider',
        runtime: {
          executable: ELECTRON,
          packaged: electronInfo.packaged,
          version: electronInfo.version,
          backendPort: electronInfo.backendPort,
          isolatedUserData: true,
          contextIsolation: runtimeIdentity.hasNodeRequire === false && runtimeIdentity.hasProcess === false,
          trustedPreload: runtimeIdentity.hasTrustedPreload,
          deviceScaleFactor: DEVICE_SCALE_FACTOR,
        },
        shellReadiness,
        creatorV2ReadyElapsedMs,
        layout: { ...layout, overlapsToolbar },
        accessibility: {
          dialogRole: accessibleDialog.role.value,
          dialogName: accessibleDialog.name.value,
          ignored: Boolean(accessibleDialog.ignored),
          controls: accessibleControls,
          keyboardFocusOrder,
        },
        theme: DARK_THEME ? 'dark' : 'light',
        inputMode: EMULATED_TOUCH ? 'emulated-touch' : 'keyboard',
        settingsFailureEmulated: EMULATED_SETTINGS_FAILURE,
        configuredModelRequired: true,
        browserErrors,
        screenshots: [screenshot],
      };
      await sleep(500);
      assert.deepEqual(browserErrors, [], `Electron renderer 出现错误: ${browserErrors.join('\n')}`);
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, `layout-report${EVIDENCE_SUFFIX}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      requestedGracefulClose = true;
      await cdp.evaluate(`window.close(); true`);
      cdp.close();
      cdp = null;
      assert.equal(await waitForProcessExit(electron.child), true, 'Electron 布局验收后没有完成后端收尾');
      return;
    }

    await waitForEvaluation(cdp, `document.querySelectorAll('.t8-creator-v2-suggestions button').length === 3`);
    const sessionKey = `t8-creator-agent-session-v1:${projectId}:${canvasId}`;
    const sessionId = await waitForEvaluation(cdp, `localStorage.getItem(${JSON.stringify(sessionKey)}) || ''`);

    const drafted = await cdp.evaluate(`(() => {
      const textarea = document.querySelector('.t8-creator-agent-composer textarea');
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, '帮我做一支12秒森林奇遇短片');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    assert.equal(drafted, true, 'Electron Creator Agent 输入框尚未就绪');
    await waitForEvaluation(cdp, `(() => {
      const button = document.querySelector('.t8-creator-agent-composer button[aria-label="发送"]');
      return button && !button.disabled;
    })()`);
    const sent = await cdp.evaluate(`(() => {
      const button = document.querySelector('.t8-creator-agent-composer button[aria-label="发送"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    assert.equal(sent, true, 'Electron Creator Agent 无法发送一句话需求');
    await waitForEvaluation(cdp, `(() => {
      const userMessage = [...document.querySelectorAll('.t8-creator-agent-message.is-user')]
        .some((item) => item.textContent.includes('帮我做一支12秒森林奇遇短片'));
      return userMessage && document.querySelectorAll('.t8-creator-agent-suggestions button').length === 3;
    })()`);

    const separatorFocused = await cdp.evaluate(`(() => {
      const separator = document.querySelector('.t8-creator-agent-resize-handle');
      if (!separator) return false;
      separator.focus();
      return document.activeElement === separator;
    })()`);
    assert.equal(separatorFocused, true);
    const widthBefore = await cdp.evaluate(
      `document.querySelector('[data-canvas-floating-ui="creator-agent-panel"]').getBoundingClientRect().width`,
    );
    await pressKey(cdp, 'ArrowLeft');
    const widthAfter = await waitForEvaluation(cdp, `(() => {
      const width = document.querySelector('[data-canvas-floating-ui="creator-agent-panel"]')
        ?.getBoundingClientRect().width || 0;
      return width > ${Number(widthBefore)} ? width : 0;
    })()`);
    assert.ok(widthAfter <= 560);

    const screenshot = await captureScreenshot(cdp, 'creator-agent-electron-one-sentence.png');
    await pressKey(cdp, 'Escape');
    await waitForEvaluation(cdp, `(() => {
      const launcher = document.querySelector('[data-canvas-floating-ui="creator-agent-launcher"]');
      return !document.querySelector('[data-canvas-floating-ui="creator-agent-panel"]')
        && document.activeElement === launcher;
    })()`);

    const reloadTimeOrigin = await cdp.evaluate('performance.timeOrigin');
    await cdp.send('Page.navigate', { url: FRONTEND_URL });
    await waitForEvaluation(cdp, `performance.timeOrigin !== ${Number(reloadTimeOrigin)}
      && Boolean(window.t8pc?.getInfo)
      && Boolean(document.querySelector('[data-canvas-floating-ui="creator-agent-launcher"]'))`);
    await dismissStartupPosterIfPresent(cdp);
    await focusLauncherAndOpen(cdp);
    await waitForEvaluation(cdp, `(() => [...document.querySelectorAll('.t8-creator-agent-message.is-user')]
      .some((item) => item.textContent.includes('帮我做一支12秒森林奇遇短片')))()`);
    assert.equal(
      await cdp.evaluate(`localStorage.getItem(${JSON.stringify(sessionKey)}) || ''`),
      sessionId,
      'Electron 刷新后 Creator Session 被替换',
    );

    const sessions = await requestJson(
      `${backendUrl}/api/creator-agent/v1/sessions?projectId=${encodeURIComponent(projectId)}&canvasId=${encodeURIComponent(canvasId)}&limit=20`,
    );
    assert.equal(sessions.data.sessions.length, 1, 'Electron 一次对话与刷新产生重复 Session');
    assert.equal(sessions.data.sessions[0].id, sessionId);

    const after = (await requestJson(`${backendUrl}/api/canvas/${encodeURIComponent(canvasId)}`)).data;
    assert.equal(after.revision, beforeRevision, 'Electron 只读对话修改了画布 revision');
    assert.equal(graphSnapshot(after), beforeGraph, 'Electron 只读对话污染画布文档');
    await sleep(500);
    assert.deepEqual(browserErrors, [], `Electron renderer 出现错误: ${browserErrors.join('\n')}`);

    const report = {
      schema: 't8-creator-agent-p4-electron-acceptance-v1',
      scope: 'development-electron-no-provider',
      runtime: {
        executable: ELECTRON,
        packaged: electronInfo.packaged,
        version: electronInfo.version,
        backendPort: electronInfo.backendPort,
        isolatedUserData: true,
        userAgent: runtimeIdentity.userAgent,
        contextIsolation: runtimeIdentity.hasNodeRequire === false && runtimeIdentity.hasProcess === false,
        trustedPreload: runtimeIdentity.hasTrustedPreload,
        updaterDisabledInDevelopment: updater.status === 'disabled',
      },
      canvasId,
      projectId,
      oneSentenceFlow: {
        prompt: '帮我做一支12秒森林奇遇短片',
        sessionId,
        sessionCountAfterReload: sessions.data.sessions.length,
        restoredAfterReload: true,
        suggestionCount: 3,
      },
      keyboard: {
        launcherOpenedWithEnter: true,
        panelResizedWithArrowKey: true,
        escapeClosedPanel: true,
        focusReturnedToLauncher: true,
      },
      agentControlSummaryAvailable: connectionSummary.success === true,
      canvasRevision: {
        before: beforeRevision,
        after: after.revision,
        unchanged: true,
      },
      browserErrors,
      screenshots: [screenshot],
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    requestedGracefulClose = true;
    await cdp.evaluate(`window.close(); true`);
    cdp.close();
    cdp = null;
    assert.equal(
      await waitForProcessExit(electron.child),
      true,
      'Electron 窗口关闭后没有在有界时间内完成后端收尾',
    );
  } catch (error) {
    const diagnostics = {
      error: error?.stack || String(error),
      viteLogs: vite.logs,
      electronLogs: electron?.logs || [],
    };
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, `failure${EVIDENCE_SUFFIX}.json`), `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    cdp?.close();
    if (!requestedGracefulClose || electron?.child.exitCode == null) stopProcess(electron?.child);
    stopProcess(vite.child);
  }
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
