const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const ELECTRON = require('electron');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIST = path.join(ROOT, 'dist');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'startup-poster-ui');
const TEMP_ROOT = path.resolve(process.env.TEMP || process.env.TMP || path.join(ROOT, '.tmp'));
const QA_ROOT = path.join(TEMP_ROOT, 't8-startup-poster-ui');
const CHROME_PROFILE = path.join(QA_ROOT, 'chrome-profile');
const USER_DATA = path.join(QA_ROOT, 'user-data');
const APP_VERSION = require('../package.json').version;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 90_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertOwnedTemporaryPath(candidate) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(TEMP_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean a non-QA temporary directory: ${resolved}`);
  }
  return resolved;
}

function resetQaDirectory() {
  const target = assertOwnedTemporaryPath(QA_ROOT);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(CHROME_PROFILE, { recursive: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function cleanupQaDirectory() {
  const target = assertOwnedTemporaryPath(QA_ROOT);
  fs.rmSync(target, { recursive: true, force: true });
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
    cwd: options.cwd || ROOT,
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
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
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
    await sleep(150);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(`${options.method || 'GET'} ${url} failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
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
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP connection failed'));
      }, { once: true });
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
    await sleep(120);
  }
  throw new Error(`Timed out waiting for page condition: ${expression.slice(0, 160)}; last=${JSON.stringify(lastValue)}`);
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

