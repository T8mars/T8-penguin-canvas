const els = {
  backend: document.getElementById('backendInput'),
  autoScroll: document.getElementById('autoScrollInput'),
  filterSmall: document.getElementById('filterSmallInput'),
  pin: document.getElementById('pinBtn'),
  scan: document.getElementById('scanBtn'),
  capture: document.getElementById('captureBtn'),
  count: document.getElementById('countText'),
  grid: document.getElementById('grid'),
  status: document.getElementById('statusText'),
  selectAll: document.getElementById('selectAllBtn'),
  clear: document.getElementById('clearBtn'),
  import: document.getElementById('importBtn'),
};

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:18766';
let items = [];
let selected = new Set();

function setStatus(text) {
  els.status.textContent = text || '';
}

function backendBase() {
  let value = String(els.backend.value || '').trim() || DEFAULT_BACKEND_BASE;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_BACKEND_BASE;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function imageName(url) {
  if (/^data:/i.test(String(url || ''))) return 'web-capture.png';
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname || 'web-image');
  } catch {
    return 'web-image';
  }
}

function itemKey(item) {
  return item.id || item.url;
}

function visibleItems() {
  if (!els.filterSmall.checked) return items;
  return items.filter((item) => {
    const w = Number(item.width || 0);
    const h = Number(item.height || 0);
    return !w || !h || (w >= 360 && h >= 240);
  });
}

function updateSelection() {
  const visible = visibleItems();
  const visibleKeys = new Set(visible.map(itemKey));
  selected = new Set([...selected].filter((key) => visibleKeys.has(key)));
  const hidden = items.length - visible.length;
  els.count.textContent = items.length
    ? `${visible.length} 张${hidden ? `（过滤 ${hidden}）` : ''} / 已选 ${selected.size}`
    : '未扫描';
  els.import.disabled = selected.size === 0;
}

