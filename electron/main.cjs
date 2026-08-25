// ============================================================================
// T8-penguin-canvas Electron 主进程
// 设计要点 (与参考项目 gpt-image-2-web Python 方案的区别):
//   1. 本项目无 Python 依赖,直接复用 Electron 内置 Node.js runtime 启动 Express
//   2. 后端核心源码已被 bytenode 编译为 .jsc 字节码 + T8ENC1 加密 (.t8c)
//   3. 启动时通过 loader.js 内存解密 .t8c → 字节码,require 到主进程
//   4. 前端 Vite 产物 (dist/) 由 Express 静态托管;BrowserWindow 直接 loadURL
//   5. 打包模式数据目录指向 app.getPath('userData') 而非项目目录
// ============================================================================

const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  session,
  safeStorage,
  nativeImage,
  dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');
const {
  installChromiumResponseHeaderBridge,
  installGlobalSystemFetchBridge,
} = require('./systemFetchBridge.cjs');
const {
  electronT,
  getElectronLocale,
  initializeElectronLocale,
  normalizeElectronLocale,
  setElectronLocale,
} = require('./i18n.cjs');

const APP_VERSION = require('../package.json').version;
const ELECTRON_BACKEND_SHUTDOWN_DEADLINE_MS = 15_000;
const ELECTRON_STARTUP_SHELL_PAINT_DEADLINE_MS = 2_500;
const ELECTRON_FRONTEND_LOAD_RETRY_DELAY_MS = 250;
const ELECTRON_FRONTEND_LOAD_RETRY_ATTEMPTS = 40;
const ELECTRON_MAIN_WINDOW_REVEAL_DEADLINE_MS = 15_000;
const ELECTRON_MAIN_WINDOW_ERROR_PAGE_LOAD_DEADLINE_MS = 1_000;
const MAIN_WINDOW_STARTUP_RETRY_URL = 'https://t8pc.startup.local/retry';
const MAIN_WINDOW_STARTUP_BACKEND_URL = 'https://t8pc.startup.local/backend';
const electronStartupStartedAt = Date.now();
const ELECTRON_SINGLE_INSTANCE_OWNER = app.requestSingleInstanceLock();
if (!ELECTRON_SINGLE_INSTANCE_OWNER) app.quit();

// 允许在 Linux/某些机型上规避 GPU 沙盒导致的启动延迟
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
if (process.platform === 'win32') {
  app.setAppUserModelId('cn.t8star.penguin-canvas');
}

let mainWindow = null;
let vibeXRhLoginWindow = null;
let logWindow = null;
let startupShellReadyPromise = Promise.resolve();
let backendModule = null; // 后端 Express app(同进程加载) 或 子进程句柄
let backendProcess = null;
let backendPort = 18766;
let backendInstanceId = '';
let backendStartPromise = null;
let backendShutdownPromise = null;
let agentControlMutationUnsubscribe = null;
let electronQuitRequested = false;
let electronQuitReady = false;
let electronQuitFinalizationPromise = null;
let collaborationManagementToken = '';
let logBuffer = [];
let autoUpdater = null;
let initialUpdateCheckStarted = false;
let vibeXFrameUiPatchTimer = null;
let updaterState = {
  status: 'idle',
  currentVersion: APP_VERSION,
  availableVersion: null,
  messageKey: 'updater.idle',
  messageParams: {},
  message: electronT('updater.idle'),
  progress: null,
  downloaded: false,
  error: null,
  packaged: false,
  updatedAt: null,
};

function markElectronStartupStage(stage, details = '') {
  const elapsedMs = Math.max(0, Date.now() - electronStartupStartedAt);
  const suffix = details ? ` details=${String(details).replace(/[\r\n]+/g, ' ').slice(0, 240)}` : '';
  dbgLog(`[startup] component=electron phase=${stage} elapsedMs=${elapsedMs}${suffix}`);
  return { stage, elapsedMs };
}

function waitForStartupShellPaint() {
  return Promise.race([
    startupShellReadyPromise,
    new Promise((resolve) => setTimeout(resolve, ELECTRON_STARTUP_SHELL_PAINT_DEADLINE_MS)),
  ]);
}

const PARSE_AUTH_PARTITION = 'persist:t8-parsehub-auth';
const VIBEX_HOSTNAME = 'vibex.runninghub.cn';
const COLLABORATION_MANAGEMENT_HEADER = 'x-t8-collaboration-management-token';
const COLLABORATION_MANAGEMENT_SCHEMA = 't8-collaboration-management-authority-v1';
const ELECTRON_MANAGEMENT_SCHEMA = 't8-electron-collaboration-management-authority-v1';
const VIBEX_RH_COOKIE_DOMAIN = '.runninghub.cn';
const VIBEX_RH_TOKEN_KEYS = ['Rh-Accesstoken', 'Rh-Refreshtoken', 'Rh-Identify'];
const VIBEX_RH_TOKEN_ALIASES = {
  'Rh-Accesstoken': [
    'Rh-Accesstoken',
    'Accesstoken',
    'accesstoken',
    'accessToken',
    'access_token',
    'rhAccessToken',
    'rh_access_token',
    'token',
  ],
  'Rh-Refreshtoken': [
    'Rh-Refreshtoken',
    'Refreshtoken',
    'refreshtoken',
    'refreshToken',
    'refresh_token',
    'rhRefreshToken',
    'rh_refresh_token',
  ],
  'Rh-Identify': [
    'Rh-Identify',
    'Identify',
    'identify',
    'rhIdentify',
    'rh_identify',
  ],
};
const PARSE_AUTH_PROFILES = [
  { id: 'douyin', label: '抖音', authUrl: 'https://www.douyin.com/', domains: ['douyin.com', 'iesdouyin.com'] },
  { id: 'tiktok', label: 'TikTok', authUrl: 'https://www.tiktok.com/', domains: ['tiktok.com'] },
  { id: 'xiaohongshu', label: '小红书', authUrl: 'https://www.xiaohongshu.com/', domains: ['xiaohongshu.com', 'xhslink.com'] },
  { id: 'bilibili', label: 'Bilibili', authUrl: 'https://www.bilibili.com/', domains: ['bilibili.com', 'b23.tv'] },
  { id: 'weibo', label: '微博', authUrl: 'https://weibo.com/', domains: ['weibo.com', 'weibo.cn'] },
  { id: 'kuaishou', label: '快手', authUrl: 'https://www.kuaishou.com/', domains: ['kuaishou.com', 'gifshow.com'] },
  { id: 'youtube', label: 'YouTube', authUrl: 'https://www.youtube.com/', domains: ['youtube.com', 'youtu.be', 'google.com'] },
  { id: 'twitter', label: 'X / Twitter', authUrl: 'https://x.com/', domains: ['x.com', 'twitter.com'] },
  { id: 'instagram', label: 'Instagram', authUrl: 'https://www.instagram.com/', domains: ['instagram.com'] },
  { id: 'facebook', label: 'Facebook', authUrl: 'https://www.facebook.com/', domains: ['facebook.com', 'fb.watch'] },
  { id: 'threads', label: 'Threads', authUrl: 'https://www.threads.net/', domains: ['threads.net'] },
  { id: 'tieba', label: '贴吧', authUrl: 'https://tieba.baidu.com/', domains: ['tieba.baidu.com'] },
];

app.on('second-instance', () => {
  if (!ELECTRON_SINGLE_INSTANCE_OWNER || !mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function isSafeExternalUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function openExternalUrl(url) {
  if (!isSafeExternalUrl(url)) {
    return Promise.resolve({ success: false, message: 'invalid external url' });
  }
  return shell.openExternal(url)
    .then(() => ({ success: true }))
    .catch((e) => ({ success: false, message: e && e.message ? e.message : String(e) }));
}

function parseHttpUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function developmentFrontendUrl() {
  if (isPackaged()) return '';
  const raw = String(process.env.T8PC_DEV_SERVER_URL || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const hostname = String(parsed.hostname || '').toLowerCase();
    if (parsed.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)
      || parsed.username
      || parsed.password) {
      dbgLog('[main] ignored unsafe T8PC_DEV_SERVER_URL; only unauthenticated loopback HTTP is allowed');
      return '';
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    dbgLog('[main] ignored invalid T8PC_DEV_SERVER_URL');
    return '';
  }
}

function isRunningHubHost(hostname) {
  return hostnameMatchesDomain(hostname, 'runninghub.cn');
}

function isVibeXRhLoginUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  return isRunningHubHost(parsed.hostname) && parsed.pathname.toLowerCase().includes('sso-login');
}

function isVibeXSsoCallbackUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  return String(parsed.hostname || '').toLowerCase() === VIBEX_HOSTNAME
    && parsed.pathname.toLowerCase().includes('sso-popup-callback');
}

function isVibeXRhLoginFlowUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  const host = String(parsed.hostname || '').toLowerCase();
  return host === VIBEX_HOSTNAME || isRunningHubHost(host);
}