async function run() {
  assert.equal(fs.existsSync(path.join(FRONTEND_DIST, 'index.html')), true, 'dist/index.html is missing');
  resetQaDirectory();
  const backendPort = await findFreePort();
  let frontendPort = await findFreePort();
  while (frontendPort === backendPort) frontendPort = await findFreePort();
  const debugPort = await findFreePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const backend = launch(ELECTRON, [path.join(ROOT, 'backend', 'src', 'server.js')], {
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
  const vite = launch(process.execPath, [
    path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--config',
    path.join(ROOT, 'vite.config.ts'),
    '--host',
    '127.0.0.1',
    '--port',
    String(frontendPort),
    '--strictPort',
  ], {
    env: {
      ...process.env,
      T8PC_DEV_BACKEND_ORIGIN: backendUrl,
      T8_FIGMA_BRIDGE_AUTOSTART: '0',
      TEMP: TEMP_ROOT,
      TMP: TEMP_ROOT,
    },
  });
  let chrome = null;
  let cdp = null;
  try {
    await waitForJson(`${backendUrl}/api/status`, (payload) => payload?.ok === true);
    const created = await requestJson(`${backendUrl}/api/canvas`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Startup poster isolated QA' }),
    });
    const canvasId = created.data.id;
    const qaNodes = Array.from({ length: 12 }, (_, index) => ({
      id: `startup-poster-qa-node-${index + 1}`,
      type: 'text',
      position: { x: (index % 4) * 360, y: Math.floor(index / 4) * 260 },
      data: { text: `Startup poster readiness ${index + 1}` },
    }));
    await requestJson(`${backendUrl}/api/canvas/${encodeURIComponent(canvasId)}`, {
      method: 'PUT',
      headers: { 'if-match': `"${created.data.revision}"` },
      body: JSON.stringify({
        name: 'Startup poster isolated QA',
        nodes: qaNodes,
        edges: [],
        viewport: { x: 40, y: 40, zoom: 0.72 },
        nextNodeSerialId: qaNodes.length + 1,
      }),
    });
    await waitForJson(
      `${backendUrl}/api/canvas?limit=50&activeId=${encodeURIComponent(canvasId)}`,
      (payload) => Array.isArray(payload?.data)
        && payload.data.some((item) => item?.id === canvasId)
        && payload?.meta?.recovery?.status === 'ready',
    );

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
      '--window-size=1480,920',
      'about:blank',
    ]);
    const targets = await waitForJson(
      `http://127.0.0.1:${debugPort}/json/list`,
      (items) => Array.isArray(items) && items.some((item) => item.type === 'page' && item.webSocketDebuggerUrl),
    );
    const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    assert.ok(page?.webSocketDebuggerUrl, 'Chrome page target was not found');
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    const browserErrors = [];
    cdp.onEvent((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        browserErrors.push({
          kind: 'runtime',
          text: message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'runtime exception',
          url: message.params?.exceptionDetails?.url || '',
        });
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        browserErrors.push({
          kind: 'log',
          text: message.params.entry.text || 'console error',
          url: message.params.entry.url || '',
        });
      }
    });
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Log.enable'),
      cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1480,
        height: 920,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__T8_STARTUP_POSTER_FIRST_SEEN__ = null;
        const observer = new MutationObserver(() => {
          if (window.__T8_STARTUP_POSTER_FIRST_SEEN__) return;
          const modal = document.querySelector('[data-testid="startup-poster-carousel"]');
          if (!modal) return;
          const image = modal.querySelector('.t8-startup-poster__image-button img');
          window.__T8_STARTUP_POSTER_FIRST_SEEN__ = {
            imageComplete: Boolean(image?.complete),
            imageNaturalWidth: Number(image?.naturalWidth || 0),
            imageNaturalHeight: Number(image?.naturalHeight || 0),
            reactFlowPresent: Boolean(document.querySelector('.react-flow')),
            canvasLoadState: document.querySelector('[data-canvas-load-state]')?.getAttribute('data-canvas-load-state') || null,
            renderedNodeCount: document.querySelectorAll('.react-flow__node').length,
            expectedNodeCount: Number(modal.getAttribute('data-expected-node-count') || 0),
            settleMs: Number(modal.getAttribute('data-canvas-settle-ms') || 0),
          };
        });
        observer.observe(document, { childList: true, subtree: true });
      })();`,
    });
    await cdp.send('Page.navigate', { url: frontendUrl });

    const desktop = await waitForEvaluation(cdp, `(() => {
      const modal = document.querySelector('[data-testid="startup-poster-carousel"]');
      const canvas = document.querySelector('.react-flow');
      const image = modal?.querySelector('.t8-startup-poster__image-button img');
      if (!modal || !canvas || !image || !image.complete || image.naturalWidth !== 2048 || image.naturalHeight !== 1536) return null;
      const card = modal.querySelector('.t8-startup-poster__card.is-current');
      const footer = modal.querySelector('.t8-startup-poster__footer');
      const close = modal.querySelector('.t8-startup-poster__close');
      const rect = card.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      return {
        modalCount: document.querySelectorAll('[data-testid="startup-poster-carousel"]').length,
        aspect: rect.width / rect.height,
        card: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        footer: { x: footerRect.x, y: footerRect.y, width: footerRect.width, height: footerRect.height },
        close: { x: closeRect.x, y: closeRect.y, width: closeRect.width, height: closeRect.height },
        navCount: modal.querySelectorAll('.t8-startup-poster__nav').length,
        progressCount: modal.querySelectorAll('.t8-startup-poster__progress').length,
        multiple: modal.querySelector('.t8-startup-poster').dataset.multiple,
        bodyOverflow: document.body.style.overflow,
        canvasSettleMs: Number(modal.getAttribute('data-canvas-settle-ms') || 0),
        expectedNodeCount: Number(modal.getAttribute('data-expected-node-count') || 0),
        renderedNodeCount: document.querySelectorAll('.react-flow__node').length,
      };
    })()`);
    assert.equal(desktop.modalCount, 1);
    assert.ok(Math.abs(desktop.aspect - (4 / 3)) < 0.02, JSON.stringify(desktop));
    assert.equal(desktop.navCount, 0);
    assert.equal(desktop.progressCount, 0);
    assert.equal(desktop.multiple, 'false');
    assert.equal(desktop.bodyOverflow, 'hidden');
    assert.ok(desktop.canvasSettleMs >= 900, JSON.stringify(desktop));
    assert.equal(desktop.expectedNodeCount, qaNodes.length);
    assert.ok(desktop.renderedNodeCount >= qaNodes.length, JSON.stringify(desktop));
    const firstSeen = await cdp.evaluate('window.__T8_STARTUP_POSTER_FIRST_SEEN__');
    assert.deepEqual(firstSeen, {
      imageComplete: true,
      imageNaturalWidth: 2048,
      imageNaturalHeight: 1536,
      reactFlowPresent: true,
      canvasLoadState: null,
      renderedNodeCount: qaNodes.length,
      expectedNodeCount: qaNodes.length,
      settleMs: desktop.canvasSettleMs,
    });
    const desktopScreenshot = await captureScreenshot(cdp, 'startup-poster-desktop.png');

    const persisted = await cdp.evaluate(`(() => {
      const checkbox = document.querySelector('.t8-startup-poster__suppression input');
      const close = document.querySelector('.t8-startup-poster__close');
      checkbox.click();
      close.click();
      return JSON.parse(localStorage.getItem('t8.startup-poster.suppression.v1'));
    })()`);
    assert.equal(persisted.appVersion, APP_VERSION);
    assert.equal(persisted.campaignId, 'free-online-canvas-2026-09');
    assert.ok(Math.abs((persisted.suppressUntil - persisted.suppressedAt) - SEVEN_DAYS_MS) === 0);
    await waitForEvaluation(cdp, `!document.querySelector('[data-testid="startup-poster-carousel"]')`);

    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForEvaluation(cdp, `Boolean(document.querySelector('.react-flow'))`);
    await sleep(750);
    assert.equal(await cdp.evaluate(`Boolean(document.querySelector('[data-testid="startup-poster-carousel"]'))`), false);

    await cdp.evaluate(`(() => {
      const key = 't8.startup-poster.suppression.v1';
      const record = JSON.parse(localStorage.getItem(key));
      record.appVersion = '0.0.0';
      localStorage.setItem(key, JSON.stringify(record));
      sessionStorage.clear();
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForEvaluation(cdp, `Boolean(document.querySelector('[data-testid="startup-poster-carousel"]'))`);
    assert.equal(await cdp.evaluate(`localStorage.getItem('t8.startup-poster.suppression.v1')`), null);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(250);
    const mobile = await cdp.evaluate(`(() => {
      const modal = document.querySelector('[data-testid="startup-poster-carousel"]');
      const card = modal.querySelector('.t8-startup-poster__card.is-current').getBoundingClientRect();
      const footer = modal.querySelector('.t8-startup-poster__footer').getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
        footer: { left: footer.left, right: footer.right, top: footer.top, bottom: footer.bottom },
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      };
    })()`);
    assert.ok(mobile.card.left >= 0 && mobile.card.right <= mobile.viewport.width, JSON.stringify(mobile));
    assert.ok(mobile.footer.left >= 0 && mobile.footer.right <= mobile.viewport.width, JSON.stringify(mobile));
    assert.ok(mobile.footer.bottom <= mobile.viewport.height, JSON.stringify(mobile));
    assert.equal(mobile.scrollWidth, mobile.viewport.width);
    const mobileScreenshot = await captureScreenshot(cdp, 'startup-poster-mobile.png');

    const ctaRect = await cdp.evaluate(`(() => {
      const rect = document.querySelector('.t8-startup-poster__cta').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctaRect.x, y: ctaRect.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctaRect.x, y: ctaRect.y, button: 'left', clickCount: 1 });
    await waitForEvaluation(cdp, `!document.querySelector('[data-testid="startup-poster-carousel"]')`);
    const externalTargets = await waitForJson(
      `http://127.0.0.1:${debugPort}/json/list`,
      (items) => Array.isArray(items) && items.some((item) => String(item?.url || '').startsWith('https://api.seedance.nz/canvas')),
      15_000,
    );
    const browserFallbackTargetOpened = externalTargets.some(
      (item) => String(item?.url || '').startsWith('https://api.seedance.nz/canvas'),
    );
    assert.equal(browserFallbackTargetOpened, true);
    const knownUnpairedCollaborationAuthErrors = browserErrors.filter((entry) => (
      entry.kind === 'log'
      && entry.text.includes('401 (Unauthorized)')
      && entry.url.includes('/api/collaboration/run-intents?')
    ));
    const unexpectedBrowserErrors = browserErrors.filter((entry) => !knownUnpairedCollaborationAuthErrors.includes(entry));
    assert.deepEqual(unexpectedBrowserErrors, []);

    const report = {
      schema: 't8-startup-poster-ui-qa-v1',
      appVersion: APP_VERSION,
      isolatedUserData: true,
      authoritativeCanvasReady: true,
      desktop,
      mobile,
      sevenDayRecord: {
        appVersion: persisted.appVersion,
        campaignId: persisted.campaignId,
        durationMs: persisted.suppressUntil - persisted.suppressedAt,
      },
      versionMismatchReshown: true,
      firstPresentation: firstSeen,
      browserFallbackTargetOpened,
      browserErrors: unexpectedBrowserErrors,
      knownIsolatedBrowserBoundary: {
        kind: 'unpaired-collaboration-run-intent-401',
        count: knownUnpairedCollaborationAuthErrors.length,
        posterRuntimeImpact: false,
      },
      screenshots: [desktopScreenshot, mobileScreenshot],
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    if (cdp) {
      try {
        const diagnostic = await cdp.evaluate(`(() => ({
          url: location.href,
          title: document.title,
          readyState: document.readyState,
          text: document.body?.innerText?.slice(0, 2000) || '',
          reactFlow: document.querySelectorAll('.react-flow').length,
          canvasLoadState: document.querySelector('[data-canvas-load-state]')?.getAttribute('data-canvas-load-state') || null,
          startupPoster: document.querySelectorAll('[data-testid="startup-poster-carousel"]').length,
          localStorage: Object.keys(localStorage),
          sessionStorage: Object.keys(sessionStorage),
        }))()`);
        console.error('[startup-poster-ui] page diagnostic:\n' + JSON.stringify(diagnostic, null, 2));
        await captureScreenshot(cdp, 'startup-poster-failure.png');
      } catch (diagnosticError) {
        console.error('[startup-poster-ui] diagnostic failed:', diagnosticError);
      }
    }
    console.error('[startup-poster-ui] backend log tail:\n' + backend.logs.join('\n'));
    console.error('[startup-poster-ui] vite log tail:\n' + vite.logs.join('\n'));
    console.error('[startup-poster-ui] chrome log tail:\n' + (chrome?.logs || []).join('\n'));
    throw error;
  } finally {
    cdp?.close();
    stopProcess(chrome?.child);
    stopProcess(vite.child);
    stopProcess(backend.child);
    await sleep(250);
    cleanupQaDirectory();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
