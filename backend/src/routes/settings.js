// 主 API Key 与分类独立 Key 设置路由
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const {
  maskAdvancedProviders,
  normalizeAdvancedProviders,
  summarizeAdvancedProviders,
} = require('../providers/registry');
const {
  maskCloudUploadTargets,
  normalizeCloudUploadTargets,
  summarizeCloudUploadTargets,
} = require('../cloudUploads/settings');

const router = express.Router();

const TASK_COMPLETION_SOUND_DEFAULT = {
  mode: 'default',
  name: '',
  fileName: '',
  mimeType: '',
  size: 0,
  updatedAt: 0,
  url: '',
};
const TASK_COMPLETION_SOUND_DIRNAME = 'task-completion-sound';
const TASK_COMPLETION_SOUND_ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm']);
const TASK_COMPLETION_SOUND_EXTENSION_BY_MIME = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/webm': '.webm',
};

// 默认 settings 结构（主 Key + 8 类分类 Key）
const DEFAULT_SETTINGS = {
  // 主 Key
  zhenzhenApiKey: '',
  zhenzhenBaseUrl: config.ZHENZHEN_BASE_URL, // 固定 https://ai.t8star.org
  zhenzhenSd2ApiKey: '',
  zhenzhenSd2BaseUrl: config.ZHENZHEN_SD2_BASE_URL,
  rhApiKey: '',
  rhBaseUrl: config.RH_BASE_URL,
  rhIntlApiKey: '',
  rhIntlBaseUrl: config.RH_INTL_BASE_URL,
  // v1.2.9.16: 取消 rhWalletApiKey —— RH 钱包应用节点与普通 RunningHub 节点统一使用 rhApiKey
  llmApiKey: '',
  llmBaseUrl: config.ZHENZHEN_BASE_URL, // 同贞贞工坊上游
  // 分类 Key（留空时 fallback 到 zhenzhenApiKey）
  gptImageApiKey: '',
  nanoBananaApiKey: '',
  mjApiKey: '',
  veoApiKey: '',
  soraApiKey: '',
  grokApiKey: '',
  seedanceApiKey: '',
  sunoApiKey: '',
  // v1.2.10.2: 全局生成素材自动保存到本地的路径(可用户自定义)
  fileSavePath: config.DEFAULT_LOCAL_SAVE_DIR,
  // v1.3.1: 画布自动保存导出路径(实际写入 <path>/T8-penguin-canvas/canvases)
  canvasAutoSavePath: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
  // v1.3.4: 资源库路径(资源文件 + resource_library.json 元数据)
  resourceLibraryPath: config.DEFAULT_RESOURCE_LIBRARY_DIR,
  // v1.3.6: 自定义主题模板路径
  themeTemplatePath: config.DEFAULT_THEME_TEMPLATE_DIR,
  // 本地 Eagle API 地址，只用于“发送到 Eagle”功能。路由层仍会强制限制为本机地址。
  eagleApiBase: config.DEFAULT_EAGLE_API_BASE,
  // v1.8.0: 扩展 API 平台（高级可选）。默认只提供禁用的配置卡片，不影响主流程。
  advancedProviders: normalizeAdvancedProviders(),
  // v1.9.x: 云端上传目标（可选）。默认禁用，不影响资源库/自动保存主流程。
  cloudUploadTargets: normalizeCloudUploadTargets(),
  // 任务完成提示音；默认走前端内置短音，用户上传后走本地音频文件。
  taskCompletionSound: { ...TASK_COMPLETION_SOUND_DEFAULT },
  // 其他偏好
  preferences: {
    theme: 'dark',
    // UI locale is deliberately separate from prompt/content language.
    uiLocale: 'zh-CN',
    language: 'zh-CN',
  },
};

function normalizeUiPreferences(raw, fallback = DEFAULT_SETTINGS.preferences) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_SETTINGS.preferences;
  return {
    ...base,
    ...value,
    theme: value.theme === 'light' ? 'light' : value.theme === 'dark' ? 'dark' : base.theme,
    uiLocale: value.uiLocale === 'en-US' ? 'en-US' : value.uiLocale === 'zh-CN' ? 'zh-CN' : base.uiLocale,
    language: typeof value.language === 'string' && value.language.trim()
      ? value.language.trim().slice(0, 40)
      : base.language,
  };
}

function normalizeTaskCompletionSoundSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const mode = value.mode === 'custom' ? 'custom' : 'default';
  if (mode !== 'custom') return { ...TASK_COMPLETION_SOUND_DEFAULT };
  const fileName = path.basename(String(value.fileName || ''));
  if (!fileName) return { ...TASK_COMPLETION_SOUND_DEFAULT };
  return {
    mode: 'custom',
    name: String(value.name || fileName).slice(0, 240),
    fileName,
    mimeType: String(value.mimeType || 'audio/mpeg').slice(0, 120),
    size: Number.isFinite(Number(value.size)) ? Number(value.size) : 0,
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
    url: '',
  };
}

function getTaskCompletionSoundDir() {
  return path.join(path.dirname(config.SETTINGS_FILE), TASK_COMPLETION_SOUND_DIRNAME);
}

function getTaskCompletionSoundFilePath(settings) {
  const sound = normalizeTaskCompletionSoundSettings(settings?.taskCompletionSound);
  if (sound.mode !== 'custom' || !sound.fileName) return '';
  const dir = getTaskCompletionSoundDir();
  const filePath = path.join(dir, sound.fileName);
  const resolvedDir = path.resolve(dir);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedDir + path.sep)) return '';
  return resolvedFile;
}