function vibeXRhParamsFromUrl(url) {
  const parsed = parseHttpUrl(url);
  const params = new URLSearchParams(parsed ? parsed.search : '');
  if (!parsed) return params;
  const hash = String(parsed.hash || '').replace(/^#/, '');
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
  if (hashQuery.includes('=')) {
    new URLSearchParams(hashQuery).forEach((value, key) => {
      params.set(key, value);
    });
  }
  return params;
}

function readVibeXRhTokenValue(source, key) {
  const aliases = VIBEX_RH_TOKEN_ALIASES[key] || [key, key.replace(/^Rh-/, ''), key.toLowerCase(), key.replace(/^Rh-/, '').toLowerCase()];
  for (const alias of aliases) {
    const raw = source instanceof URLSearchParams ? source.get(alias) : source?.[alias];
    const value = String(raw || '').trim();
    if (value) return value;
  }
  return '';
}

function extractVibeXRhLoginTokens(source) {
  const params = source instanceof URLSearchParams
    ? source
    : (source && typeof source === 'object' && !(source instanceof String) ? source : vibeXRhParamsFromUrl(source));
  const tokens = {};
  for (const key of VIBEX_RH_TOKEN_KEYS) {
    const value = readVibeXRhTokenValue(params, key);
    if (value) tokens[key] = value;
  }
  return tokens;
}

function hasVibeXRhLoginTokens(tokens) {
  return VIBEX_RH_TOKEN_KEYS.some((key) => String(tokens?.[key] || '').trim());
}

async function readVibeXRhTokensFromSessionCookies() {
  const cookieUrls = [
    `https://${VIBEX_HOSTNAME}/`,
    'https://www.runninghub.cn/',
    'https://runninghub.cn/',
  ];
  const cookies = [];
  for (const url of cookieUrls) {
    try {
      cookies.push(...await session.defaultSession.cookies.get({ url }));
    } catch (_) {}
  }
  if (!cookies.length) return {};
  const byName = new Map();
  for (const cookie of cookies) {
    if (!cookie?.name || byName.has(cookie.name)) continue;
    byName.set(cookie.name, cookie.value || '');
  }
  const out = {};
  for (const key of VIBEX_RH_TOKEN_KEYS) {
    const aliases = VIBEX_RH_TOKEN_ALIASES[key] || [key];
    for (const alias of aliases) {
      const raw = byName.get(alias);
      const value = String(raw || '').trim();
      if (!value) continue;
      try {
        out[key] = decodeURIComponent(value);
      } catch (_) {
        out[key] = value;
      }
      break;
    }
  }
  return out;
}

async function persistVibeXRhLoginTokens(tokens) {
  const entries = VIBEX_RH_TOKEN_KEYS
    .map((key) => [key, String(tokens?.[key] || '').trim()])
    .filter(([, value]) => value);
  if (!entries.length) {
    return { success: false, count: 0 };
  }
  const expirationDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  for (const [name, rawValue] of entries) {
    const value = encodeURIComponent(rawValue);
    const common = {
      name,
      value,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction',
      expirationDate,
    };
    await session.defaultSession.cookies.set({
      url: `https://${VIBEX_HOSTNAME}/`,
      domain: VIBEX_RH_COOKIE_DOMAIN,
      ...common,
    });
    await session.defaultSession.cookies.set({
      url: `https://${VIBEX_HOSTNAME}/`,
      ...common,
    });
  }
  return { success: true, count: entries.length };
}

function collectVibeXFrames(frame, out = []) {
  if (!frame) return out;
  try {
    if (isVibeXRhLoginFlowUrl(frame.url) && String(new URL(frame.url).hostname || '').toLowerCase() === VIBEX_HOSTNAME) {
      out.push(frame);
    }
  } catch (_) {}
  const childFrames = Array.isArray(frame.frames) ? frame.frames : [];
  for (const child of childFrames) collectVibeXFrames(child, out);
  return out;
}

function buildVibeXFrameUiPatchScript() {
  function installVibeXSelectPatch() {
    if (window.__t8VibeXSelectPatchInstalled && typeof window.__t8VibeXPatchSelects === 'function') {
      window.__t8VibeXPatchSelects();
      return 'already-installed';
    }

    window.__t8VibeXSelectPatchInstalled = true;
    const PATCH_ATTR = 'data-t8-vibex-native-select';
    const TRIGGER_CLASS = 't8-vibex-custom-select-trigger';
    const MENU_CLASS = 't8-vibex-custom-select-menu';
    const OPTION_CLASS = 't8-vibex-custom-select-option';
    let openMenu = null;

    function injectStyle() {
      if (document.getElementById('t8-vibex-select-patch-style')) return;
      const style = document.createElement('style');
      style.id = 't8-vibex-select-patch-style';
      style.textContent = [
        '.' + TRIGGER_CLASS + '{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:44px;border:1px solid rgba(148,163,184,.35);border-radius:10px;background:rgba(2,6,23,.88);color:#f8fafc;padding:8px 12px;font:inherit;text-align:left;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.05);}',
        '.' + TRIGGER_CLASS + ':focus{outline:2px solid rgba(59,130,246,.75);outline-offset:2px;}',
        '.' + TRIGGER_CLASS + ':disabled{cursor:not-allowed;opacity:.55;}',
        '.t8-vibex-custom-select-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.t8-vibex-custom-select-caret{flex:0 0 auto;opacity:.8;font-size:13px;}',
        '.' + MENU_CLASS + '{position:fixed;z-index:2147483647;box-sizing:border-box;max-height:280px;overflow:auto;overscroll-behavior:contain;border:1px solid rgba(96,165,250,.45);border-radius:10px;background:#020617;color:#f8fafc;padding:4px;box-shadow:0 18px 42px rgba(0,0,0,.52),0 0 0 1px rgba(255,255,255,.04);}',
        '.' + OPTION_CLASS + '{display:block;width:100%;border:0;border-radius:7px;background:transparent;color:inherit;padding:9px 10px;font:inherit;text-align:left;cursor:pointer;}',
        '.' + OPTION_CLASS + ':hover,.' + OPTION_CLASS + '[data-active="true"]{background:#2563eb;color:white;}',
      ].join('\n');
      document.head.appendChild(style);
    }

    function selectedLabel(select) {
      const option = select.options[select.selectedIndex];
      return option ? option.textContent || option.value || '' : '';
    }

    function closeMenu() {
      if (!openMenu) return;
      try {
        openMenu.remove();
      } catch (_) {}
      openMenu = null;
    }

    function isOpenMenuTarget(target) {
      if (!openMenu || !target) return false;
      return target === openMenu || (typeof openMenu.contains === 'function' && openMenu.contains(target));
    }

    function updateTrigger(select) {
      const trigger = select.__t8VibeXCustomTrigger;
      if (!trigger) return;
      const label = trigger.querySelector('.t8-vibex-custom-select-label');
      if (label) label.textContent = selectedLabel(select);
      trigger.disabled = !!select.disabled;
      trigger.title = selectedLabel(select);
    }

    function dispatchSelectChange(select) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function positionMenu(trigger, menu) {
      const rect = trigger.getBoundingClientRect();
      const minViewportGap = 8;
      const width = Math.max(rect.width, 128);
      const left = Math.max(minViewportGap, Math.min(rect.left, window.innerWidth - width - minViewportGap));
      const spaceBelow = window.innerHeight - rect.bottom - minViewportGap;
      const spaceAbove = rect.top - minViewportGap;
      const openAbove = spaceBelow < 150 && spaceAbove > spaceBelow;
      menu.style.left = left + 'px';
      menu.style.width = width + 'px';
      menu.style.maxHeight = Math.max(120, Math.min(280, (openAbove ? spaceAbove : spaceBelow) - 4)) + 'px';
      menu.style.top = openAbove ? 'auto' : Math.max(minViewportGap, rect.bottom + 4) + 'px';
      menu.style.bottom = openAbove ? Math.max(minViewportGap, window.innerHeight - rect.top + 4) + 'px' : 'auto';
    }

    function openCustomMenu(select, trigger) {
      closeMenu();
      updateTrigger(select);
      const menu = document.createElement('div');
      menu.className = MENU_CLASS;
      menu.setAttribute('role', 'listbox');
      Array.from(select.options).forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = OPTION_CLASS;
        button.textContent = option.textContent || option.value || '';
        button.setAttribute('role', 'option');
        if (option.value === select.value) button.setAttribute('data-active', 'true');
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          select.value = option.value;
          dispatchSelectChange(select);
          updateTrigger(select);
          closeMenu();
          trigger.focus();
        });
        menu.appendChild(button);
      });
      document.body.appendChild(menu);
      openMenu = menu;
      positionMenu(trigger, menu);
    }

    function patchSelect(select) {
      if (!(select instanceof HTMLSelectElement)) return;
      if (select.getAttribute(PATCH_ATTR) === '1') {
        updateTrigger(select);
        return;
      }
      select.setAttribute(PATCH_ATTR, '1');
      const oldChevron = select.nextElementSibling;
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = TRIGGER_CLASS;
      trigger.innerHTML = '<span class="t8-vibex-custom-select-label"></span><span class="t8-vibex-custom-select-caret">⌄</span>';
      select.__t8VibeXCustomTrigger = trigger;
      select.style.display = 'none';
      if (oldChevron && oldChevron.tagName && oldChevron.tagName.toLowerCase() === 'svg') {
        oldChevron.style.display = 'none';
      }
      select.insertAdjacentElement('afterend', trigger);
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (select.disabled) return;
        openCustomMenu(select, trigger);
      });
      select.addEventListener('change', () => updateTrigger(select));
      select.addEventListener('input', () => updateTrigger(select));
      updateTrigger(select);
    }

    function patchSelects() {
      document.querySelectorAll('select').forEach(patchSelect);
      return document.querySelectorAll('select[' + PATCH_ATTR + '="1"]').length;
    }

    window.__t8VibeXPatchSelects = patchSelects;
    injectStyle();
    const count = patchSelects();
    const observer = new MutationObserver(() => patchSelects());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('pointerdown', (event) => {
      if (!openMenu) return;
      const target = event.target;
      const isTrigger = target && typeof target.closest === 'function' && target.closest('.' + TRIGGER_CLASS);
      if (isOpenMenuTarget(target) || isTrigger) return;
      closeMenu();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    }, true);
    window.addEventListener('resize', closeMenu, true);
    window.addEventListener('scroll', (event) => {
      if (isOpenMenuTarget(event.target)) return;
      closeMenu();
    }, true);
    setInterval(() => document.querySelectorAll('select[' + PATCH_ATTR + '="1"]').forEach(updateTrigger), 700);
    return 'installed:' + count;
  }

  return `(${installVibeXSelectPatch.toString()})()`;
}

async function injectVibeXFrameUiPatches() {
  if (!mainWindow || mainWindow.isDestroyed()) return 0;
  const rootFrame = mainWindow.webContents && mainWindow.webContents.mainFrame ? mainWindow.webContents.mainFrame : null;
  const frames = collectVibeXFrames(rootFrame);
  if (!frames.length) return 0;
  const script = buildVibeXFrameUiPatchScript();
  let patched = 0;
  for (const frame of frames) {
    if (!frame || typeof frame.executeJavaScript !== 'function') continue;
    try {
      await frame.executeJavaScript(script, true);
      patched += 1;
    } catch (error) {
      dbgLog(`[vibex-ui] frame patch failed: ${normalizeError(error)}`);
    }
  }
  return patched;
}

function scheduleVibeXFrameUiPatch(delay = 250) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (vibeXFrameUiPatchTimer) clearTimeout(vibeXFrameUiPatchTimer);
  vibeXFrameUiPatchTimer = setTimeout(() => {
    vibeXFrameUiPatchTimer = null;
    injectVibeXFrameUiPatches()
      .then((count) => {
        if (count) dbgLog(`[vibex-ui] patched ${count} embedded frame(s)`);
      })
      .catch((error) => dbgLog(`[vibex-ui] patch schedule failed: ${normalizeError(error)}`));
  }, delay);
}

async function syncVibeXRhTokensToEmbeddedFrames(tokens) {
  if (!hasVibeXRhLoginTokens(tokens) || !mainWindow || mainWindow.isDestroyed()) return 0;
  const script = `(function(){
    const tokens = ${JSON.stringify(tokens)};
    try {
      for (const [key, value] of Object.entries(tokens)) {
        if (!value) continue;
        localStorage.setItem(key, value);
        document.cookie = key + '=' + encodeURIComponent(value) + ';Path=/;Max-Age=604800;SameSite=Lax;Secure';
        document.cookie = key + '=' + encodeURIComponent(value) + ';Path=/;Max-Age=604800;SameSite=Lax;Domain=.runninghub.cn;Secure';
      }
      localStorage.removeItem('t8-vibex-local-rh-logged-out');
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'rh-sso-login-complete', tokens: tokens } }));
      return true;
    } catch (_) {
      return false;
    }
  })()`;
  let synced = 0;
  const rootFrame = mainWindow.webContents && mainWindow.webContents.mainFrame ? mainWindow.webContents.mainFrame : null;
  const frames = collectVibeXFrames(rootFrame);
  for (const frame of frames) {
    if (!frame || typeof frame.executeJavaScript !== 'function') continue;
    try {
      const ok = await frame.executeJavaScript(script, true);
      if (ok) synced += 1;
    } catch (error) {
      dbgLog(`[vibex-sso] token frame sync failed: ${normalizeError(error)}`);
    }
  }
  try {
    const posted = await mainWindow.webContents.executeJavaScript(`(function(){
      const frames = Array.from(document.querySelectorAll('iframe[data-vibex-frame="true"]'));
      for (const frame of frames) {
        try {
          frame.contentWindow && frame.contentWindow.postMessage(
            { type: 'rh-sso-login-complete', tokens: ${JSON.stringify(tokens)} },
            'https://${VIBEX_HOSTNAME}'
          );
        } catch (_) {}
      }
      return frames.length;
    })()`, true);
    synced = Math.max(synced, Number(posted || 0));
  } catch (error) {
    dbgLog(`[vibex-sso] token postMessage failed: ${normalizeError(error)}`);
  }
  scheduleVibeXFrameUiPatch(100);
  return synced;
}

function reloadVibeXFramesAfterLogin() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(`(function(){
    const frames = Array.from(document.querySelectorAll('iframe[data-vibex-frame="true"]'));
    let count = 0;
    for (const frame of frames) {
      try {
        const next = new URL(frame.src);
        if (next.hostname !== '${VIBEX_HOSTNAME}') continue;
        next.searchParams.set('_t8rh', String(Date.now()));
        frame.src = next.toString();
        count += 1;
      } catch (_) {}
    }
    return count;
  })()`, true)
    .then((count) => {
      dbgLog(`[vibex-sso] refreshed ${Number(count || 0)} embedded frame(s)`);
      scheduleVibeXFrameUiPatch(900);
    })
    .catch((error) => dbgLog(`[vibex-sso] refresh embedded frames failed: ${normalizeError(error)}`));
}

