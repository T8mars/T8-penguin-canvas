const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const ELECTRON = require('electron');

const ROOT = path.resolve(__dirname, '..');
const TEMP_ROOT = path.resolve(process.env.TEMP || process.env.TMP || path.join(ROOT, '.tmp'));
const QA_ROOT = path.join(TEMP_ROOT, 't8-canvas-startup-feedback-ui');
const USER_DATA = path.join(QA_ROOT, 'user-data');
const CHROME_PROFILE = path.join(QA_ROOT, 'chrome-profile');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'canvas-startup-feedback-ui');
const APP_VERSION = require('../package.json').version;
const TIMEOUT_MS = 90_000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertOwnedTemporaryPath(candidate) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(TEMP_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean a non-QA temporary directory: ${resolved}`);
  }
  return resolved;
}

function resetQaDirectory() {
  fs.rmSync(assertOwnedTemporaryPath(QA_ROOT), { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(CHROME_PROFILE, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function cleanupQaDirectory() {
  fs.rmSync(assertOwnedTemporaryPath(QA_ROOT), { recursive: true, force: true });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome or Edge executable was not found');
  return executable;
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function boundedLog(lines, value) {
  for (const line of String(value || '').replace(/\r/g, '').split('\n')) {
    if (!line) continue;
    lines.push(line.slice(0, 1_000));
    if (lines.length > 200) lines.shift();
  }
}

function launch(command, args, options = {}) {
  const logs = [];
  const child = spawn(command, args, {
    cwd: ROOT,
    env: options.env || process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => boundedLog(logs, chunk));
  child.stderr?.on('data', (chunk) => boundedLog(logs, chunk));
  return { child, logs };
}

function stopProcess(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  } else child.kill('SIGTERM');
}

async function waitForJson(url, predicate = () => true, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        if (predicate(value)) return value;
      } else lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function waitForHttp(url, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 10_000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP is unavailable for ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page evaluation failed');
    }
    return result.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch (_) {}
  }
}

async function waitForEvaluation(cdp, expression, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await cdp.evaluate(expression);
    if (lastValue) return lastValue;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for page condition: ${expression.slice(0, 180)}; last=${JSON.stringify(lastValue)}`);
}

async function captureScreenshot(cdp, filename) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const target = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  return target;
}