function getTaskCompletionSoundPublic(settings) {
  const sound = normalizeTaskCompletionSoundSettings(settings?.taskCompletionSound);
  const filePath = getTaskCompletionSoundFilePath({ taskCompletionSound: sound });
  if (sound.mode !== 'custom' || !filePath || !fs.existsSync(filePath)) {
    return { ...TASK_COMPLETION_SOUND_DEFAULT };
  }
  const stat = fs.statSync(filePath);
  const updatedAt = sound.updatedAt || Math.max(0, Math.floor(stat.mtimeMs));
  return {
    mode: 'custom',
    name: sound.name || sound.fileName,
    fileName: sound.fileName,
    mimeType: sound.mimeType || 'audio/mpeg',
    size: sound.size || stat.size,
    updatedAt,
    url: `/api/settings/task-completion-sound/file?v=${updatedAt}`,
  };
}

function deleteTaskCompletionSoundFiles() {
  const dir = getTaskCompletionSoundDir();
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith('task-completion-sound')) continue;
    fs.rmSync(path.join(dir, entry.name), { force: true });
  }
}

function isAllowedTaskCompletionSoundFile(file) {
  const ext = path.extname(String(file?.originalname || '')).toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  return TASK_COMPLETION_SOUND_ALLOWED_EXTENSIONS.has(ext) || mime.startsWith('audio/');
}

function getTaskCompletionSoundFileExtension(file) {
  const ext = path.extname(String(file?.originalname || '')).toLowerCase();
  if (TASK_COMPLETION_SOUND_ALLOWED_EXTENSIONS.has(ext)) return ext;
  const mime = String(file?.mimetype || '').toLowerCase();
  return TASK_COMPLETION_SOUND_EXTENSION_BY_MIME[mime] || '.mp3';
}

const uploadTaskCompletionSoundFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedTaskCompletionSoundFile(file)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持音频文件：mp3 / wav / ogg / m4a / aac / flac / webm'));
    }
  },
}).single('audio');

const CURRENT_DEFAULT_PATHS = {
  fileSavePath: config.DEFAULT_LOCAL_SAVE_DIR,
  canvasAutoSavePath: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
  resourceLibraryPath: config.DEFAULT_RESOURCE_LIBRARY_DIR,
  themeTemplatePath: config.DEFAULT_THEME_TEMPLATE_DIR,
};

const LEGACY_DEFAULT_PATHS = {
  fileSavePath: config.LEGACY_WINDOWS_DEFAULT_ROOT,
  canvasAutoSavePath: config.LEGACY_WINDOWS_DEFAULT_ROOT,
  resourceLibraryPath: `${config.LEGACY_WINDOWS_DEFAULT_ROOT}\\resources`,
  themeTemplatePath: `${config.LEGACY_WINDOWS_DEFAULT_ROOT}\\theme-templates`,
};

// 分类 key 字段列表（供 GET 脱敏与 POST 合并使用）
const CLASSIFIED_KEY_FIELDS = [
  'gptImageApiKey', 'nanoBananaApiKey', 'mjApiKey', 'veoApiKey', 'soraApiKey',
  'grokApiKey', 'seedanceApiKey', 'sunoApiKey',
];