async function readVibeXRhTokensFromLoginWindow(loginWindow) {
  if (!loginWindow || loginWindow.isDestroyed()) return {};
  const currentUrl = loginWindow.webContents.getURL();
  if (!isVibeXSsoCallbackUrl(currentUrl) && !isVibeXRhLoginFlowUrl(currentUrl)) return {};
  try {
    const tokens = await loginWindow.webContents.executeJavaScript(`(function(){
      const aliases = ${JSON.stringify(VIBEX_RH_TOKEN_ALIASES)};
      const readCookie = function(name) {
        try {
          const prefix = name + '=';
          const item = document.cookie.split(';').map(function(part) { return part.trim(); }).find(function(part) {
            return part.startsWith(prefix);
          });
          return item ? decodeURIComponent(item.slice(prefix.length)) : '';
        } catch (_) {
          return '';
        }
      };
      const out = {};
      for (const key of Object.keys(aliases)) {
        for (const alias of aliases[key]) {
          const value = localStorage.getItem(alias) || sessionStorage.getItem(alias) || readCookie(alias) || '';
          if (value) {
            out[key] = value;
            break;
          }
        }
      }
      return out;
    })()`, true);
    return tokens && typeof tokens === 'object' ? tokens : {};
  } catch (_) {
    return {};
  }
}

async function handleVibeXSsoCallback(targetUrl, ownerWindow) {
  let tokens = extractVibeXRhLoginTokens(targetUrl);
  if (!hasVibeXRhLoginTokens(tokens)) {
    tokens = await readVibeXRhTokensFromLoginWindow(ownerWindow);
  }
  if (!hasVibeXRhLoginTokens(tokens)) {
    tokens = await readVibeXRhTokensFromSessionCookies();
  }
  if (!hasVibeXRhLoginTokens(tokens)) return false;
  await persistVibeXRhLoginTokens(tokens);
  const syncedFrames = await syncVibeXRhTokensToEmbeddedFrames(tokens);
  dbgLog(`[vibex-sso] RunningHub login tokens synced to ${syncedFrames} VibeX frame(s)`);
  setTimeout(() => {
    reloadVibeXFramesAfterLogin();
    if (ownerWindow && !ownerWindow.isDestroyed()) {
      ownerWindow.close();
    }
  }, 800);
  return true;
}

function createVibeXRhLoginWindowOptions() {
  return {
    width: 540,
    height: 760,
    minWidth: 480,
    minHeight: 640,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    show: true,
    title: electronT('auth.runningHubLogin'),
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function configureVibeXRhLoginWindow(loginWindow) {
  if (!loginWindow || loginWindow.isDestroyed()) return;
  vibeXRhLoginWindow = loginWindow;
  if (loginWindow.__t8VibeXRhLoginConfigured) return;
  loginWindow.__t8VibeXRhLoginConfigured = true;
  loginWindow.__t8VibeXRhLoginPending = false;
  loginWindow.__t8VibeXRhLoginHandled = false;
  loginWindow.__t8VibeXRhLoginAttempts = 0;
  loginWindow.removeMenu();
  loginWindow.on('closed', () => {
    if (!loginWindow.__t8VibeXRhLoginHandled) {
      void handleVibeXSsoCallback(`https://${VIBEX_HOSTNAME}/sso-popup-callback`, null);
    }
    if (vibeXRhLoginWindow === loginWindow) vibeXRhLoginWindow = null;
  });
  const scheduleCallbackSync = (targetUrl, delayMs = 900) => {
    if (!isVibeXSsoCallbackUrl(targetUrl)) return;
    if (loginWindow.__t8VibeXRhLoginPending || loginWindow.__t8VibeXRhLoginHandled) return;
    loginWindow.__t8VibeXRhLoginPending = true;
    loginWindow.__t8VibeXRhLoginAttempts += 1;
    const attempt = loginWindow.__t8VibeXRhLoginAttempts;
    setTimeout(() => {
      void handleVibeXSsoCallback(targetUrl, loginWindow)
        .then((handled) => {
          if (handled) loginWindow.__t8VibeXRhLoginHandled = true;
        })
        .finally(() => {
          loginWindow.__t8VibeXRhLoginPending = false;
          if (!loginWindow.__t8VibeXRhLoginHandled
            && attempt < 8
            && !loginWindow.isDestroyed()
            && isVibeXSsoCallbackUrl(loginWindow.webContents.getURL())) {
            scheduleCallbackSync(loginWindow.webContents.getURL(), Math.min(800 + attempt * 400, 2600));
          }
        });
    }, delayMs);
  };
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isVibeXRhLoginFlowUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: createVibeXRhLoginWindowOptions() };
    }
    if (isSafeExternalUrl(url)) {
      void openExternalUrl(url);
    }
    return { action: 'deny' };
  });
  loginWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isVibeXSsoCallbackUrl(targetUrl)) {
      scheduleCallbackSync(targetUrl, 800);
      return;
    }
    if (isVibeXRhLoginFlowUrl(targetUrl)) return;
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) {
      void openExternalUrl(targetUrl);
    }
  });
  loginWindow.webContents.on('will-redirect', (event, targetUrl) => {
    if (isVibeXSsoCallbackUrl(targetUrl)) {
      scheduleCallbackSync(targetUrl, 800);
      return;
    }
    scheduleCallbackSync(targetUrl);
  });
  loginWindow.webContents.on('did-navigate', (_event, targetUrl) => {
    scheduleCallbackSync(targetUrl);
  });
  loginWindow.webContents.on('did-redirect-navigation', (_event, targetUrl) => {
    scheduleCallbackSync(targetUrl);
  });
  loginWindow.webContents.on('did-finish-load', () => {
    scheduleCallbackSync(loginWindow.webContents.getURL());
  });
}

async function openVibeXRhLoginWindow(targetUrl) {
  if (!isVibeXRhLoginUrl(targetUrl)) {
    return { success: false, message: 'invalid VibeX RunningHub login url' };
  }
  if (vibeXRhLoginWindow && !vibeXRhLoginWindow.isDestroyed()) {
    configureVibeXRhLoginWindow(vibeXRhLoginWindow);
    vibeXRhLoginWindow.focus();
    try {
      await vibeXRhLoginWindow.loadURL(targetUrl);
      return { success: true };
    } catch (error) {
      return { success: false, message: normalizeError(error) };
    }
  }
  const loginWindow = new BrowserWindow(createVibeXRhLoginWindowOptions());
  configureVibeXRhLoginWindow(loginWindow);
  try {
    await loginWindow.loadURL(targetUrl);
    return { success: true };
  } catch (error) {
    return { success: false, message: normalizeError(error) };
  }
}

function getParseAuthProfile(profileId) {
  const id = String(profileId || '').trim();
  return PARSE_AUTH_PROFILES.find((profile) => profile.id === id) || null;
}

function hostnameMatchesDomain(hostname, domain) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const cleanDomain = String(domain || '').toLowerCase().replace(/^www\./, '');
  return host === cleanDomain || host.endsWith(`.${cleanDomain}`);
}

function isParseAuthAllowedUrl(url, profile) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return profile.domains.some((domain) => hostnameMatchesDomain(parsed.hostname, domain));
  } catch (_) {
    return false;
  }
}

function parseAuthSession() {
  return session.fromPartition(PARSE_AUTH_PARTITION);
}

async function openParseAuthWindow(profileId) {
  const profile = getParseAuthProfile(profileId);
  if (!profile) {
    return localizedElectronResult(false, 'PARSE_AUTH_PROFILE_UNKNOWN', 'auth.unknownOpen');
  }
  if (!app.isReady()) {
    return localizedElectronResult(false, 'PARSE_AUTH_APP_NOT_READY', 'auth.appNotReady');
  }

  const authWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 860,
    minHeight: 640,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    show: true,
    title: electronT('auth.loginTitle', { platform: profile.label }),
    backgroundColor: '#111111',
    webPreferences: {
      partition: PARSE_AUTH_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  authWindow.removeMenu();

  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isParseAuthAllowedUrl(url, profile)) {
      authWindow.loadURL(url).catch((error) => {
        dbgLog(`[parse-auth] load popup url failed: ${normalizeError(error)}`);
      });
    } else if (isSafeExternalUrl(url)) {
      void openExternalUrl(url);
    }
    return { action: 'deny' };
  });

  authWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isParseAuthAllowedUrl(targetUrl, profile)) return;
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) {
      void openExternalUrl(targetUrl);
    }
  });

  try {
    await authWindow.loadURL(profile.authUrl);
    return localizedElectronResult(true, 'PARSE_AUTH_WINDOW_OPENED', 'auth.opened', { platform: profile.label });
  } catch (error) {
    return { success: false, message: normalizeError(error) };
  }
}

function cookieUrlFor(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  if (!domain) return '';
  const protocol = cookie.secure ? 'https:' : 'http:';
  const cookiePath = String(cookie.path || '/');
  return `${protocol}//${domain}${cookiePath.startsWith('/') ? cookiePath : `/${cookiePath}`}`;
}

function summarizeCookie(cookieText, cookies, profile) {
  const expires = cookies
    .map((item) => Number(item.expirationDate || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];
  return {
    profileId: profile.id,
    label: profile.label,
    cookie: cookieText,
    count: cookies.length,
    length: cookieText.length,
    expiresAt: expires ? new Date(expires * 1000).toISOString() : null,
    domains: Array.from(new Set(cookies.map((item) => String(item.domain || '').replace(/^\./, '')).filter(Boolean))).slice(0, 8),
  };
}

function parseAuthStorePath() {
  return path.join(getUserDataDir(), 'data', 'parsehub-auth.json');
}

function defaultParseAuthStore() {
  return {
    schema: 't8-parsehub-auth',
    version: 1,
    records: {},
    updatedAt: new Date().toISOString(),
  };
}

function readParseAuthStore() {
  const file = parseAuthStorePath();
  if (!fs.existsSync(file)) return defaultParseAuthStore();
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!data || data.schema !== 't8-parsehub-auth' || typeof data.records !== 'object') {
      return defaultParseAuthStore();
    }
    return {
      ...defaultParseAuthStore(),
      ...data,
      records: data.records || {},
    };
  } catch (_) {
    return defaultParseAuthStore();
  }
}

function writeParseAuthStore(store) {
  const file = parseAuthStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = {
    ...store,
    schema: 't8-parsehub-auth',
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(temp, file);
}

function normalizeCookieTextForStore(value) {
  const text = String(value || '')
    .replace(/\r?\n/g, '; ')
    .replace(/;\s*;/g, ';')
    .trim()
    .replace(/^;+|;+$/g, '');
  if (!text) return '';
  if (text.length > 12000) {
    throw localizedElectronError('auth.cookieTooLong', 'PARSE_AUTH_COOKIE_TOO_LONG');
  }
  if (!/(^|;\s*)[^=;\s]+=[^;]+/.test(text)) {
    throw localizedElectronError('auth.cookieInvalid', 'PARSE_AUTH_COOKIE_INVALID');
  }
  return text;
}

function ensureParseAuthEncryption() {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw localizedElectronError('auth.encryptionUnavailable', 'PARSE_AUTH_ENCRYPTION_UNAVAILABLE');
  }
}

function encryptParseAuthCookie(cookieText) {
  ensureParseAuthEncryption();
  return safeStorage.encryptString(cookieText).toString('base64');
}

function decryptParseAuthCookie(record) {
  ensureParseAuthEncryption();
  return safeStorage.decryptString(Buffer.from(String(record.cookieEnc || ''), 'base64'));
}

function maskParseAuthRecord(record) {
  return {
    profileId: record.profileId,
    label: record.label,
    saved: true,
    encrypted: record.encoding === 'electron-safeStorage:v1',
    savedAt: record.savedAt || null,
    updatedAt: record.updatedAt || record.savedAt || null,
    expiresAt: record.expiresAt || null,
    length: Number(record.length || 0),
    count: Number(record.count || 0),
    domains: Array.isArray(record.domains) ? record.domains.slice(0, 8) : [],
  };
}

function countCookiePairs(cookieText) {
  return String(cookieText || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^[^=;\s]+=[^;]+/.test(part))
    .length;
}