async function run() {
  resetQaDirectory();
  const backendPort = await findFreePort();
  let frontendPort = await findFreePort();
  while (frontendPort === backendPort) frontendPort = await findFreePort();
  const debugPort = await findFreePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const vite = launch(process.execPath, [
    path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--config', path.join(ROOT, 'vite.config.ts'),
    '--host', '127.0.0.1',
    '--port', String(frontendPort),
    '--strictPort',
  ], {
    env: { ...process.env, T8PC_DEV_BACKEND_ORIGIN: backendUrl, T8_FIGMA_BRIDGE_AUTOSTART: '0', TEMP: TEMP_ROOT, TMP: TEMP_ROOT },
  });
  let backend = null;
  let chrome = null;
  let cdp = null;
  try {
    await waitForHttp(`${frontendUrl}/`);
    chrome = launch(findChrome(), [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${CHROME_PROFILE}`,
      '--headless=new',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      '--window-size=1440,900',
      'about:blank',
    ]);
    const targets = await waitForJson(
      `http://127.0.0.1:${debugPort}/json/list`,
      (items) => Array.isArray(items) && items.some((item) => item.type === 'page' && item.webSocketDebuggerUrl),
    );
    const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    const browserErrors = [];
    cdp.onEvent((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        browserErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'runtime exception');
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        const entry = message.params.entry;
        if (!String(entry.url || '').includes('/api/')) browserErrors.push(entry.text || 'console error');
      }
    });
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Log.enable'),
      cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }),
    ]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const now = Date.now();
        localStorage.setItem('t8.startup-poster.suppression.v1', JSON.stringify({
          schema: 't8-startup-poster-suppression-v1',
          appVersion: ${JSON.stringify(APP_VERSION)},
          campaignId: 'free-online-canvas-2026-09',
          suppressedAt: now,
          suppressUntil: now + 604800000,
        }));
        window.__T8_CANVAS_STARTUP_STAGES__ = [];
        let lastStage = '';
        const sample = () => {
          const stage = document.querySelector('[data-canvas-startup-stage]')?.getAttribute('data-canvas-startup-stage') || '';
          if (stage && stage !== lastStage) {
            lastStage = stage;
            window.__T8_CANVAS_STARTUP_STAGES__.push(stage);
          }
        };
        new MutationObserver(sample).observe(document, { childList: true, subtree: true, attributes: true });
        setInterval(sample, 50);
      })();`,
    });
    await cdp.send('Page.navigate', { url: frontendUrl });

    const disconnected = await waitForEvaluation(cdp, `(() => {
      const root = document.querySelector('[data-canvas-startup-stage="backend-error"]');
      const card = document.querySelector('.t8-canvas-startup-card');
      if (!root || !card) return null;
      return {
        stage: root.dataset.canvasStartupStage,
        steps: [...card.querySelectorAll('.t8-canvas-startup-step')].map((node) => node.textContent.trim()),
        lockedNodes: [...document.querySelectorAll('.t8-sidebar-node')].filter((node) => node.getAttribute('aria-disabled') === 'true').length,
        totalNodes: document.querySelectorAll('.t8-sidebar-node').length,
        prematureEmpty: document.body.innerText.includes('还没有画布'),
      };
    })()`);
    assert.equal(disconnected.steps.length, 4);
    assert.equal(disconnected.lockedNodes, disconnected.totalNodes);
    assert.equal(disconnected.prematureEmpty, false);
    const disconnectedScreenshot = await captureScreenshot(cdp, 'backend-not-ready.png');

    backend = launch(ELECTRON, [path.join(ROOT, 'backend', 'src', 'server.js')], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOST: '127.0.0.1',
        PORT: String(backendPort),
        NODE_ENV: 'development',
        T8PC_PACKAGED: '0',
        T8PC_DEV_DATA_ROOT: USER_DATA,
        T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1',
        T8_COLLAB_MANAGEMENT_TOKEN: crypto.randomBytes(32).toString('base64url'),
        T8PC_RES: ROOT,
        T8_FIGMA_BRIDGE_AUTOSTART: '0',
        TEMP: TEMP_ROOT,
        TMP: TEMP_ROOT,
      },
    });
    await waitForJson(`${backendUrl}/api/status`, (payload) => payload?.ok === true);
    await cdp.evaluate(`document.querySelector('.t8-canvas-startup-retry').click()`);
    const empty = await waitForEvaluation(cdp, `(() => {
      const root = document.querySelector('[data-canvas-startup-stage="empty"]');
      if (!root) return null;
      return {
        createReady: document.querySelectorAll('[data-canvas-create-ready="true"]').length,
        lockedNodes: document.querySelectorAll('.t8-sidebar-node[aria-disabled="true"]').length,
        totalNodes: document.querySelectorAll('.t8-sidebar-node').length,
      };
    })()`);
    assert.ok(empty.createReady >= 1);
    assert.equal(empty.lockedNodes, empty.totalNodes);

    await cdp.evaluate(`document.querySelector('.t8-sidebar-node').click()`);
    const blockedNotice = await waitForEvaluation(cdp, `document.querySelector('.t8-canvas-startup-toast')?.textContent?.trim() || ''`);
    assert.ok(blockedNotice.length > 0);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.react-flow__node').length`), 0);

    await cdp.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('[data-canvas-create-ready="true"]')];
      const firstCanvasButton = buttons.find((button) => button.textContent.includes('新建第一个画布')) || buttons[0];
      firstCanvasButton.click();
    })()`);
    const ready = await waitForEvaluation(cdp, `(() => {
      const root = document.querySelector('[data-canvas-startup-stage="ready"]');
      if (!root || !document.querySelector('.react-flow')) return null;
      return {
        chip: document.querySelector('[data-canvas-startup-chip="ready"]')?.textContent?.trim() || '',
        unlockedNodes: [...document.querySelectorAll('.t8-sidebar-node')].filter((node) => node.getAttribute('aria-disabled') === 'false').length,
        totalNodes: document.querySelectorAll('.t8-sidebar-node').length,
      };
    })()`);
    assert.equal(ready.unlockedNodes, ready.totalNodes);
    assert.ok(ready.chip.length > 0);

    await cdp.evaluate(`document.querySelector('.t8-sidebar-node').click()`);
    await waitForEvaluation(cdp, `document.querySelectorAll('.react-flow__node').length === 1`);
    const catalog = await waitForJson(`${backendUrl}/api/canvas?limit=50`, (payload) => Array.isArray(payload?.data) && payload.data.length === 1);
    await sleep(1_800);
    assert.equal(await cdp.evaluate(`Boolean(document.querySelector('.t8-canvas-startup-ready'))`), false);
    const readyScreenshot = await captureScreenshot(cdp, 'canvas-ready.png');
    const stages = await cdp.evaluate(`window.__T8_CANVAS_STARTUP_STAGES__`);
    assert.ok(stages.includes('backend-error'), JSON.stringify(stages));
    assert.ok(stages.includes('empty'), JSON.stringify(stages));
    assert.ok(stages.includes('document') || stages.includes('flow'), JSON.stringify(stages));
    assert.ok(stages.includes('ready'), JSON.stringify(stages));
    assert.deepEqual(browserErrors, []);

    const report = {
      schema: 't8-canvas-startup-feedback-ui-v1',
      appVersion: APP_VERSION,
      isolatedUserData: true,
      disconnected,
      empty,
      blockedNotice,
      ready,
      stageHistory: stages,
      persistedCanvasCount: catalog.data.length,
      browserErrors,
      screenshots: [disconnectedScreenshot, readyScreenshot],
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    if (cdp) {
      try {
        const diagnostic = await cdp.evaluate(`(() => ({
          url: location.href,
          text: document.body?.innerText?.slice(0, 2500) || '',
          stage: document.querySelector('[data-canvas-startup-stage]')?.getAttribute('data-canvas-startup-stage') || null,
          stages: window.__T8_CANVAS_STARTUP_STAGES__ || [],
          nodes: document.querySelectorAll('.react-flow__node').length,
        }))()`);
        console.error('[canvas-startup-feedback-ui] diagnostic:\n' + JSON.stringify(diagnostic, null, 2));
        await captureScreenshot(cdp, 'failure.png');
      } catch (diagnosticError) {
        console.error('[canvas-startup-feedback-ui] diagnostic failed:', diagnosticError);
      }
    }
    console.error('[canvas-startup-feedback-ui] backend log tail:\n' + (backend?.logs || []).join('\n'));
    console.error('[canvas-startup-feedback-ui] vite log tail:\n' + vite.logs.join('\n'));
    console.error('[canvas-startup-feedback-ui] chrome log tail:\n' + (chrome?.logs || []).join('\n'));
    throw error;
  } finally {
    cdp?.close();
    stopProcess(chrome?.child);
    stopProcess(backend?.child);
    stopProcess(vite.child);
    await sleep(250);
    cleanupQaDirectory();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