function normalizePathForCompare(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function migrateLegacyDefaultPaths(settings) {
  if (process.platform === 'win32') {
    return { settings, changed: false };
  }
  let changed = false;
  const next = { ...settings };
  for (const field of Object.keys(CURRENT_DEFAULT_PATHS)) {
    const current = String(next[field] || '').trim();
    if (!current) continue;
    if (normalizePathForCompare(current) === normalizePathForCompare(LEGACY_DEFAULT_PATHS[field])) {
      next[field] = CURRENT_DEFAULT_PATHS[field];
      changed = true;
    }
  }
  return { settings: next, changed };
}

function maskKey(k) {
  return k ? '****' + String(k).slice(-4) : '';
}

function loadSettings({ persistMigrations = true } = {}) {
  if (!fs.existsSync(config.SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
    // 强制 base URL 与配置一致(防篡改)
    const merged = {
      ...DEFAULT_SETTINGS,
      ...data,
      zhenzhenBaseUrl: config.ZHENZHEN_BASE_URL,
      zhenzhenSd2BaseUrl: config.ZHENZHEN_SD2_BASE_URL,
      llmBaseUrl: config.ZHENZHEN_BASE_URL,
    };
    merged.advancedProviders = normalizeAdvancedProviders(data.advancedProviders);
    merged.cloudUploadTargets = normalizeCloudUploadTargets(data.cloudUploadTargets);
    merged.taskCompletionSound = normalizeTaskCompletionSoundSettings(data.taskCompletionSound);
    merged.preferences = normalizeUiPreferences(data.preferences);
    const migrated = migrateLegacyDefaultPaths(merged);
    if (persistMigrations && migrated.changed) {
      saveSettings(migrated.settings);
    }
    return migrated.settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  const dir = path.dirname(config.SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

const LOCAL_SAVE_PATH_FIELDS = Object.freeze([
  ['fileSavePath', '文件自动保存路径', config.DEFAULT_LOCAL_SAVE_DIR],
  ['canvasAutoSavePath', '画布自动保存路径', config.DEFAULT_CANVAS_AUTO_SAVE_DIR],
  ['resourceLibraryPath', '资源库路径', config.DEFAULT_RESOURCE_LIBRARY_DIR],
  ['themeTemplatePath', '主题模板路径', config.DEFAULT_THEME_TEMPLATE_DIR],
]);
const LOCAL_SAVE_PATH_PROBE_TIMEOUT_MS = 1_500;

function settlePathProbeWithin(promise, timeoutMs, field) {
  const deadlineMs = Math.max(10, Math.min(10_000, Number(timeoutMs) || LOCAL_SAVE_PATH_PROBE_TIMEOUT_MS));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish({
        field,
        ok: false,
        timedOut: true,
        code: 'path_probe_timeout',
      });
    }, deadlineMs);
    Promise.resolve(promise).then(
      () => finish({ field, ok: true, timedOut: false, code: null }),
      (error) => finish({
        field,
        ok: false,
        timedOut: false,
        code: String(error?.code || 'path_probe_failed'),
      }),
    );
  });
}

async function ensureLocalSavePaths(settings = loadSettings({ persistMigrations: false }), options = {}) {
  const onlyFields = options.onlyFields instanceof Set ? options.onlyFields : null;
  const timeoutMs = options.timeoutMs;
  const mkdir = typeof options.mkdir === 'function'
    ? options.mkdir : fs.promises.mkdir.bind(fs.promises);
  const results = [];
  for (const [field, label, fallback] of LOCAL_SAVE_PATH_FIELDS) {
    if (onlyFields && !onlyFields.has(field)) continue;
    const target = String(settings?.[field] || fallback || '').trim();
    if (!target) continue;
    const result = await settlePathProbeWithin(
      Promise.resolve().then(() => mkdir(target, { recursive: true })),
      timeoutMs,
      field,
    );
    results.push(result);
    if (result.ok) {
      console.log(`[settings] 已确认${label}: ${target}`);
    } else {
      console.warn(`[settings] ${label}异步检查失败: ${result.code}`);
    }
    // A disconnected UNC/NAS path can retain a libuv worker after our public
    // deadline. Do not fan additional probes out and exhaust the whole pool.
    if (result.timedOut) break;
  }
  return results;
}

function scheduleLocalSavePathProbe(settings, fields) {
  const onlyFields = new Set(fields);
  if (onlyFields.size === 0) return;
  setImmediate(() => {
    ensureLocalSavePaths(settings, { onlyFields }).catch((error) => {
      console.warn('[settings] 本地保存路径异步检查失败:', error?.message || error);
    });
  });
}

// GET /api/settings — 获取全部设置(脱敏 Key 仅返回最后4位)
router.get('/', (_req, res) => {
  const settings = loadSettings();
  const masked = {
    ...settings,
    zhenzhenApiKey: maskKey(settings.zhenzhenApiKey),
    zhenzhenSd2ApiKey: maskKey(settings.zhenzhenSd2ApiKey),
    rhApiKey: maskKey(settings.rhApiKey),
    rhIntlApiKey: maskKey(settings.rhIntlApiKey),
    llmApiKey: maskKey(settings.llmApiKey),
    advancedProviders: maskAdvancedProviders(settings.advancedProviders),
    advancedProviderSummary: summarizeAdvancedProviders(settings.advancedProviders),
    cloudUploadTargets: maskCloudUploadTargets(settings.cloudUploadTargets),
    cloudUploadSummary: summarizeCloudUploadTargets(settings.cloudUploadTargets),
    taskCompletionSound: getTaskCompletionSoundPublic(settings),
  };
  for (const f of CLASSIFIED_KEY_FIELDS) {
    masked[f] = maskKey(settings[f]);
  }
  res.json({ success: true, data: masked });
});

// GET /api/settings/raw — 内部接口,获取明文(供 Phase 4 代理调用使用)
router.get('/raw', (_req, res) => {
  res.json({ success: true, data: loadSettings() });
});

// GET /api/settings/task-completion-sound — 获取当前提示音配置
router.get('/task-completion-sound', (_req, res) => {
  res.json({ success: true, data: getTaskCompletionSoundPublic(loadSettings()) });
});

// GET /api/settings/task-completion-sound/file — 播放/试听自定义提示音
router.get('/task-completion-sound/file', (_req, res) => {
  const settings = loadSettings();
  const sound = getTaskCompletionSoundPublic(settings);
  const filePath = getTaskCompletionSoundFilePath(settings);
  if (sound.mode !== 'custom' || !filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: '未配置自定义提示音' });
  }
  res.type(sound.mimeType || 'audio/mpeg');
  res.sendFile(filePath);
});

// POST /api/settings/task-completion-sound — 上传自定义任务完成提示音
router.post('/task-completion-sound', (req, res) => {
  uploadTaskCompletionSoundFile(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message || '上传提示音失败' });
    }
    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({ success: false, error: '请选择一个音频文件' });
    }
    try {
      const dir = getTaskCompletionSoundDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      deleteTaskCompletionSoundFiles();
      const ext = getTaskCompletionSoundFileExtension(req.file);
      const fileName = `task-completion-sound${ext}`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, req.file.buffer);
      const updatedAt = Date.now();
      const current = loadSettings();
      const next = {
        ...current,
        taskCompletionSound: {
          mode: 'custom',
          name: String(req.file.originalname || fileName).slice(0, 240),
          fileName,
          mimeType: req.file.mimetype || TASK_COMPLETION_SOUND_EXTENSION_BY_MIME[ext] || 'audio/mpeg',
          size: req.file.size || req.file.buffer.length,
          updatedAt,
          url: '',
        },
      };
      saveSettings(next);
      res.json({ success: true, data: getTaskCompletionSoundPublic(next) });
    } catch (e) {
      res.status(500).json({ success: false, error: e?.message || '保存提示音失败' });
    }
  });
});