async function listSavedParseAuth(profileId) {
  const store = readParseAuthStore();
  const id = String(profileId || '').trim();
  const records = Object.values(store.records || {})
    .filter((record) => record && (!id || record.profileId === id))
    .map(maskParseAuthRecord);
  return { success: true, data: { records, encryptionAvailable: !!(safeStorage && safeStorage.isEncryptionAvailable()) } };
}

async function saveParseAuthRecord(profileId, cookieText, meta = {}) {
  const profile = getParseAuthProfile(profileId);
  if (!profile) {
    return localizedElectronResult(false, 'PARSE_AUTH_PROFILE_UNKNOWN', 'auth.unknownSave');
  }
  let normalized = '';
  try {
    normalized = normalizeCookieTextForStore(cookieText);
    const now = new Date().toISOString();
    const store = readParseAuthStore();
    const previous = store.records?.[profile.id] || null;
    const domains = Array.isArray(meta?.domains) && meta.domains.length
      ? meta.domains.map((item) => String(item || '').replace(/^\./, '')).filter(Boolean).slice(0, 8)
      : profile.domains;
    const record = {
      profileId: profile.id,
      label: profile.label,
      domains,
      encoding: 'electron-safeStorage:v1',
      cookieEnc: encryptParseAuthCookie(normalized),
      length: normalized.length,
      count: Number(meta?.count || 0) || countCookiePairs(normalized),
      expiresAt: meta?.expiresAt || null,
      savedAt: previous?.savedAt || now,
      updatedAt: now,
    };
    writeParseAuthStore({
      ...store,
      records: {
        ...(store.records || {}),
        [profile.id]: record,
      },
    });
    return localizedElectronResult(
      true,
      'PARSE_AUTH_SAVED',
      'auth.saved',
      { platform: profile.label },
      maskParseAuthRecord(record),
    );
  } catch (error) {
    return {
      success: false,
      code: String(error?.code || 'PARSE_AUTH_SAVE_FAILED'),
      messageKey: error?.messageKey,
      params: error?.params,
      message: normalizeError(error),
    };
  }
}

async function loadParseAuthRecord(profileId) {
  const profile = getParseAuthProfile(profileId);
  if (!profile) {
    return localizedElectronResult(false, 'PARSE_AUTH_PROFILE_UNKNOWN', 'auth.unknownLoad');
  }
  try {
    const store = readParseAuthStore();
    const record = store.records?.[profile.id];
    if (!record) {
      return localizedElectronResult(false, 'PARSE_AUTH_NOT_SAVED', 'auth.notSaved', { platform: profile.label });
    }
    const cookie = decryptParseAuthCookie(record);
    if (!cookie) {
      return localizedElectronResult(false, 'PARSE_AUTH_EMPTY', 'auth.empty', { platform: profile.label });
    }
    return {
      success: true,
      data: {
        ...maskParseAuthRecord(record),
        cookie,
      },
      code: 'PARSE_AUTH_LOADED',
      messageKey: 'auth.loaded',
      params: { platform: profile.label },
      message: electronT('auth.loaded', { platform: profile.label }),
    };
  } catch (error) {
    return { success: false, message: normalizeError(error) };
  }
}

function removeSavedParseAuthRecord(profileId) {
  const profile = getParseAuthProfile(profileId);
  if (!profile) return 0;
  const store = readParseAuthStore();
  if (!store.records?.[profile.id]) return 0;
  const nextRecords = { ...(store.records || {}) };
  delete nextRecords[profile.id];
  writeParseAuthStore({ ...store, records: nextRecords });
  return 1;
}

async function getParseAuthCookie(profileId) {
  const profile = getParseAuthProfile(profileId);
  if (!profile) {
    return localizedElectronResult(false, 'PARSE_AUTH_PROFILE_UNKNOWN', 'auth.unknownRead');
  }
  const ses = parseAuthSession();
  const all = [];
  for (const domain of profile.domains) {
    const variants = [domain, `.${domain}`];
    for (const variant of variants) {
      try {
        const cookies = await ses.cookies.get({ domain: variant });
        all.push(...cookies);
      } catch (_) {}
    }
  }
  const seen = new Set();
  const cookies = all.filter((cookie) => {
    if (!cookie?.name || !cookie?.value) return false;
    const domainOk = profile.domains.some((domain) => hostnameMatchesDomain(cookie.domain, domain));
    if (!domainOk) return false;
    const key = `${cookie.domain}\0${cookie.path}\0${cookie.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const cookieText = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  if (!cookieText) {
    return localizedElectronResult(false, 'PARSE_AUTH_COOKIE_MISSING', 'auth.missingCookie', { platform: profile.label });
  }
  return { success: true, data: summarizeCookie(cookieText, cookies, profile) };
}

async function clearParseAuthCookie(profileId) {
  const profile = getParseAuthProfile(profileId);
  if (!profile) {
    return localizedElectronResult(false, 'PARSE_AUTH_PROFILE_UNKNOWN', 'auth.unknownClear');
  }
  const ses = parseAuthSession();
  const all = [];
  for (const domain of profile.domains) {
    try {
      all.push(...await ses.cookies.get({ domain }));
      all.push(...await ses.cookies.get({ domain: `.${domain}` }));
    } catch (_) {}
  }
  let removed = 0;
  for (const cookie of all) {
    if (!profile.domains.some((domain) => hostnameMatchesDomain(cookie.domain, domain))) continue;
    const url = cookieUrlFor(cookie);
    if (!url || !cookie.name) continue;
    try {
      await ses.cookies.remove(url, cookie.name);
      removed += 1;
    } catch (_) {}
  }
  const savedRemoved = removeSavedParseAuthRecord(profile.id);
  return {
    success: true,
    data: { profileId: profile.id, label: profile.label, removed, savedRemoved },
    code: 'PARSE_AUTH_CLEARED',
    messageKey: savedRemoved ? 'auth.clearedAll' : 'auth.clearedCache',
    params: { platform: profile.label },
    message: electronT(savedRemoved ? 'auth.clearedAll' : 'auth.clearedCache', { platform: profile.label }),
  };
}

// ---------- 路径解析 (开发/打包双模式) ----------
function isPackaged() {
  return app.isPackaged;
}

function getResourcePath(rel) {
  if (isPackaged()) {
    return path.join(process.resourcesPath, rel);
  }
  return path.join(__dirname, '..', rel);
}

function getUserDataDir() {
  if (isPackaged()) {
    return app.getPath('userData');
  }
  const developmentOverride = String(process.env.T8PC_DEV_DATA_ROOT || '').trim();
  if (developmentOverride) {
    if (!path.isAbsolute(developmentOverride)) {
      throw new Error('T8PC_DEV_DATA_ROOT 必须是绝对路径');
    }
    return path.resolve(developmentOverride);
  }
  return path.resolve(__dirname, '..');
}

function normalizedCollaborationManagementToken(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : '';
}

const COLLABORATION_MANAGEMENT_CREATE_WAIT = new Int32Array(new SharedArrayBuffer(4));

function readManagementAuthorityAfterConcurrentCreate(reader, errorMessage) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const token = reader();
      if (token) return token;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 19) Atomics.wait(COLLABORATION_MANAGEMENT_CREATE_WAIT, 0, 0, 10);
  }
  if (lastError) throw lastError;
  throw new Error(errorMessage);
}

function writePrivateAuthorityRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    try { fs.chmodSync(file, 0o600); } catch (_) {}
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function developmentManagementAuthorityPath() {
  return path.join(path.resolve(__dirname, '..'), '.t8-collaboration-management-authority.json');
}

function readDevelopmentManagementAuthority() {
  const file = developmentManagementAuthorityPath();
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw new Error('本地协作管理 authority 文件无法读取');
  }
  const token = record?.schema === COLLABORATION_MANAGEMENT_SCHEMA
    ? normalizedCollaborationManagementToken(record.token)
    : '';
  if (!token) throw new Error('本地协作管理 authority 文件格式无效');
  return token;
}

function ensureDevelopmentManagementAuthority() {
  const existing = readDevelopmentManagementAuthority();
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString('base64url');
  const created = writePrivateAuthorityRecord(developmentManagementAuthorityPath(), {
    schema: COLLABORATION_MANAGEMENT_SCHEMA,
    version: 1,
    token,
  });
  return created
    ? token
    : readManagementAuthorityAfterConcurrentCreate(
      readDevelopmentManagementAuthority,
      '本地协作管理 authority 文件并发创建未完成',
    );
}

function electronManagementAuthorityPath() {
  return path.join(app.getPath('userData'), 'data', 'collaboration-management-authority.json');
}

function ensureElectronManagementEncryption() {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，已拒绝启动协作管理接口');
  }
}

function readElectronManagementAuthority() {
  const file = electronManagementAuthorityPath();
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw new Error('协作管理 authority 安全存储无法读取');
  }
  if (record?.schema !== ELECTRON_MANAGEMENT_SCHEMA
    || record?.encoding !== 'electron-safeStorage:v1'
    || typeof record?.tokenEnc !== 'string') {
    throw new Error('协作管理 authority 安全存储格式无效');
  }
  ensureElectronManagementEncryption();
  let token = '';
  try {
    token = normalizedCollaborationManagementToken(
      safeStorage.decryptString(Buffer.from(record.tokenEnc, 'base64')),
    );
  } catch (_) {
    throw new Error('协作管理 authority 安全存储无法解密');
  }
  if (!token) throw new Error('协作管理 authority token 格式无效');
  return token;
}

function ensureElectronManagementAuthority() {
  const existing = readElectronManagementAuthority();
  if (existing) return existing;
  ensureElectronManagementEncryption();
  const token = crypto.randomBytes(32).toString('base64url');
  const created = writePrivateAuthorityRecord(electronManagementAuthorityPath(), {
    schema: ELECTRON_MANAGEMENT_SCHEMA,
    version: 1,
    encoding: 'electron-safeStorage:v1',
    tokenEnc: safeStorage.encryptString(token).toString('base64'),
  });
  return created
    ? token
    : readManagementAuthorityAfterConcurrentCreate(
      readElectronManagementAuthority,
      '协作管理 authority 安全存储并发创建未完成',
    );
}

function ensureCollaborationManagementAuthority() {
  return isPackaged()
    ? ensureElectronManagementAuthority()
    : ensureDevelopmentManagementAuthority();
}

function isExactLocalCollaborationManagementUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && parsed.port === String(backendPort)
      && (parsed.pathname === '/api/collaboration'
        || parsed.pathname.startsWith('/api/collaboration/'));
  } catch (_) {
    return false;
  }
}

function installMainWindowManagementAuthority(window) {
  if (!window || window.isDestroyed() || !normalizedCollaborationManagementToken(collaborationManagementToken)) {
    throw new Error('主窗口缺少协作管理 authority');
  }
  const webContentsId = window.webContents.id;
  window.webContents.session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        `http://127.0.0.1:${backendPort}/api/collaboration`,
        `http://127.0.0.1:${backendPort}/api/collaboration/*`,
      ],
    },
    (details, callback) => {
      if (details.webContentsId !== webContentsId || !isExactLocalCollaborationManagementUrl(details.url)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      const requestHeaders = { ...(details.requestHeaders || {}) };
      for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === COLLABORATION_MANAGEMENT_HEADER) delete requestHeaders[name];
      }
      requestHeaders[COLLABORATION_MANAGEMENT_HEADER] = collaborationManagementToken;
      callback({ requestHeaders });
    },
  );
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  const rel = path.relative(parent, candidate);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