function renderGrid() {
  const visible = visibleItems();
  updateSelection();
  if (!visible.length) {
    els.grid.className = 'grid empty';
    els.grid.innerHTML = `<div class="empty-text">${items.length ? '当前过滤条件下没有可用图片。' : '没有扫描到图片。'}</div>`;
    return;
  }
  els.grid.className = 'grid';
  els.grid.innerHTML = visible.map((item, index) => {
    const key = itemKey(item);
    const checked = selected.has(key);
    const title = `${item.width || '?'} x ${item.height || '?'} · ${item.url}`;
    return `<article class="card ${checked ? 'selected' : ''}" data-index="${index}" title="${escapeHtml(title)}">
      <div class="thumb"><img src="${escapeHtml(item.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>
      <label class="meta">
        <input type="checkbox" ${checked ? 'checked' : ''}>
        <span>${escapeHtml(item.name || imageName(item.url))}</span>
      </label>
    </article>`;
  }).join('');
  els.grid.querySelectorAll('.card').forEach((card) => {
    const item = visible[Number(card.dataset.index)];
    card.addEventListener('click', (event) => {
      event.preventDefault();
      if (!item) return;
      const key = itemKey(item);
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      renderGrid();
    });
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('没有可扫描的当前标签页');
  return tab;
}

function autoScrollPage() {
  return new Promise((resolve) => {
    let steps = 0;
    const maxSteps = 8;
    const originalX = window.scrollX;
    const originalY = window.scrollY;
    const tick = () => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
      steps += 1;
      if (steps >= maxSteps) {
        window.scrollTo(originalX, originalY);
        resolve(true);
        return;
      }
      setTimeout(tick, 260);
    };
    tick();
  });
}

function collectPageImages() {
  const out = [];
  const seen = new Set();
  const push = (url, meta = {}) => {
    const clean = String(url || '').trim();
    if (!clean || seen.has(clean)) return;
    if (!/^(https?:\/\/|blob:|data:image\/)/i.test(clean)) return;
    seen.add(clean);
    out.push({
      url: clean,
      width: Number(meta.width || 0) || 0,
      height: Number(meta.height || 0) || 0,
      name: meta.name || '',
    });
  };

  document.querySelectorAll('img').forEach((img) => {
    push(img.currentSrc || img.src, {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      name: img.alt || img.title || '',
    });
    const srcset = img.getAttribute('srcset') || '';
    srcset.split(',').forEach((part) => push(part.trim().split(/\s+/)[0]));
  });

  document.querySelectorAll('source[srcset]').forEach((source) => {
    String(source.getAttribute('srcset') || '').split(',').forEach((part) => push(part.trim().split(/\s+/)[0]));
  });

  document.querySelectorAll('canvas').forEach((canvas, index) => {
    try {
      if (canvas.width < 80 || canvas.height < 80) return;
      push(canvas.toDataURL('image/png'), { width: canvas.width, height: canvas.height, name: `canvas-${index + 1}.png` });
    } catch {}
  });

  document.querySelectorAll('*').forEach((el) => {
    const bg = getComputedStyle(el).backgroundImage || '';
    const matches = bg.matchAll(/url\((['"]?)(.*?)\1\)/g);
    for (const match of matches) push(match[2]);
  });

  return out;
}

function mergeFrameResults(results) {
  const seen = new Set();
  const merged = [];
  (results || []).forEach((frame) => {
    (frame?.result || []).forEach((item) => {
      if (!item?.url || seen.has(item.url)) return;
      seen.add(item.url);
      merged.push({ ...item, id: item.url, name: item.name || imageName(item.url) });
    });
  });
  return merged.slice(0, 240);
}

async function scanPage() {
  const tab = await activeTab();
  setStatus('正在扫描当前页面...');
  if (els.autoScroll.checked) {
    setStatus('正在滚动触发懒加载...');
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: autoScrollPage }).catch(() => {});
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: collectPageImages,
  });
  items = mergeFrameResults(results).map((item) => ({ ...item, pageUrl: tab.url || '', pageTitle: tab.title || '' }));
  selected = new Set();
  renderGrid();
  setStatus(items.length ? `已扫描到 ${items.length} 张图片。` : '当前页面没有扫描到图片。');
}

async function captureVisible() {
  const tab = await activeTab();
  setStatus('正在截取当前可见画面...');
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const size = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
  const item = {
    id: `capture-${Date.now()}`,
    url: dataUrl,
    dataUrl,
    name: `capture-${Date.now()}.png`,
    pageUrl: tab.url || '',
    pageTitle: tab.title || '',
    ...size,
  };
  items = [item, ...items];
  selected.add(item.id);
  renderGrid();
  setStatus('已截取当前画面，可直接导入。');
}

function fetchUrlsAsDataUrls(urls) {
  const readOne = (url) => new Promise((resolve) => {
    const entry = { url, ok: false, dataUrl: '', contentType: '', error: '' };
    if (/^data:image\//i.test(url)) {
      entry.ok = true;
      entry.dataUrl = url;
      entry.contentType = url.match(/^data:([^;,]+)/i)?.[1] || '';
      resolve(entry);
      return;
    }
    fetch(url, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => new Promise((res, rej) => {
        entry.contentType = blob.type || '';
        const reader = new FileReader();
        reader.onload = () => res(String(reader.result || ''));
        reader.onerror = () => rej(new Error('读取失败'));
        reader.readAsDataURL(blob);
      }))
      .then((dataUrl) => {
        entry.ok = true;
        entry.dataUrl = dataUrl;
        resolve(entry);
      })
      .catch((error) => {
        entry.error = error?.message || '读取失败';
        resolve(entry);
      });
  });
  return Promise.all(urls.map(readOne));
}

async function enrichInlineData(picked) {
  const needRead = picked.filter((item) => /^blob:|^data:image\//i.test(item.url) && !item.dataUrl);
  const byUrl = new Map();
  picked.forEach((item) => {
    if (item.dataUrl) byUrl.set(item.url, { ok: true, dataUrl: item.dataUrl, contentType: 'image/png' });
  });
  if (!needRead.length) return byUrl;
  const tab = await activeTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: fetchUrlsAsDataUrls,
    args: [needRead.map((item) => item.url)],
  });
  (results || []).forEach((frame) => {
    (frame?.result || []).forEach((entry) => {
      if (!entry?.url) return;
      const current = byUrl.get(entry.url);
      if (!current || (!current.ok && entry.ok)) byUrl.set(entry.url, entry);
    });
  });
  return byUrl;
}

async function importSelected() {
  const visible = visibleItems();
  const picked = visible.filter((item) => selected.has(itemKey(item)));
  if (!picked.length) return;
  await chrome.storage.local.set({ t8_backend_base: backendBase() });
  els.import.disabled = true;
  setStatus(`正在导入 ${picked.length} 张图片...`);
  const inline = await enrichInlineData(picked);
  const payloadItems = picked.map((item) => {
    const local = inline.get(item.url);
    return {
      url: local?.ok ? '' : item.url,
      dataUrl: local?.ok ? local.dataUrl : '',
      contentType: local?.contentType || '',
      name: item.name || imageName(item.url),
      width: item.width || 0,
      height: item.height || 0,
      pageUrl: item.pageUrl || '',
      pageTitle: item.pageTitle || '',
    };
  });
  const tab = await activeTab().catch(() => ({}));
  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 't8WebImage.importWebAssets',
      backendBase: backendBase(),
      items: payloadItems,
      sendToCanvas: true,
      pageUrl: tab.url || picked[0]?.pageUrl || '',
      pageTitle: tab.title || picked[0]?.pageTitle || '',
    }, (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve(result || {});
    });
  });
  if (!response.ok) throw new Error(response.error || '导入失败');
  const data = response.data?.data || response.data || {};
  setStatus(`导入完成：成功 ${data.count || 0} 张${data.failed ? `，失败 ${data.failed} 张` : ''}。`);
  els.import.disabled = selected.size === 0;
}

async function openSidePanel() {
  const tab = await activeTab();
  if (chrome.sidePanel?.open) await chrome.sidePanel.open({ windowId: tab.windowId });
}

els.scan.addEventListener('click', () => scanPage().catch((error) => setStatus(error?.message || '扫描失败')));
els.capture.addEventListener('click', () => captureVisible().catch((error) => setStatus(error?.message || '截图失败')));
els.import.addEventListener('click', () => importSelected().catch((error) => {
  setStatus(error?.message || '导入失败');
  els.import.disabled = selected.size === 0;
}));
els.selectAll.addEventListener('click', () => {
  selected = new Set(visibleItems().map(itemKey));
  renderGrid();
});
els.clear.addEventListener('click', () => {
  selected.clear();
  renderGrid();
});
els.filterSmall.addEventListener('change', renderGrid);
els.backend.addEventListener('change', () => chrome.storage.local.set({ t8_backend_base: backendBase() }));
els.pin.addEventListener('click', () => openSidePanel().catch((error) => setStatus(error?.message || '无法打开侧边栏')));

(async function init() {
  const stored = await chrome.storage.local.get({ t8_backend_base: DEFAULT_BACKEND_BASE });
  els.backend.value = stored.t8_backend_base || DEFAULT_BACKEND_BASE;
})();