// DELETE /api/settings/task-completion-sound — 恢复默认提示音
router.delete('/task-completion-sound', (_req, res) => {
  try {
    deleteTaskCompletionSoundFiles();
    const current = loadSettings();
    const next = { ...current, taskCompletionSound: { ...TASK_COMPLETION_SOUND_DEFAULT } };
    saveSettings(next);
    res.json({ success: true, data: getTaskCompletionSoundPublic(next) });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || '恢复默认提示音失败' });
  }
});

// POST /api/settings — 更新设置
router.post('/', (req, res) => {
  const current = loadSettings();
  const incoming = req.body || {};
  const { taskCompletionSound: _ignoredTaskCompletionSound, ...safeIncoming } = incoming;
  const hasAdvancedProviders = Object.prototype.hasOwnProperty.call(incoming, 'advancedProviders');
  const hasCloudUploadTargets = Object.prototype.hasOwnProperty.call(incoming, 'cloudUploadTargets');
  const merged = {
    ...current,
    ...safeIncoming,
    // base URL 强制为配置值,不允许覆盖
    zhenzhenBaseUrl: config.ZHENZHEN_BASE_URL,
    zhenzhenSd2BaseUrl: config.ZHENZHEN_SD2_BASE_URL,
    rhBaseUrl: config.RH_BASE_URL,
    rhIntlBaseUrl: config.RH_INTL_BASE_URL,
    llmBaseUrl: config.ZHENZHEN_BASE_URL,
  };
  merged.advancedProviders = hasAdvancedProviders
    ? normalizeAdvancedProviders(incoming.advancedProviders, current.advancedProviders)
    : normalizeAdvancedProviders(current.advancedProviders);
  merged.cloudUploadTargets = hasCloudUploadTargets
    ? normalizeCloudUploadTargets(incoming.cloudUploadTargets, current.cloudUploadTargets)
    : normalizeCloudUploadTargets(current.cloudUploadTargets);
  merged.taskCompletionSound = normalizeTaskCompletionSoundSettings(current.taskCompletionSound);
  merged.preferences = normalizeUiPreferences(incoming.preferences, current.preferences);
  saveSettings(merged);
  // User-selected paths may live on a sleeping removable drive or disconnected
  // UNC/NAS share. Persist the preference first and validate it off the request
  // and startup critical paths with a bounded, sequential probe.
  scheduleLocalSavePathProbe(
    merged,
    LOCAL_SAVE_PATH_FIELDS
      .map(([field]) => field)
      .filter((field) => typeof incoming[field] === 'string' && incoming[field].trim()),
  );
  res.json({ success: true });
});

// =====================
// RH 工具节点 - 分类 API（v1.2.10+，与 RH 应用创意包数据完全分开）
// =====================

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}
function saveJson(file, data) {
  try {
    const dir = require('path').dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}
function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
function cleanId(value, prefix) {
  const raw = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
  return raw || genId(prefix);
}
function normalizeRhToolsBackup(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const rawCategories = Array.isArray(payload.categories) ? payload.categories : [];
  const rawTools = Array.isArray(payload.tools) ? payload.tools : [];

  const usedCatIds = new Set();
  const categories = rawCategories
    .map((c, idx) => {
      const name = String(c?.name || '').trim();
      if (!name) return null;
      let id = cleanId(c?.id, 'rhcat');
      while (usedCatIds.has(id)) id = genId('rhcat');
      usedCatIds.add(id);
      return {
        id,
        name: name.slice(0, 80),
        order: Number.isFinite(Number(c?.order)) ? Number(c.order) : idx,
        createdAt: Number(c?.createdAt) || Date.now(),
      };
    })
    .filter(Boolean);

  const categoryIds = new Set(categories.map((c) => c.id));
  const usedToolIds = new Set();
  const tools = rawTools
    .map((t, idx) => {
      const webappId = String(t?.webappId || '').trim();
      const title = String(t?.title || '').trim();
      if (!webappId || !title) return null;
      let id = cleanId(t?.id, 'rhtool');
      while (usedToolIds.has(id)) id = genId('rhtool');
      usedToolIds.add(id);
      const categoryId = String(t?.categoryId || '').trim();
      return {
        id,
        webappId: webappId.slice(0, 120),
        rhSite: String(t?.rhSite || '').toLowerCase() === 'intl' ? 'intl' : 'cn',
        title: title.slice(0, 120),
        description: typeof t?.description === 'string' ? t.description.slice(0, 2000) : '',
        categoryId: categoryIds.has(categoryId) ? categoryId : '',
        coverUrl: typeof t?.coverUrl === 'string' ? t.coverUrl.slice(0, 2000) : '',
        order: Number.isFinite(Number(t?.order)) ? Number(t.order) : idx,
        addedAt: Number(t?.addedAt) || Date.now(),
      };
    })
    .filter(Boolean);

  categories.sort((a, b) => (a.order || 0) - (b.order || 0));
  tools.sort((a, b) => (a.order || 0) - (b.order || 0));
  categories.forEach((c, idx) => { c.order = idx; });
  tools.forEach((t, idx) => { t.order = idx; });
  return { categories, tools };
}

const RH_TOOLBOX_SCHEMA = 't8-rh-toolbox-manifest';
const RH_TOOLBOX_MEDIA_KINDS = new Set(['text', 'image', 'video', 'audio']);
const RH_TOOLBOX_PARAM_KINDS = new Set(['text', 'number', 'select', 'boolean']);
const RH_TOOLBOX_OUTPUT_ROLES = new Set(['append-output', 'replace-source', 'text-only', 'multi-output']);
const RH_TOOLBOX_PARENT_IDS = new Set(['image', 'video', 'audio', 'model3d', 'text']);
const RH_TOOLBOX_DEFAULT_POLL_INTERVAL_MS = 5000;
const RH_TOOLBOX_DEFAULT_MAX_POLLS = 720;
const RH_SMART_TRANSLATION_WEBAPP_ID = '2084616885802463233';
const RH_SMART_TRANSLATION_CATEGORY_ID = 'text-category-nfjhp';

function cleanRhToolboxId(value, fallback) {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return cleaned || fallback;
}

function cleanRhToolboxText(value, fallback = '', max = 4000) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return raw.length > max ? raw.slice(0, max) : raw;
}