const pickedMediaRoots = new Set();
const PICK_MEDIA_META = new Map([
  ['.png', { kind: 'image', mime: 'image/png' }],
  ['.jpg', { kind: 'image', mime: 'image/jpeg' }],
  ['.jpeg', { kind: 'image', mime: 'image/jpeg' }],
  ['.webp', { kind: 'image', mime: 'image/webp' }],
  ['.gif', { kind: 'image', mime: 'image/gif' }],
  ['.bmp', { kind: 'image', mime: 'image/bmp' }],
  ['.avif', { kind: 'image', mime: 'image/avif' }],
  ['.tif', { kind: 'image', mime: 'image/tiff' }],
  ['.tiff', { kind: 'image', mime: 'image/tiff' }],
  ['.mp4', { kind: 'video', mime: 'video/mp4' }],
  ['.mov', { kind: 'video', mime: 'video/quicktime' }],
  ['.webm', { kind: 'video', mime: 'video/webm' }],
  ['.mkv', { kind: 'video', mime: 'video/x-matroska' }],
  ['.avi', { kind: 'video', mime: 'video/x-msvideo' }],
  ['.m4v', { kind: 'video', mime: 'video/x-m4v' }],
  ['.mp3', { kind: 'audio', mime: 'audio/mpeg' }],
  ['.wav', { kind: 'audio', mime: 'audio/wav' }],
  ['.ogg', { kind: 'audio', mime: 'audio/ogg' }],
  ['.m4a', { kind: 'audio', mime: 'audio/mp4' }],
  ['.flac', { kind: 'audio', mime: 'audio/flac' }],
  ['.aac', { kind: 'audio', mime: 'audio/aac' }],
  ['.glb', { kind: 'model3d', mime: 'model/gltf-binary' }],
  ['.gltf', { kind: 'model3d', mime: 'model/gltf+json' }],
  ['.obj', { kind: 'model3d', mime: 'model/obj' }],
  ['.fbx', { kind: 'model3d', mime: 'application/octet-stream' }],
  ['.stl', { kind: 'model3d', mime: 'model/stl' }],
  ['.usdz', { kind: 'model3d', mime: 'model/vnd.usdz+zip' }],
]);

function dragOutRoots() {
  const base = getUserDataDir();
  return [
    path.join(base, 'input'),
    path.join(base, 'output'),
    path.join(base, 'thumbnails'),
    path.join(base, 'data', 'input'),
    path.join(base, 'data', 'output'),
    path.join(base, 'data', 'thumbnails'),
  ];
}

function localOpenRoots() {
  return [...dragOutRoots(), ...pickedMediaRoots];
}

function pickMediaMeta(filePath, allowedKinds) {
  const meta = PICK_MEDIA_META.get(path.extname(filePath).toLowerCase()) || null;
  if (!meta || !allowedKinds.has(meta.kind)) return null;
  return meta;
}

function collectPickedDirectoryFiles(rootDir, allowedKinds) {
  const root = path.resolve(rootDir);
  const out = [];
  const stack = [root];
  while (stack.length && out.length < 5000) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (pickMediaMeta(full, allowedKinds)) out.push(full);
      if (out.length >= 5000) break;
    }
  }
  return out;
}

async function pickMediaFiles(options = {}) {
  const requestedKinds = Array.isArray(options.kinds) && options.kinds.length
    ? options.kinds
    : ['image', 'video'];
  const allowedKinds = new Set(requestedKinds.filter((kind) => ['image', 'video', 'audio', 'model3d'].includes(kind)));
  if (allowedKinds.size === 0) {
    return {
      success: false,
      code: 'PICK_MEDIA_KIND_REQUIRED',
      messageKey: 'dialogs.noMediaKinds',
      message: electronT('dialogs.noMediaKinds'),
    };
  }
  const directory = Boolean(options.directory);
  const properties = directory
    ? ['openDirectory']
    : ['openFile', ...(options.multiple === false ? [] : ['multiSelections'])];
  const filters = [
    {
      name: allowedKinds.size > 1
        ? electronT('dialogs.mixedMedia')
        : allowedKinds.has('image')
          ? electronT('dialogs.image')
          : allowedKinds.has('video')
            ? electronT('dialogs.video')
            : allowedKinds.has('audio')
              ? electronT('dialogs.audio')
              : electronT('dialogs.model3d'),
      extensions: Array.from(PICK_MEDIA_META.entries())
        .filter(([, meta]) => allowedKinds.has(meta.kind))
        .map(([ext]) => ext.replace(/^\./, '')),
    },
  ];
  const result = await dialog.showOpenDialog(mainWindow, { properties, filters });
  if (result.canceled || !result.filePaths?.length) {
    return { success: true, cancelled: true, files: [] };
  }
  const pickedPaths = directory
    ? result.filePaths.flatMap((dir) => collectPickedDirectoryFiles(dir, allowedKinds))
    : result.filePaths.filter((filePath) => pickMediaMeta(filePath, allowedKinds));
  const files = [];
  for (const filePath of pickedPaths) {
    const meta = pickMediaMeta(filePath, allowedKinds);
    if (!meta) continue;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      pickedMediaRoots.add(path.dirname(filePath));
      files.push({
        path: filePath,
        name: path.basename(filePath),
        kind: meta.kind,
        mime: meta.mime,
        size: stat.size,
        relativePath: path.basename(filePath),
      });
    } catch (_) {
      // 跳过读取失败的文件，保持批量选择不中断。
    }
  }
  return { success: true, files, truncated: pickedPaths.length >= 5000 };
}

async function pickDirectory(options = {}) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: typeof options.title === 'string'
      ? options.title.slice(0, 120)
      : electronT('dialogs.deliveryTitle'),
    buttonLabel: typeof options.buttonLabel === 'string'
      ? options.buttonLabel.slice(0, 40)
      : electronT('dialogs.deliveryButton'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { success: true, cancelled: true };
  }
  return {
    success: true,
    path: path.resolve(result.filePaths[0]),
  };
}

function resolveMountedDragOutFile(pathname) {
  const cleanPath = decodeURIComponent(String(pathname || '')).replace(/\\/g, '/');
  const base = getUserDataDir();
  const mounts = [
    { prefix: '/files/input/', dir: path.join(base, 'input') },
    { prefix: '/input/', dir: path.join(base, 'input') },
    { prefix: '/files/output/', dir: path.join(base, 'output') },
    { prefix: '/output/', dir: path.join(base, 'output') },
    { prefix: '/files/thumbnails/', dir: path.join(base, 'thumbnails') },
    { prefix: '/thumbnails/', dir: path.join(base, 'thumbnails') },
    // 兼容早期开发数据目录或用户手动迁移后的 data/* 结构。
    { prefix: '/data/input/', dir: path.join(base, 'data', 'input') },
    { prefix: '/data/output/', dir: path.join(base, 'data', 'output') },
    { prefix: '/data/thumbnails/', dir: path.join(base, 'data', 'thumbnails') },
  ];
  for (const mount of mounts) {
    if (!cleanPath.startsWith(mount.prefix)) continue;
    const rel = cleanPath.slice(mount.prefix.length);
    const resolved = path.resolve(mount.dir, rel);
    if (!isPathInside(mount.dir, resolved)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    return resolved;
  }
  return null;
}

async function openLocalPath(targetPath) {
  const raw = String(targetPath || '').trim();
  if (!raw) return { success: false, message: 'empty path' };
  const resolved = path.resolve(raw);
  if (!localOpenRoots().some((root) => isPathInside(root, resolved))) {
    return { success: false, message: 'path is outside allowed local folders', path: resolved };
  }
  if (!fs.existsSync(resolved)) {
    return { success: false, message: 'path does not exist', path: resolved };
  }
  const message = await shell.openPath(resolved);
  if (message) return { success: false, message, path: resolved };
  return { success: true, path: resolved };
}

function isLocalHostForDragOut(parsed) {
  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  const host = String(parsed.hostname || '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function resolveDragOutFile(payload) {
  const raw = String(payload?.path || payload?.url || '').trim();
  if (!raw) return null;

  try {
    if (/^[a-z]:[\\/]/i.test(raw)) {
      const local = path.resolve(raw);
      if (!dragOutRoots().some((root) => isPathInside(root, local))) return null;
      return fs.existsSync(local) && fs.statSync(local).isFile() ? local : null;
    }

    const parsed = new URL(raw, `http://127.0.0.1:${backendPort}`);
    if (parsed.protocol === 'file:') {
      const local = path.resolve(fileURLToPath(parsed));
      if (!dragOutRoots().some((root) => isPathInside(root, local))) return null;
      return fs.existsSync(local) && fs.statSync(local).isFile() ? local : null;
    }
    if (isLocalHostForDragOut(parsed)) {
      return resolveMountedDragOutFile(parsed.pathname);
    }
  } catch (error) {
    dbgLog(`[drag-out] resolve failed: ${normalizeError(error)}`);
  }
  return null;
}

function dragOutIconForFile(filePath, kind) {
  const ext = path.extname(filePath).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|bmp|avif|ico)$/i.test(ext)) {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      return image.resize({ width: 64, height: 64, quality: 'best' });
    }
  }
  const color = kind === 'video' ? '#38bdf8' : kind === 'audio' ? '#facc15' : '#34d399';
  const label = kind === 'video' ? 'VID' : kind === 'audio' ? 'AUD' : 'T8';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect x="8" y="8" width="80" height="80" rx="18" fill="#111827"/><rect x="14" y="14" width="68" height="68" rx="14" fill="${color}"/><text x="48" y="56" font-family="Arial,sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#111827">${label}</text></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function sendDragOutStatus(event, payload, status) {
  try {
    event.sender.send('t8pc:drag-file-out-status', {
      requestId: typeof payload?.requestId === 'string' ? payload.requestId.slice(0, 120) : '',
      success: !!status.success,
      message: String(status.message || ''),
      code: typeof status.code === 'string' ? status.code : undefined,
      messageKey: typeof status.messageKey === 'string' ? status.messageKey : undefined,
      params: status.params && typeof status.params === 'object' ? status.params : undefined,
      file: status.file ? path.basename(String(status.file)) : '',
    });
  } catch (error) {
    dbgLog(`[drag-out] status reply failed: ${normalizeError(error)}`);
  }
}

// ---------- 日志 ----------
function dbgLog(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logBuffer.push(line);
  if (logBuffer.length > 500) logBuffer.shift();
  appendToLogWindow(line);
}

function appendToLogWindow(msg) {
  if (logWindow && !logWindow.isDestroyed()) {
    const safe = JSON.stringify(msg + '\n');
    logWindow.webContents
      .executeJavaScript(
        `(function(){var e=document.getElementById('log');if(e){e.textContent+=${safe};e.scrollTop=e.scrollHeight;}})()`
      )
      .catch(() => {});
  }
}

function normalizeError(error) {
  if (!error) return 'unknown error';
  if (error.message) return error.message;
  return String(error);
}

function localizedElectronError(messageKey, code, params = {}) {
  const error = new Error(electronT(messageKey, params));
  error.code = code;
  error.messageKey = messageKey;
  error.params = params;
  return error;
}

function localizedElectronResult(success, code, messageKey, params = {}, data) {
  return {
    success,
    code,
    messageKey,
    params,
    message: electronT(messageKey, params),
    ...(data === undefined ? {} : { data }),
  };
}

function emitUpdaterStatus(patch = {}) {
  const nextState = {
    ...updaterState,
    ...patch,
    currentVersion: APP_VERSION,
    packaged: isPackaged(),
    updatedAt: new Date().toISOString(),
  };
  if (nextState.messageKey) {
    nextState.message = electronT(nextState.messageKey, nextState.messageParams || {});
  }
  updaterState = nextState;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('t8pc:updater-status', updaterState);
  }
  return updaterState;
}

function applyElectronLocale(locale) {
  const normalized = normalizeElectronLocale(locale);
  if (!normalized) {
    return {
      success: false,
      code: 'ELECTRON_LOCALE_UNSUPPORTED',
      messageKey: 'locale.unsupported',
      message: electronT('locale.unsupported'),
      locale: getElectronLocale(),
    };
  }
  setElectronLocale(normalized);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(electronT('app.mainTitle', { version: APP_VERSION }));
  }
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.setTitle(electronT('startup.windowTitle'));
  }
  emitUpdaterStatus();
  return { success: true, locale: normalized };
}