function normalizeRhToolboxMajorId(value, fallback = 'image') {
  const raw = String(value || '').trim().toLowerCase();
  if (RH_TOOLBOX_PARENT_IDS.has(raw)) return raw;
  if (['images', 'img', 'photo', 'image-tools', '图像', '图片'].includes(raw)) return 'image';
  if (['videos', 'movie', 'video-tools', '视频'].includes(raw)) return 'video';
  if (['sound', 'music', 'voice', 'audio-tools', '音频', '声音'].includes(raw)) return 'audio';
  if (['3d', 'model-3d', 'models', 'model3d-tools', '模型'].includes(raw)) return 'model3d';
  if (['texts', 'prompt', 'llm', 'text-tools', '文本', '文字'].includes(raw)) return 'text';
  return fallback;
}

function normalizeRhToolboxMediaKind(value) {
  return RH_TOOLBOX_MEDIA_KINDS.has(String(value || '')) ? String(value) : 'text';
}

function normalizeRhToolboxParamKind(value) {
  return RH_TOOLBOX_PARAM_KINDS.has(String(value || '')) ? String(value) : 'text';
}

function normalizeRhToolboxManifestPayload(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const rawCategories = Array.isArray(payload.categories) ? payload.categories : [];
  const categories = [];
  const categoryIds = new Set();

  rawCategories.forEach((item, index) => {
    const id = cleanRhToolboxId(item?.id, `category-${index + 1}`);
    if (categoryIds.has(id)) return;
    categoryIds.add(id);
    categories.push({
      id,
      name: cleanRhToolboxText(item?.name, id, 120),
      parentId: normalizeRhToolboxMajorId(item?.parentId || item?.majorCategoryId || item?.surface),
      description: cleanRhToolboxText(item?.description, '', 1000),
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
      icon: cleanRhToolboxText(item?.icon, 'Wrench', 80),
    });
  });

  if (categories.length === 0) {
    categories.push({ id: 'general', name: '通用工具', parentId: 'image', order: 0, icon: 'Wrench' });
    categoryIds.add('general');
  }

  const rawTools = Array.isArray(payload.tools) ? payload.tools : [];
  const toolIds = new Set();
  const tools = [];

  rawTools.forEach((item, index) => {
    const id = cleanRhToolboxId(item?.id, `tool-${index + 1}`);
    if (toolIds.has(id)) return;
    toolIds.add(id);
    const webappId = cleanRhToolboxText(item?.webappId, '', 120);
    const categoryIdRaw = cleanRhToolboxId(item?.categoryId, '');
    const categoryId = categoryIds.has(categoryIdRaw) ? categoryIdRaw : categories[0].id;
    const inputSchema = Array.isArray(item?.inputSchema)
      ? item.inputSchema.map((entry, entryIndex) => {
        const rhNodeId = cleanRhToolboxText(entry?.rhNodeId, '', 80).replace(/^#/, '');
        const fieldName = cleanRhToolboxText(entry?.fieldName, '', 160);
        if (!rhNodeId || !fieldName) return null;
        return {
          key: cleanRhToolboxId(entry?.key, `${normalizeRhToolboxMediaKind(entry?.kind)}-${entryIndex + 1}`),
          label: cleanRhToolboxText(entry?.label, '', 160),
          kind: normalizeRhToolboxMediaKind(entry?.kind),
          rhNodeId,
          fieldName,
          required: entry?.required !== false,
          multiple: entry?.multiple === true,
          maxItems: Number.isFinite(Number(entry?.maxItems)) ? Math.max(1, Math.floor(Number(entry.maxItems))) : undefined,
          defaultValue: entry?.defaultValue == null ? undefined : String(entry.defaultValue).slice(0, 4000),
          uploadAsset: entry?.uploadAsset !== false,
          order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : entryIndex,
        };
      }).filter(Boolean)
      : [];
    const outputSchema = Array.isArray(item?.outputSchema)
      ? item.outputSchema.map((entry, entryIndex) => ({
        key: cleanRhToolboxId(entry?.key, `output-${entryIndex + 1}`),
        label: cleanRhToolboxText(entry?.label, '', 160),
        kind: normalizeRhToolboxMediaKind(entry?.kind),
        role: RH_TOOLBOX_OUTPUT_ROLES.has(String(entry?.role || '')) ? String(entry.role) : 'append-output',
      }))
      : [];
    const fixedParams = Array.isArray(item?.fixedParams)
      ? item.fixedParams.map((entry) => {
        const rhNodeId = cleanRhToolboxText(entry?.rhNodeId, '', 80).replace(/^#/, '');
        const fieldName = cleanRhToolboxText(entry?.fieldName, '', 160);
        if (!rhNodeId || !fieldName) return null;
        return {
          rhNodeId,
          fieldName,
          value: entry?.value ?? '',
          valueType: entry?.valueType,
        };
      }).filter(Boolean)
      : [];
    const userParams = Array.isArray(item?.userParams)
      ? item.userParams.map((entry, entryIndex) => {
        const rhNodeId = cleanRhToolboxText(entry?.rhNodeId, '', 80).replace(/^#/, '');
        const fieldName = cleanRhToolboxText(entry?.fieldName, '', 160);
        const label = cleanRhToolboxText(entry?.label, '', 160);
        if (!rhNodeId || !fieldName || !label) return null;
        const kind = normalizeRhToolboxParamKind(entry?.kind);
        return {
          key: cleanRhToolboxId(entry?.key, `param-${entryIndex + 1}`),
          label,
          kind,
          rhNodeId,
          fieldName,
          defaultValue: entry?.defaultValue,
          placeholder: cleanRhToolboxText(entry?.placeholder, '', 500),
          options: Array.isArray(entry?.options)
            ? entry.options.filter((v) => typeof v === 'string' || typeof v === 'number').slice(0, 120)
            : undefined,
          min: Number.isFinite(Number(entry?.min)) ? Number(entry.min) : undefined,
          max: Number.isFinite(Number(entry?.max)) ? Number(entry.max) : undefined,
          step: Number.isFinite(Number(entry?.step)) ? Number(entry.step) : undefined,
          required: entry?.required === true,
        };
      }).filter(Boolean)
      : [];
    const pollIntervalMs = Number.isFinite(Number(item?.runtime?.pollIntervalMs))
      ? Math.max(1000, Number(item.runtime.pollIntervalMs))
      : RH_TOOLBOX_DEFAULT_POLL_INTERVAL_MS;
    const maxPolls = Number.isFinite(Number(item?.runtime?.maxPolls))
      ? Math.max(1, Math.floor(Number(item.runtime.maxPolls)))
      : RH_TOOLBOX_DEFAULT_MAX_POLLS;

    let normalizedTool = {
      id,
      title: cleanRhToolboxText(item?.title, id, 160),
      description: cleanRhToolboxText(item?.description, '', 4000),
      categoryId,
      webappId,
      rhSite: String(item?.rhSite || '').toLowerCase() === 'intl' ? 'intl' : 'cn',
      enabled: item?.enabled !== false && !!webappId,
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
      capabilities: Array.isArray(item?.capabilities)
        ? Array.from(new Set(item.capabilities.map((cap) => String(cap || '').trim()).filter(Boolean))).slice(0, 80)
        : [],
      inputSchema: inputSchema.sort((a, b) => (Number(a.order || 0) - Number(b.order || 0))),
      outputSchema,
      fixedParams,
      userParams,
      runtime: {
        instanceType: cleanRhToolboxText(item?.runtime?.instanceType, '', 80),
        pollIntervalMs,
        maxPolls,
        fetchAppInfo: item?.runtime?.fetchAppInfo !== false,
      },
      ui: item?.ui && typeof item.ui === 'object'
        ? {
          icon: cleanRhToolboxText(item.ui.icon, 'Wrench', 80),
          showInNode: item.ui.showInNode !== false,
          showInImageEditor: item.ui.showInImageEditor === true,
          showInVideoEditor: item.ui.showInVideoEditor === true,
          showInTextEditor: item.ui.showInTextEditor === true,
          showInAudioEditor: item.ui.showInAudioEditor === true,
        }
        : { icon: 'Wrench', showInNode: true },
      version: Number.isFinite(Number(item?.version)) ? Number(item.version) : 1,
    };

    // 兼容已经持久化的旧制作器草稿：该 WebApp 曾被错误识别成图像抠图。
    // 服务端也执行合同收敛，确保重启、GET/PUT 与打包后的用户数据都返回
    // 同一个 text.translate 输入/输出协议。
    if (webappId === RH_SMART_TRANSLATION_WEBAPP_ID) {
      normalizedTool = {
        ...normalizedTool,
        title: '智能翻译',
        description: '自动识别中英文并互译，其他语言默认翻译为中文',
        order: 60,
        categoryId: categoryIds.has(RH_SMART_TRANSLATION_CATEGORY_ID)
          ? RH_SMART_TRANSLATION_CATEGORY_ID
          : normalizedTool.categoryId,
        capabilities: ['text.translate'],
        inputSchema: [{
          key: 'prompt',
          label: '待翻译文本',
          kind: 'text',
          rhNodeId: '5',
          fieldName: 'prompt',
          required: true,
          multiple: false,
          uploadAsset: false,
          order: 0,
        }],
        outputSchema: [{
          key: 'output-text',
          label: '翻译结果',
          kind: 'text',
          role: 'text-only',
        }],
        fixedParams: [],
        userParams: [],
        ui: {
          icon: 'Languages',
          showInNode: true,
          showInImageEditor: false,
          showInVideoEditor: false,
          showInTextEditor: true,
          showInAudioEditor: false,
        },
      };
    }
    tools.push(normalizedTool);
  });

  categories.sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
  tools.sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'));
  return {
    schema: RH_TOOLBOX_SCHEMA,
    version: Number.isFinite(Number(payload.version)) ? Number(payload.version) : 1,
    updatedAt: cleanRhToolboxText(payload.updatedAt, new Date().toISOString(), 80),
    categories,
    tools,
  };
}

function readRhToolboxPersistentManifest() {
  const empty = {
    schema: RH_TOOLBOX_SCHEMA,
    version: 1,
    updatedAt: '',
    categories: [],
    tools: [],
  };
  const raw = loadJson(config.RH_TOOLBOX_MANIFEST_FILE, null);
  if (!raw || typeof raw !== 'object') return empty;
  const categoryCount = Array.isArray(raw.categories) ? raw.categories.length : 0;
  const toolCount = Array.isArray(raw.tools) ? raw.tools.length : 0;
  if (categoryCount === 0 && toolCount === 0) return empty;
  return normalizeRhToolboxManifestPayload(raw);
}

function writeRhToolboxPersistentManifest(raw) {
  const manifest = normalizeRhToolboxManifestPayload({
    ...(raw && typeof raw === 'object' ? raw : {}),
    updatedAt: new Date().toISOString(),
  });
  if (!saveJson(config.RH_TOOLBOX_MANIFEST_FILE, manifest)) {
    throw new Error('RH工具箱持久化文件写入失败');
  }
  return manifest;
}

router.get('/rh-toolbox/manifest', (_req, res) => {
  const manifest = readRhToolboxPersistentManifest();
  res.json({
    success: true,
    data: {
      manifest,
      path: config.RH_TOOLBOX_MANIFEST_FILE,
      categoryCount: manifest.categories.length,
      toolCount: manifest.tools.length,
    },
  });
});

router.put('/rh-toolbox/manifest', (req, res) => {
  try {
    const manifest = writeRhToolboxPersistentManifest(req.body?.manifest || req.body || {});
    res.json({
      success: true,
      data: {
        manifest,
        path: config.RH_TOOLBOX_MANIFEST_FILE,
        categoryCount: manifest.categories.length,
        toolCount: manifest.tools.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// 获取分类列表
router.get('/rh-tool-categories', (_req, res) => {
  const list = loadJson(config.RH_TOOL_CATEGORIES_FILE, []);
  list.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json({ success: true, data: list });
});

// 新增分类
router.post('/rh-tool-categories', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.json({ success: false, error: '分类名不能为空' });
  }
  const list = loadJson(config.RH_TOOL_CATEGORIES_FILE, []);
  if (list.find((c) => c.name === String(name).trim())) {
    return res.json({ success: false, error: '分类名已存在' });
  }
  const newCat = {
    id: genId('rhcat'),
    name: String(name).trim(),
    order: list.length,
    createdAt: Date.now(),
  };
  list.push(newCat);
  saveJson(config.RH_TOOL_CATEGORIES_FILE, list);
  res.json({ success: true, data: newCat });
});

// 重命名分类
router.put('/rh-tool-categories/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.json({ success: false, error: '分类名不能为空' });
  }
  const list = loadJson(config.RH_TOOL_CATEGORIES_FILE, []);
  const target = list.find((c) => c.id === id);
  if (!target) return res.json({ success: false, error: '分类不存在' });
  if (list.find((c) => c.id !== id && c.name === String(name).trim())) {
    return res.json({ success: false, error: '分类名已存在' });
  }
  target.name = String(name).trim();
  saveJson(config.RH_TOOL_CATEGORIES_FILE, list);
  res.json({ success: true, data: target });
});

// 删除分类（其下应用 categoryId 重置为空）
router.delete('/rh-tool-categories/:id', (req, res) => {
  const { id } = req.params;
  let list = loadJson(config.RH_TOOL_CATEGORIES_FILE, []);
  const len = list.length;
  list = list.filter((c) => c.id !== id);
  if (list.length === len) {
    return res.json({ success: false, error: '分类不存在' });
  }
  saveJson(config.RH_TOOL_CATEGORIES_FILE, list);
  const apps = loadJson(config.RH_TOOL_APPS_FILE, []);
  let changed = false;
  apps.forEach((a) => {
    if (a.categoryId === id) {
      a.categoryId = '';
      changed = true;
    }
  });
  if (changed) saveJson(config.RH_TOOL_APPS_FILE, apps);
  res.json({ success: true });
});

// 分类排序
router.post('/rh-tool-categories/reorder', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.json({ success: false, error: '参数错误' });
  const list = loadJson(config.RH_TOOL_CATEGORIES_FILE, []);
  const map = new Map(list.map((c) => [c.id, c]));
  const reordered = [];
  ids.forEach((id, idx) => {
    const c = map.get(id);
    if (c) {
      c.order = idx;
      reordered.push(c);
      map.delete(id);
    }
  });
  for (const c of map.values()) {
    c.order = reordered.length;
    reordered.push(c);
  }
  saveJson(config.RH_TOOL_CATEGORIES_FILE, reordered);
  res.json({ success: true, data: reordered });
});

// =====================
// RH 工具节点 - 应用 API
// =====================

// 获取应用列表
router.get('/rh-tool-apps', (_req, res) => {
  const list = loadJson(config.RH_TOOL_APPS_FILE, []).map((item) => ({
    ...item,
    rhSite: String(item?.rhSite || '').toLowerCase() === 'intl' ? 'intl' : 'cn',
  }));
  list.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json({ success: true, data: list });
});

// 新增应用
router.post('/rh-tool-apps', (req, res) => {
  const { webappId, title, description, categoryId, coverUrl, rhSite } = req.body || {};
  if (!webappId || !title) {
    return res.json({ success: false, error: '缺少必要参数 (webappId / title)' });
  }
  const list = loadJson(config.RH_TOOL_APPS_FILE, []);
  const newApp = {
    id: genId('rhtool'),
    webappId: String(webappId).trim(),
    rhSite: String(rhSite || '').toLowerCase() === 'intl' ? 'intl' : 'cn',
    title: String(title).trim(),
    description: description ? String(description) : '',
    categoryId: categoryId || '',
    coverUrl: coverUrl || '',
    order: list.length,
    addedAt: Date.now(),
  };
  list.push(newApp);
  saveJson(config.RH_TOOL_APPS_FILE, list);
  res.json({ success: true, data: newApp });
});

// 更新应用
router.put('/rh-tool-apps/:id', (req, res) => {
  const { id } = req.params;
  const list = loadJson(config.RH_TOOL_APPS_FILE, []);
  const app = list.find((a) => a.id === id);
  if (!app) return res.json({ success: false, error: '应用不存在' });
  const { webappId, title, description, categoryId, coverUrl, rhSite } = req.body || {};
  if (typeof webappId === 'string' && webappId.trim()) app.webappId = webappId.trim();
  if (typeof title === 'string' && title.trim()) app.title = title.trim();
  if (typeof description === 'string') app.description = description;
  if (typeof categoryId === 'string') app.categoryId = categoryId;
  if (typeof coverUrl === 'string') app.coverUrl = coverUrl;
  if (typeof rhSite === 'string') app.rhSite = rhSite.toLowerCase() === 'intl' ? 'intl' : 'cn';
  saveJson(config.RH_TOOL_APPS_FILE, list);
  res.json({ success: true, data: app });
});

// 删除应用
router.delete('/rh-tool-apps/:id', (req, res) => {
  const { id } = req.params;
  let list = loadJson(config.RH_TOOL_APPS_FILE, []);
  const len = list.length;
  list = list.filter((a) => a.id !== id);
  if (list.length === len) return res.json({ success: false, error: '应用不存在' });
  saveJson(config.RH_TOOL_APPS_FILE, list);
  res.json({ success: true });
});

// 应用排序
router.post('/rh-tool-apps/reorder', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.json({ success: false, error: '参数错误' });
  const list = loadJson(config.RH_TOOL_APPS_FILE, []);
  const map = new Map(list.map((a) => [a.id, a]));
  const reordered = [];
  ids.forEach((id, idx) => {
    const a = map.get(id);
    if (a) {
      a.order = idx;
      reordered.push(a);
      map.delete(id);
    }
  });
  for (const a of map.values()) {
    a.order = reordered.length;
    reordered.push(a);
  }
  saveJson(config.RH_TOOL_APPS_FILE, reordered);
  res.json({ success: true, data: reordered });
});

// RH 超市导出: 分类 + 应用一次性备份，便于版本迁移。
router.get('/rh-tools/export', (_req, res) => {
  const categories = loadJson(config.RH_TOOL_CATEGORIES_FILE, [])
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const tools = loadJson(config.RH_TOOL_APPS_FILE, [])
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json({
    success: true,
    data: {
      schema: 't8-rh-tools',
      version: 1,
      exportedAt: new Date().toISOString(),
      categories,
      tools,
    },
  });
});

// RH 超市导入: 默认覆盖当前 RH 超市数据，保留备份内 id 以兼容画布节点选中的应用。
router.post('/rh-tools/import', (req, res) => {
  try {
    const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
    const normalized = normalizeRhToolsBackup(req.body || {});

    let categories = normalized.categories;
    let tools = normalized.tools;

    if (mode === 'merge') {
      const existingCategories = loadJson(config.RH_TOOL_CATEGORIES_FILE, []);
      const existingTools = loadJson(config.RH_TOOL_APPS_FILE, []);
      const catByName = new Map(existingCategories.map((c) => [String(c.name || '').trim(), c]));
      const mergedCategories = [...existingCategories];
      const catIdMap = new Map();
      for (const c of normalized.categories) {
        const existing = catByName.get(c.name);
        if (existing) {
          catIdMap.set(c.id, existing.id);
          continue;
        }
        c.order = mergedCategories.length;
        mergedCategories.push(c);
        catIdMap.set(c.id, c.id);
      }

      const toolIdentity = (tool) => `${normalizeRhSite(tool?.rhSite)}:${String(tool?.webappId || '').trim()}`;
      const toolByWebapp = new Map(existingTools.map((t) => [toolIdentity(t), t]));
      const mergedTools = [...existingTools];
      for (const t of normalized.tools) {
        const mappedCategory = catIdMap.get(t.categoryId) || t.categoryId || '';
        const existing = toolByWebapp.get(toolIdentity(t));
        if (existing) {
          Object.assign(existing, { ...t, id: existing.id, categoryId: mappedCategory });
        } else {
          t.categoryId = mappedCategory;
          t.order = mergedTools.length;
          mergedTools.push(t);
        }
      }
      categories = mergedCategories.map((c, idx) => ({ ...c, order: idx }));
      tools = mergedTools.map((t, idx) => ({ ...t, order: idx }));
    }

    saveJson(config.RH_TOOL_CATEGORIES_FILE, categories);
    saveJson(config.RH_TOOL_APPS_FILE, tools);
    res.json({
      success: true,
      data: {
        categories,
        tools,
        categoryCount: categories.length,
        toolCount: tools.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

module.exports = router;
module.exports.loadSettings = loadSettings;
module.exports.saveSettings = saveSettings;
module.exports.ensureLocalSavePaths = ensureLocalSavePaths;
module.exports.scheduleLocalSavePathProbe = scheduleLocalSavePathProbe;