function ensureAutoUpdater() {
  if (!isPackaged()) {
    return {
      ok: false,
      code: 'UPDATER_DISABLED_IN_DEVELOPMENT',
      messageKey: 'updater.disabled',
      messageParams: {},
      message: electronT('updater.disabled'),
    };
  }
  if (autoUpdater) return { ok: true, updater: autoUpdater };
  try {
    const updaterModule = require('electron-updater');
    autoUpdater = updaterModule.autoUpdater;
    try {
      const log = require('electron-log');
      autoUpdater.logger = log;
      if (log.transports && log.transports.file) {
        log.transports.file.level = 'info';
      }
    } catch (logError) {
      dbgLog(`[updater] electron-log unavailable: ${normalizeError(logError)}`);
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => {
      dbgLog('[updater] checking GitHub Releases');
      emitUpdaterStatus({
        status: 'checking',
        messageKey: 'updater.checking',
        messageParams: {},
        progress: null,
        downloaded: false,
        error: null,
      });
    });
    autoUpdater.on('update-available', (info) => {
      const version = info && info.version ? info.version : null;
      dbgLog(`[updater] update available: ${version || 'unknown'}`);
      emitUpdaterStatus({
        status: 'available',
        availableVersion: version,
        messageKey: version ? 'updater.availableVersion' : 'updater.available',
        messageParams: version ? { version } : {},
        progress: null,
        downloaded: false,
        error: null,
      });
    });
    autoUpdater.on('update-not-available', () => {
      dbgLog('[updater] no update available');
      emitUpdaterStatus({
        status: 'not-available',
        messageKey: 'updater.notAvailable',
        messageParams: {},
        progress: null,
        downloaded: false,
        error: null,
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      emitUpdaterStatus({
        status: 'downloading',
        messageKey: 'updater.downloading',
        messageParams: {},
        progress: {
          percent: Number(progress && progress.percent ? progress.percent : 0),
          transferred: Number(progress && progress.transferred ? progress.transferred : 0),
          total: Number(progress && progress.total ? progress.total : 0),
          bytesPerSecond: Number(progress && progress.bytesPerSecond ? progress.bytesPerSecond : 0),
        },
        downloaded: false,
        error: null,
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      const version = info && info.version ? info.version : updaterState.availableVersion;
      dbgLog(`[updater] update downloaded: ${version || 'unknown'}`);
      emitUpdaterStatus({
        status: 'downloaded',
        availableVersion: version || null,
        messageKey: process.platform === 'darwin'
          ? 'updater.downloadedMac'
          : 'updater.downloadedWindows',
        messageParams: {},
        progress: null,
        downloaded: true,
        error: null,
      });
    });
    autoUpdater.on('error', (error) => {
      const message = normalizeError(error);
      dbgLog(`[updater] error: ${message}`);
      emitUpdaterStatus({
        status: 'error',
        messageKey: 'updater.failed',
        messageParams: {},
        error: message,
        progress: null,
      });
    });

    return { ok: true, updater: autoUpdater };
  } catch (error) {
    const message = normalizeError(error);
    dbgLog(`[updater] init failed: ${message}`);
    return {
      ok: false,
      code: 'UPDATER_INIT_FAILED',
      messageKey: 'updater.failed',
      messageParams: {},
      message,
    };
  }
}

async function checkForUpdatesByUser() {
  const ready = ensureAutoUpdater();
  if (!ready.ok) {
    return {
      success: false,
      code: ready.code,
      messageKey: ready.messageKey,
      params: ready.messageParams,
      message: ready.message,
      status: emitUpdaterStatus({
        status: 'disabled',
        messageKey: ready.messageKey || 'updater.disabled',
        messageParams: ready.messageParams || {},
        error: ready.code === 'UPDATER_INIT_FAILED' ? ready.message : null,
      }),
    };
  }
  try {
    const result = await ready.updater.checkForUpdates();
    return { success: true, info: result && result.updateInfo ? result.updateInfo : null, status: updaterState };
  } catch (error) {
    const message = normalizeError(error);
    return {
      success: false,
      code: 'UPDATER_CHECK_FAILED',
      messageKey: 'updater.checkFailed',
      params: {},
      message,
      status: emitUpdaterStatus({ status: 'error', messageKey: 'updater.checkFailed', messageParams: {}, error: message }),
    };
  }
}

async function downloadAvailableUpdate() {
  const ready = ensureAutoUpdater();
  if (!ready.ok) {
    return {
      success: false,
      code: ready.code,
      messageKey: ready.messageKey,
      params: ready.messageParams,
      message: ready.message,
      status: emitUpdaterStatus({
        status: 'disabled',
        messageKey: ready.messageKey || 'updater.disabled',
        messageParams: ready.messageParams || {},
        error: ready.code === 'UPDATER_INIT_FAILED' ? ready.message : null,
      }),
    };
  }
  try {
    await ready.updater.downloadUpdate();
    return { success: true, status: updaterState };
  } catch (error) {
    const message = normalizeError(error);
    return {
      success: false,
      code: 'UPDATER_DOWNLOAD_FAILED',
      messageKey: 'updater.downloadFailed',
      params: {},
      message,
      status: emitUpdaterStatus({ status: 'error', messageKey: 'updater.downloadFailed', messageParams: {}, error: message }),
    };
  }
}

function installDownloadedUpdate() {
  const ready = ensureAutoUpdater();
  if (!ready.ok) {
    return {
      success: false,
      code: ready.code,
      messageKey: ready.messageKey,
      params: ready.messageParams,
      message: ready.message,
      status: emitUpdaterStatus({
        status: 'disabled',
        messageKey: ready.messageKey || 'updater.disabled',
        messageParams: ready.messageParams || {},
        error: ready.code === 'UPDATER_INIT_FAILED' ? ready.message : null,
      }),
    };
  }
  if (!updaterState.downloaded) {
    return {
      success: false,
      code: 'UPDATER_NOT_DOWNLOADED',
      messageKey: 'updater.notDownloaded',
      params: {},
      message: electronT('updater.notDownloaded'),
      status: emitUpdaterStatus({ messageKey: 'updater.notDownloaded', messageParams: {} }),
    };
  }
  // Windows keeps the NSIS installer visible. macOS installs the signed ZIP
  // through Squirrel.Mac and restarts without a separate NSIS-style wizard.
  const isMac = process.platform === 'darwin';
  setImmediate(() => ready.updater.quitAndInstall(isMac, true));
  return {
    success: true,
    status: emitUpdaterStatus({
      status: 'installing',
      messageKey: isMac
        ? 'updater.installingMac'
        : 'updater.installingWindows',
      messageParams: {},
    }),
  };
}

function startInitialUpdateCheck() {
  if (initialUpdateCheckStarted) return;
  initialUpdateCheckStarted = true;
  if (!isPackaged()) {
    emitUpdaterStatus({ status: 'disabled', messageKey: 'updater.disabled', messageParams: {}, error: null });
    return;
  }
  emitUpdaterStatus({ status: 'idle', messageKey: 'updater.idle', messageParams: {}, error: null });
  setTimeout(() => {
    void checkForUpdatesByUser();
  }, 2500);
}

// ---------- 端口探测 ----------
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(preferred, maxTries = 20) {
  for (let i = 0; i < maxTries; i++) {
    if (await isPortFree(preferred + i)) return preferred + i;
  }
  return preferred + Math.floor(Math.random() * 900) + 100;
}

function developmentBackendPortPreference() {
  if (isPackaged()) return 18766;
  const candidate = Number.parseInt(String(process.env.T8PC_DEV_BACKEND_PORT || ''), 10);
  if (!Number.isInteger(candidate) || candidate < 1024 || candidate > 65535) {
    return 18766;
  }
  return candidate;
}

// ---------- 启动后端 ----------
async function startBackend() {
  delete process.env.T8_COLLAB_MANAGEMENT_TOKEN;
  backendPort = await findFreePort(developmentBackendPortPreference());
  backendInstanceId = crypto.randomBytes(32).toString('base64url');
  dbgLog(`[backend] picked port=${backendPort}`);
  collaborationManagementToken = ensureCollaborationManagementAuthority();

  // 把环境变量传给后端
  process.env.PORT = String(backendPort);
  process.env.HOST = '127.0.0.1';
  process.env.T8PC_USER_DATA = getUserDataDir();
  process.env.T8PC_PACKAGED = isPackaged() ? '1' : '0';
  process.env.T8PC_APP_VERSION = APP_VERSION;
  process.env.T8PC_BACKEND_INSTANCE_ID = backendInstanceId;
  process.env.T8PC_RES = isPackaged() ? process.resourcesPath : path.resolve(__dirname, '..');
  process.env.T8PC_FRONTEND_URL = developmentFrontendUrl() || `http://127.0.0.1:${backendPort}`;
  // 生产模式让 Express 同时托管前端 dist/
  process.env.T8PC_FRONTEND_DIST = isPackaged()
    ? path.join(process.resourcesPath, 'frontend')
    : path.resolve(__dirname, '..', 'dist');


  // The backend shares Electron's main process in packaged builds. Route its
  // ordinary HTTP(S) fetches through Chromium so Windows system proxy, PAC,
  // authenticated proxy, TUN and native IPv4/IPv6 behavior are actually used.
  // Requests with an explicit Undici dispatcher remain on Node's stack because
  // they are deliberate fresh-connection/DNS recovery paths.
  const defaultNetworkSession = session.defaultSession;
  // Electron 33 copies Chromium response headers into Undici Headers without
  // first preserving UTF-8 values as a ByteString. A Provider that echoes a
  // Chinese Windows username, local path or filename in Content-Disposition
  // can therefore throw an uncaught main-process TypeError. Normalize only
  // those response header values at the Chromium boundary; filesystem paths,
  // URLs and response bodies remain unchanged.
  installChromiumResponseHeaderBridge(defaultNetworkSession);
  installGlobalSystemFetchBridge({
    chromiumFetch: defaultNetworkSession.fetch.bind(defaultNetworkSession),
    refreshNetwork: async () => {
      const refreshTasks = [];
      try {
        refreshTasks.push(defaultNetworkSession.forceReloadProxyConfig());
      } catch (_) {}
      try {
        if (typeof defaultNetworkSession.clearHostResolverCache === 'function') {
          refreshTasks.push(defaultNetworkSession.clearHostResolverCache());
        }
      } catch (_) {}
      await Promise.allSettled(refreshTasks);
    },
    refreshIntervalMs: 3_000,
    resolveHost: defaultNetworkSession.resolveHost.bind(defaultNetworkSession),
  });
  // 同进程内加载后端,先注册 T8ENC1 + bytenode loader
  try {
    require('./loader.cjs');
    let entry;
    if (isPackaged()) {
      // 打包后:加载加密的字节码入口
      entry = path.join(process.resourcesPath, 'backend-enc', 'server.t8c');
      dbgLog(`[backend] loading encrypted entry: ${entry}`);
    } else {
      // 开发模式:直接 require 源码
      entry = path.resolve(__dirname, '..', 'backend', 'src', 'server.js');
      dbgLog(`[backend] loading dev entry: ${entry}`);
    }
    process.env.T8_COLLAB_MANAGEMENT_TOKEN = collaborationManagementToken;
    try {
      backendModule = require(entry);
    } finally {
      delete process.env.T8_COLLAB_MANAGEMENT_TOKEN;
      delete process.env.T8PC_BACKEND_INSTANCE_ID;
    }
    const start = await backendModule?.serverStartPromise;
    if (!start || start.state !== 'listening') {
      await backendModule?.gracefulShutdown?.('LISTEN_ERROR');
      const error = start?.error || new Error('后端未返回可验证的监听状态');
      throw error;
    }
    if (typeof backendModule?.agentControlApprovalService?.subscribeMutations === 'function') {
      agentControlMutationUnsubscribe?.();
      agentControlMutationUnsubscribe = backendModule.agentControlApprovalService.subscribeMutations((event) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('t8pc:agent-control:canvas-mutated', event);
      });
    }
    dbgLog(`[backend] started in-process on http://127.0.0.1:${backendPort}`);
  } catch (e) {
    dbgLog(`[backend] FAILED to start: ${e && e.stack ? e.stack : e}`);
    throw e;
  }
}

function stopLegacyBackendProcess() {
  if (!backendProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'], {
        windowsHide: true,
      });
    } else {
      backendProcess.kill('SIGTERM');
    }
  } catch (_) {}
  backendProcess = null;
}

function settleWithinElectronDeadline(work, timeoutMs, onTimeout) {
  const deadlineMs = Math.max(1, Math.trunc(Number(timeoutMs) || 1));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try {
        finish(resolve, onTimeout?.());
      } catch (error) {
        finish(reject, error);
      }
    }, deadlineMs);
    Promise.resolve(work).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function shutdownBackendForElectron(reason = 'ELECTRON_QUIT') {
  if (!backendShutdownPromise) {
    const shutdownWork = (async () => {
      if (backendStartPromise) {
        try { await backendStartPromise; } catch (_) { /* cleanup the partially started module below */ }
      }
      try {
        const outcome = await backendModule?.gracefulShutdown?.(reason);
        if (outcome?.storageDeferred === true) {
          dbgLog('[backend] bounded shutdown left tracked work deferred; waiting within the Electron cutoff');
        }
        await backendModule?.waitForRuntimeStorageCloseLifecycle?.();
        return outcome || null;
      } finally {
        try { agentControlMutationUnsubscribe?.(); } catch (_) {}
        agentControlMutationUnsubscribe = null;
        stopLegacyBackendProcess();
      }
    })();
    backendShutdownPromise = settleWithinElectronDeadline(
      shutdownWork,
      ELECTRON_BACKEND_SHUTDOWN_DEADLINE_MS,
      () => {
        dbgLog(`[backend] Electron shutdown deadline reached after ${ELECTRON_BACKEND_SHUTDOWN_DEADLINE_MS}ms (${reason})`);
        stopLegacyBackendProcess();
        return { timedOut: true, reason };
      },
    );
  }
  return backendShutdownPromise;
}

// ---------- 创建主窗口 ----------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b0d',
    title: electronT('app.mainTitle', { version: APP_VERSION }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  installMainWindowManagementAuthority(mainWindow);

  const backendUrl = `http://127.0.0.1:${backendPort}/`;
  const url = developmentFrontendUrl() || backendUrl;
  const pendingMainWindow = mainWindow;
  let mainFrontendLoaded = false;
  let mainWindowReadyToShow = false;
  let mainWindowRevealed = false;
  let frontendInteractiveSignaled = false;
  let frontendLoadGeneration = 0;
  let frontendLoadInFlight = null;
  let lastFrontendLoadError = null;
  let revealDeadlineTimer = null;

  const clearRevealDeadline = () => {
    if (!revealDeadlineTimer) return;
    clearTimeout(revealDeadlineTimer);
    revealDeadlineTimer = null;
  };
  const closeStartupShell = () => {
    setTimeout(() => {
      if (logWindow && !logWindow.isDestroyed()) logWindow.close();
    }, 250);
  };
  const signalFrontendInteractive = () => {
    if (frontendInteractiveSignaled || !mainFrontendLoaded || !mainWindowRevealed) return;
    frontendInteractiveSignaled = true;
    backendModule?.markFrontendInteractive?.('electron-main-window-visible');
  };
  const revealMainWindowWhenReady = (options = {}) => {
    const force = options.force === true;
    if (mainWindowRevealed) {
      signalFrontendInteractive();
      return;
    }
    if (!force && (!mainFrontendLoaded || !mainWindowReadyToShow)) return;
    if (electronQuitRequested || pendingMainWindow.isDestroyed()) return;
    mainWindowRevealed = true;
    clearRevealDeadline();
    pendingMainWindow.show();
    markElectronStartupStage(
      'main-window-visible',
      options.reason || (force ? 'forced' : 'ready-to-show'),
    );
    signalFrontendInteractive();
    startInitialUpdateCheck();
    closeStartupShell();
  };
  const markMainFrontendLoaded = (source = 'primary') => {
    mainFrontendLoaded = true;
    lastFrontendLoadError = null;
    markElectronStartupStage('main-window-loaded', source);
    revealMainWindowWhenReady();
    signalFrontendInteractive();
  };
  const escapeStartupHtml = (value) => String(value || '').replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character],
  );
  const showMainWindowStartupFailure = async (error, reason = 'frontend-load-failed') => {
    if (electronQuitRequested || pendingMainWindow.isDestroyed()) return false;
    frontendLoadGeneration += 1;
    frontendLoadInFlight = null;
    mainFrontendLoaded = false;
    lastFrontendLoadError = error || lastFrontendLoadError || new Error(electronT('startup.frontendDeadline'));
    clearRevealDeadline();
    const detail = escapeStartupHtml(normalizeError(lastFrontendLoadError)).slice(0, 800);
    const failureHtml = '<!doctype html><html lang="' + getElectronLocale() + '"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeStartupHtml(electronT('startup.failureDocumentTitle')) + '</title>' +
      '<style>html,body{margin:0;min-height:100%;background:#0b0b0d;color:#eef2f4;font-family:system-ui,sans-serif}' +
      'main{max-width:720px;margin:10vh auto;padding:36px;border:1px solid #344148;border-radius:20px;background:#12171a}' +
      'h1{font-size:26px;margin:0 0 14px;color:#ffcf72}p{line-height:1.7;color:#b8c4c9}' +
      'code{display:block;overflow-wrap:anywhere;padding:14px;border-radius:10px;background:#090c0e;color:#ff9aa8}' +
      '.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}a{padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700}' +
      '.retry{background:#91e65c;color:#10210a}.backend{border:1px solid #5fd8f4;color:#8be7fb}</style></head><body><main>' +
      '<h1>' + escapeStartupHtml(electronT('startup.failureHeading')) + '</h1><p>' + escapeStartupHtml(electronT('startup.failureBody')) + '</p>' +
      '<code>' + detail + '</code><div class="actions"><a class="retry" href="' +
      MAIN_WINDOW_STARTUP_RETRY_URL + '">' + escapeStartupHtml(electronT('startup.retry')) + '</a><a class="backend" href="' +
      MAIN_WINDOW_STARTUP_BACKEND_URL + '">' + escapeStartupHtml(electronT('startup.openBackend')) + '</a></div></main></body></html>';
    markElectronStartupStage('main-window-local-error', reason);
    const failureLoad = pendingMainWindow.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(failureHtml),
    );
    try {
      await settleWithinElectronDeadline(
        failureLoad,
        ELECTRON_MAIN_WINDOW_ERROR_PAGE_LOAD_DEADLINE_MS,
        () => ({ timedOut: true }),
      );
    } catch (failureError) {
      dbgLog('[main] local startup error page failed: ' + normalizeError(failureError));
    }
    if (electronQuitRequested || pendingMainWindow.isDestroyed()) return false;
    mainWindowReadyToShow = true;
    revealMainWindowWhenReady({ force: true, reason });
    return true;
  };

  dbgLog('[main] loading ' + url);
  const loadMainWindowUrl = () => mainWindow.loadURL(url);
  const loadMainWindowWithRetry = async (targetUrl = url, options = {}) => {
    const generation = ++frontendLoadGeneration;
    const attempts = Math.max(
      1,
      Number(options.attempts)
        || (targetUrl === backendUrl ? 4 : ELECTRON_FRONTEND_LOAD_RETRY_ATTEMPTS),
    );
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (generation !== frontendLoadGeneration) return false;
      if (electronQuitRequested || pendingMainWindow.isDestroyed()) return false;
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, ELECTRON_FRONTEND_LOAD_RETRY_DELAY_MS));
      }
      if (generation !== frontendLoadGeneration) return false;
      try {
        if (targetUrl === url) await loadMainWindowUrl();
        else await pendingMainWindow.loadURL(targetUrl);
        if (generation !== frontendLoadGeneration) return false;
        markMainFrontendLoaded(options.source || (targetUrl === backendUrl ? 'backend' : 'primary'));
        if (attempt > 1) markElectronStartupStage('frontend-url-ready', 'attempt=' + attempt);
        return true;
      } catch (loadError) {
        lastError = loadError;
        lastFrontendLoadError = loadError;
        dbgLog(
          '[main] frontend load attempt ' + attempt + '/' + attempts +
          ' failed: ' + normalizeError(loadError),
        );
      }
    }
    if (
      options.allowBackendFallback !== false
      && targetUrl === url
      && url !== backendUrl
      && generation === frontendLoadGeneration
      && !electronQuitRequested
      && !pendingMainWindow.isDestroyed()
    ) {
      dbgLog('[main] development frontend unavailable; falling back to packaged backend UI');
      try {
        await pendingMainWindow.loadURL(backendUrl);
        if (generation !== frontendLoadGeneration) return false;
        markMainFrontendLoaded('backend-fallback');
        markElectronStartupStage('frontend-url-fallback-ready');
        return true;
      } catch (fallbackError) {
        lastError = fallbackError;
        lastFrontendLoadError = fallbackError;
      }
    }
    throw lastError || new Error(electronT('startup.frontendLoadFailed'));
  };
  const beginMainWindowLoad = (targetUrl = url, options = {}) => {
    mainFrontendLoaded = false;
    const operation = loadMainWindowWithRetry(targetUrl, options);
    frontendLoadInFlight = operation;
    void operation.catch((loadError) => {
      markElectronStartupStage('frontend-url-failed', normalizeError(loadError));
      dbgLog('[main] frontend load failed: ' + normalizeError(loadError));
      return showMainWindowStartupFailure(
        loadError,
        options.reason || 'frontend-load-failed',
      );
    }).finally(() => {
      if (frontendLoadInFlight === operation) frontendLoadInFlight = null;
    });
    return operation;
  };
  beginMainWindowLoad(url, { allowBackendFallback: true, source: 'initial' });

  revealDeadlineTimer = setTimeout(() => {
    revealDeadlineTimer = null;
    if (electronQuitRequested || pendingMainWindow.isDestroyed() || mainWindowRevealed) return;
    if (mainFrontendLoaded) {
      mainWindowReadyToShow = true;
      revealMainWindowWhenReady({ force: true, reason: 'ready-to-show-deadline' });
      return;
    }
    void showMainWindowStartupFailure(
      lastFrontendLoadError || new Error(electronT('startup.frontendTimeout')),
      'frontend-reveal-deadline',
    );
  }, ELECTRON_MAIN_WINDOW_REVEAL_DEADLINE_MS);

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isVibeXRhLoginUrl(targetUrl)) {
      return { action: 'allow', overrideBrowserWindowOptions: createVibeXRhLoginWindowOptions() };
    }
    void openExternalUrl(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (childWindow, details) => {
    if (isVibeXRhLoginUrl(details?.url)) {
      configureVibeXRhLoginWindow(childWindow);
    }
  });

  mainWindow.webContents.on('did-frame-finish-load', () => {
    scheduleVibeXFrameUiPatch(250);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    scheduleVibeXFrameUiPatch(350);
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl === MAIN_WINDOW_STARTUP_RETRY_URL) {
      event.preventDefault();
      beginMainWindowLoad(url, {
        allowBackendFallback: true,
        source: 'manual-retry',
        reason: 'manual-retry-failed',
      });
      return;
    }
    if (targetUrl === MAIN_WINDOW_STARTUP_BACKEND_URL) {
      event.preventDefault();
      beginMainWindowLoad(backendUrl, {
        attempts: 4,
        allowBackendFallback: false,
        source: 'manual-backend',
        reason: 'manual-backend-failed',
      });
      return;
    }
    if (String(targetUrl || '').startsWith(url) || String(targetUrl || '').startsWith(backendUrl)) return;
    if (!isSafeExternalUrl(targetUrl)) return;
    if (isVibeXRhLoginUrl(targetUrl)) {
      event.preventDefault();
      void openVibeXRhLoginWindow(targetUrl);
      return;
    }
    event.preventDefault();
    void openExternalUrl(targetUrl);
  });

  pendingMainWindow.once('ready-to-show', () => {
    mainWindowReadyToShow = true;
    revealMainWindowWhenReady();
  });

  mainWindow.on('closed', () => {
    clearRevealDeadline();
    frontendLoadGeneration += 1;
    mainWindow = null;
  });

  mainWindow.on('resize', () => {
    scheduleVibeXFrameUiPatch(250);
  });

  // F12 打开 DevTools
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// ---------- 启动时显示加载窗 ----------
function createLogWindow() {
  const tmpDir = app.getPath('temp');
  const logHtmlPath = path.join(tmpDir, 't8pc-app-log.html');
  const html = `<!doctype html><html lang="${getElectronLocale()}"><head><meta charset="utf-8"><title>${electronT('startup.documentTitle')}</title>
<style>html,body{margin:0;padding:0;background:#0b0b0d;color:#9be9ff;font-family:Consolas,monospace;}
.h{padding:14px 18px;border-bottom:1px solid #222;font-size:14px;display:flex;align-items:center;gap:10px;}
.h b{color:#ffd76b;}
.spin{width:14px;height:14px;border-radius:50%;border:2px solid #24414a;border-top-color:#69e5ff;animation:spin 1s linear infinite;flex:none}
#log{padding:12px 18px;white-space:pre-wrap;line-height:1.5;font-size:12px;max-height:260px;overflow:auto;}
@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none;border-top-color:#ffd76b}}
</style></head><body>
<div class="h"><span class="spin" aria-hidden="true"></span>🐧 <b>${electronT('app.name')}</b><span>${electronT('startup.safeStarting')}</span><span style="margin-left:auto;color:#666;">v${APP_VERSION}</span></div>
<div id="log">${electronT('startup.initialStatus')}\n</div>
</body></html>`;
  fs.writeFileSync(logHtmlPath, html, 'utf-8');

  logWindow = new BrowserWindow({
    width: 720,
    height: 360,
    show: false,
    frame: true,
    backgroundColor: '#0b0b0d',
    title: electronT('startup.windowTitle'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  logWindow.removeMenu();
  const pendingLogWindow = logWindow;
  startupShellReadyPromise = new Promise((resolve) => {
    let settled = false;
    const ready = (outcome) => {
      if (settled) return;
      settled = true;
      if (!pendingLogWindow.isDestroyed()) pendingLogWindow.show();
      markElectronStartupStage('startup-shell-visible', outcome);
      resolve(outcome);
    };
    pendingLogWindow.once('ready-to-show', () => ready('ready-to-show'));
    pendingLogWindow.webContents.once('did-finish-load', () => ready('did-finish-load'));
    pendingLogWindow.loadFile(logHtmlPath).catch((error) => ready(`load-failed:${normalizeError(error)}`));
    setTimeout(() => ready('paint-deadline'), ELECTRON_STARTUP_SHELL_PAINT_DEADLINE_MS);
  });
  logWindow.on('closed', () => {
    logWindow = null;
  });
}

// ---------- IPC ----------
function assertTrustedMainRenderer(event) {
  if (!mainWindow
    || mainWindow.isDestroyed()
    || !event?.sender
    || event.sender.id !== mainWindow.webContents.id) {
    throw localizedElectronError('agent.rendererForbidden', 'AGENT_CONTROL_RENDERER_FORBIDDEN');
  }
}

function requireAgentControlAuthService() {
  const service = backendModule?.agentControlAuthService;
  if (!service) {
    throw localizedElectronError('agent.serviceNotReady', 'AGENT_CONTROL_NOT_READY');
  }
  return service;
}

function requireAgentControlApprovalService() {
  const service = backendModule?.agentControlApprovalService;
  if (!service) {
    throw localizedElectronError('agent.approvalNotReady', 'AGENT_CONTROL_NOT_READY');
  }
  return service;
}

function agentControlIpcResult(action) {
  try {
    return { success: true, data: action() };
  } catch (error) {
    return {
      success: false,
      code: String(error?.code || 'AGENT_CONTROL_IPC_FAILED'),
      messageKey: typeof error?.messageKey === 'string' ? error.messageKey : undefined,
      params: error?.params && typeof error.params === 'object' ? error.params : undefined,
      message: normalizeError(error),
    };
  }
}

ipcMain.handle('t8pc:get-info', () => ({
  packaged: isPackaged(),
  backendPort,
  userData: getUserDataDir(),
  version: APP_VERSION,
  locale: getElectronLocale(),
  updater: updaterState,
}));

ipcMain.handle('t8pc:locale:get', () => ({ locale: getElectronLocale() }));
ipcMain.handle('t8pc:locale:set', (_event, locale) => applyElectronLocale(locale));

ipcMain.handle('t8pc:open-external', async (_event, url) => openExternalUrl(url));
ipcMain.handle('t8pc:open-path', async (_event, targetPath) => openLocalPath(targetPath));
ipcMain.handle('t8pc:pick-media-files', async (_event, options) => pickMediaFiles(options));
ipcMain.handle('t8pc:pick-directory', async (_event, options) => pickDirectory(options));
ipcMain.handle('t8pc:parse-auth:login', async (_event, profileId) => openParseAuthWindow(profileId));
ipcMain.handle('t8pc:parse-auth:get-cookie', async (_event, profileId) => getParseAuthCookie(profileId));
ipcMain.handle('t8pc:parse-auth:list-saved', async (_event, profileId) => listSavedParseAuth(profileId));
ipcMain.handle('t8pc:parse-auth:save', async (_event, profileId, cookieText, meta) => saveParseAuthRecord(profileId, cookieText, meta));
ipcMain.handle('t8pc:parse-auth:load', async (_event, profileId) => loadParseAuthRecord(profileId));
ipcMain.handle('t8pc:parse-auth:clear', async (_event, profileId) => clearParseAuthCookie(profileId));
ipcMain.handle('t8pc:agent-control:connection-summary', (event) => agentControlIpcResult(() => {
  assertTrustedMainRenderer(event);
  return requireAgentControlAuthService().connectionSummary();
}));
ipcMain.handle('t8pc:agent-control:list-pending', (event) => agentControlIpcResult(() => {
  assertTrustedMainRenderer(event);
  return requireAgentControlAuthService().listPendingPairings();
}));
ipcMain.handle('t8pc:agent-control:approve', (event, input) => agentControlIpcResult(() => {
  assertTrustedMainRenderer(event);
  return requireAgentControlAuthService().approvePairing({
    pairingId: String(input?.pairingId || ''),
    userCode: String(input?.userCode || ''),
    approvedScopes: Array.isArray(input?.approvedScopes) ? input.approvedScopes : [],
    approvedBy: 'desktop-owner',
  });
}));
ipcMain.handle('t8pc:agent-control:deny', (event, pairingId) => agentControlIpcResult(() => {
  assertTrustedMainRenderer(event);
  return requireAgentControlAuthService().denyPairing(String(pairingId || ''));
}));
ipcMain.handle('t8pc:agent-control:list-approvals', (event) => agentControlIpcResult(() => {
  assertTrustedMainRenderer(event);
  return requireAgentControlApprovalService().listPending();
}));
ipcMain.handle('t8pc:agent-control:approve-operation', (event, approvalRequestId) => agentControlIpcResult(() => {
  assertTrustedMainRenderer(event);
  return requireAgentControlApprovalService().approve(String(approvalRequestId || ''));
}));
ipcMain.handle('t8pc:agent-control:deny-operation', (event, approvalRequestId) => agentControlIpcResult(() => {
  assertTrustedMainRenderer(event);
  return requireAgentControlApprovalService().deny(String(approvalRequestId || ''));
}));
ipcMain.handle('t8pc:updater:status', () => emitUpdaterStatus());
ipcMain.handle('t8pc:updater:check', async () => checkForUpdatesByUser());
ipcMain.handle('t8pc:updater:download', async () => downloadAvailableUpdate());
ipcMain.handle('t8pc:updater:install', () => installDownloadedUpdate());
ipcMain.on('t8pc:drag-file-out', (event, payload) => {
  try {
    const file = resolveDragOutFile(payload);
    if (!file) {
      const messageKey = 'drag.missing';
      const message = electronT(messageKey);
      dbgLog(`[drag-out] unsupported or missing file: ${String(payload?.url || payload?.path || '').slice(0, 180)}`);
      sendDragOutStatus(event, payload, {
        success: false,
        code: 'DRAG_FILE_NOT_LOCAL',
        messageKey,
        params: {},
        message,
      });
      return;
    }
    if (!event.sender || typeof event.sender.startDrag !== 'function') {
      throw localizedElectronError('drag.unsupported', 'DRAG_FILE_UNSUPPORTED');
    }
    event.sender.startDrag({
      file,
      icon: dragOutIconForFile(file, String(payload?.kind || '')),
    });
    sendDragOutStatus(event, payload, {
      success: true,
      code: 'DRAG_FILE_STARTED',
      messageKey: 'drag.started',
      params: {},
      message: electronT('drag.started'),
      file,
    });
  } catch (error) {
    const message = normalizeError(error);
    dbgLog(`[drag-out] startDrag failed: ${message}`);
    sendDragOutStatus(event, payload, {
      success: false,
      code: String(error?.code || 'DRAG_FILE_FAILED'),
      messageKey: typeof error?.messageKey === 'string' ? error.messageKey : undefined,
      params: error?.params && typeof error.params === 'object' ? error.params : undefined,
      message,
    });
  }
});

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  if (!ELECTRON_SINGLE_INSTANCE_OWNER || electronQuitRequested) return;
  initializeElectronLocale(getUserDataDir(), app.getLocale());
  createLogWindow();
  await waitForStartupShellPaint();
  markElectronStartupStage('backend-start-requested');
  try {
    backendStartPromise = startBackend();
    await backendStartPromise;
    markElectronStartupStage('backend-module-ready');
    if (electronQuitRequested) return;
    // 等后端真正可访问
    const backendReady = await waitForBackend(backendPort, backendInstanceId, 30);
    if (!backendReady) throw new Error(electronT('startup.backendNotReady', { port: backendPort }));
    markElectronStartupStage('backend-transport-ready');
    if (electronQuitRequested) return;
    createMainWindow();
  } catch (e) {
    markElectronStartupStage('startup-failed', normalizeError(e));
    dbgLog(`[fatal] ${e && e.stack ? e.stack : e}`);
    try {
      await shutdownBackendForElectron('STARTUP_FAILURE');
    } catch (shutdownError) {
      dbgLog(`[backend] startup failure cleanup failed: ${shutdownError && shutdownError.stack ? shutdownError.stack : shutdownError}`);
    }
  }
});

function waitForBackend(port, expectedInstanceId, maxTries = 30) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      n += 1;
      let settled = false;
      const retry = () => {
        if (settled) return;
        settled = true;
        if (n >= maxTries) resolve(false);
        else setTimeout(tick, 200);
      };
      const request = http.get({
        host: '127.0.0.1',
        port,
        path: '/api/status',
        headers: { Accept: 'application/json' },
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (body.length <= 64 * 1024) body += chunk;
          if (body.length > 64 * 1024) request.destroy(new Error('backend status response too large'));
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const status = JSON.parse(body);
            if (response.statusCode === 200
              && status?.ok === true
              && status?.service === 't8-penguin-canvas-backend'
              && status?.instanceId === expectedInstanceId
              && Number(status?.port) === Number(port)) {
              settled = true;
              resolve(true);
              return;
            }
          } catch (_) {}
          retry();
        });
      });
      request.setTimeout(1_000, () => request.destroy(new Error('backend status timeout')));
      request.on('error', retry);
    };
    tick();
  });
}

app.on('window-all-closed', () => {
  // Windows / Linux 关闭所有窗口直接退出
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  electronQuitRequested = true;
  if (!ELECTRON_SINGLE_INSTANCE_OWNER) return;
  if (electronQuitReady) return;
  event.preventDefault();
  if (!electronQuitFinalizationPromise) {
    electronQuitFinalizationPromise = shutdownBackendForElectron('ELECTRON_QUIT')
      .catch((error) => {
        dbgLog(`[backend] Electron quit cleanup failed: ${error && error.stack ? error.stack : error}`);
      })
      .finally(() => {
        electronQuitReady = true;
        app.quit();
      });
  }
});
