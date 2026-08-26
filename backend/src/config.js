const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('node:crypto');

// T8-penguin-canvas 后端配置
// 运行模式:
//   - 开发: backend/src/config.js 底下的 PROJECT_DIR 即项目根
//   - 打包: 主进程 electron/main.cjs 会注入 T8PC_PACKAGED=1 与 T8PC_USER_DATA=<userData>
//   - 开发验收: 可显式注入绝对路径 T8PC_DEV_DATA_ROOT，把临时数据库和素材隔离到
//               项目目录之外；打包模式始终忽略该变量。
//             数据/输入/输出/缩略图都位于该 userData 下,近可读写;
//             前端静态产物位于 T8PC_FRONTEND_DIST(默认 resources/frontend)。
const IS_PACKAGED = process.env.T8PC_PACKAGED === '1';
const mib = (value) => value * 1024 * 1024;

function resolveDevelopmentProjectDatabaseStoragePolicy32() {
  if (IS_PACKAGED) return undefined;
  const profile = String(process.env.T8PC_DEV_PROJECT_DB_STORAGE_PROFILE || '').trim();
  if (!profile) return undefined;
  if (profile !== 'acceptance-small-v1') {
    throw new Error('T8PC_DEV_PROJECT_DB_STORAGE_PROFILE 仅支持 acceptance-small-v1');
  }
  return Object.freeze({
    mainMaxBytes: mib(64),
    walCheckpointTargetBytes: mib(1),
    maximumSingleTransactionWalBytes: mib(4),
    walPressureBytes: mib(8),
    walReserveBytes: mib(16),
    walResidualLimitBytes: mib(0.5),
    shmReserveBytes: mib(4),
    hotJournalReserveBytes: mib(8),
    sqliteTempReserveBytes: mib(16),
    minimumFilesystemFreeBytes: mib(64),
    backupCandidateReserveBytes: mib(80),
    recoveryEvidenceReserveBytes: mib(96),
  });
}
const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const DEV_MANAGEMENT_AUTHORITY_FILE = path.join(PROJECT_DIR, '.t8-collaboration-management-authority.json');
const MANAGEMENT_AUTHORITY_SCHEMA = 't8-collaboration-management-authority-v1';
const MANAGEMENT_AUTHORITY_CREATE_WAIT = new Int32Array(new SharedArrayBuffer(4));

function normalizedManagementAuthorityToken(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : '';
}

function readDevManagementAuthority() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DEV_MANAGEMENT_AUTHORITY_FILE, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw new Error('本地协作管理 authority 文件无法读取');
  }
  const token = parsed?.schema === MANAGEMENT_AUTHORITY_SCHEMA
    ? normalizedManagementAuthorityToken(parsed.token)
    : '';
  if (!token) throw new Error('本地协作管理 authority 文件格式无效');
  return token;
}

function readDevManagementAuthorityAfterConcurrentCreate() {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const token = readDevManagementAuthority();
      if (token) return token;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 19) Atomics.wait(MANAGEMENT_AUTHORITY_CREATE_WAIT, 0, 0, 10);
  }
  if (lastError) throw lastError;
  throw new Error('本地协作管理 authority 文件并发创建未完成');
}

function ensureDevManagementAuthority() {
  const existing = readDevManagementAuthority();
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString('base64url');
  const record = `${JSON.stringify({
    schema: MANAGEMENT_AUTHORITY_SCHEMA,
    version: 1,
    token,
  }, null, 2)}\n`;
  try {
    fs.writeFileSync(DEV_MANAGEMENT_AUTHORITY_FILE, record, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    try { fs.chmodSync(DEV_MANAGEMENT_AUTHORITY_FILE, 0o600); } catch (_) {}
    return token;
  } catch (error) {
    if (error?.code === 'EEXIST') return readDevManagementAuthorityAfterConcurrentCreate();
    throw new Error('本地协作管理 authority 文件无法安全创建');
  }
}

function resolveManagementAuthorityToken() {
  const injectedRaw = process.env.T8_COLLAB_MANAGEMENT_TOKEN;
  if (injectedRaw != null) {
    delete process.env.T8_COLLAB_MANAGEMENT_TOKEN;
    const injected = normalizedManagementAuthorityToken(injectedRaw);
    if (!injected) throw new Error('T8_COLLAB_MANAGEMENT_TOKEN 格式无效');
    return injected;
  }
  if (IS_PACKAGED) throw new Error('打包后端缺少协作管理 authority token');
  return ensureDevManagementAuthority();
}

function resolveAppVersion() {
  const injected = String(process.env.T8PC_APP_VERSION || '').trim();
  if (injected) return injected;
  try {
    return String(JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'package.json'), 'utf8')).version || '').trim() || '0.0.0-dev';
  } catch (_) {
    return '0.0.0-dev';
  }
}
const APP_VERSION = resolveAppVersion();

function resolveBackendInstanceId() {
  const injectedRaw = process.env.T8PC_BACKEND_INSTANCE_ID;
  if (injectedRaw != null) {
    delete process.env.T8PC_BACKEND_INSTANCE_ID;
    const injected = String(injectedRaw || '').trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(injected)) {
      throw new Error('T8PC_BACKEND_INSTANCE_ID 格式无效');
    }
    return injected;
  }
  return crypto.randomBytes(32).toString('base64url');
}

const BACKEND_INSTANCE_ID = resolveBackendInstanceId();
function resolveDevelopmentDataRoot() {
  if (IS_PACKAGED) return '';
  const injected = String(process.env.T8PC_DEV_DATA_ROOT || '').trim();
  if (!injected) return '';
  if (!path.isAbsolute(injected)) {
    throw new Error('T8PC_DEV_DATA_ROOT 必须是绝对路径');
  }
  return path.resolve(injected);
}

const USER_DATA = process.env.T8PC_USER_DATA && process.env.T8PC_USER_DATA.trim().length > 0
  ? process.env.T8PC_USER_DATA
  : PROJECT_DIR;
const DEVELOPMENT_DATA_ROOT = resolveDevelopmentDataRoot();
const DATA_ROOT = IS_PACKAGED
  ? USER_DATA
  : (DEVELOPMENT_DATA_ROOT || PROJECT_DIR);
const USER_HOME_DIR = os.homedir() || process.env.USERPROFILE || process.env.HOME || PROJECT_DIR;
const LEGACY_WINDOWS_DEFAULT_ROOT = 'D:\\zhenzhen';
const DEFAULT_ZHENZHEN_ROOT = process.platform === 'win32'
  ? LEGACY_WINDOWS_DEFAULT_ROOT
  : path.join(USER_HOME_DIR, 'zhenzhen');
const DEFAULT_RESOURCE_LIBRARY_DIR = path.join(DEFAULT_ZHENZHEN_ROOT, 'resources');
const DEFAULT_THEME_TEMPLATE_DIR = path.join(DEFAULT_ZHENZHEN_ROOT, 'theme-templates');

const config = {
  // 服务器
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || 18766, // 注意:与主项目 18765 错开
  APP_VERSION,
  BACKEND_INSTANCE_ID,
  HTTP_SHUTDOWN_TIMEOUT_MS: Math.max(100, Math.min(120_000, Number.parseInt(process.env.T8PC_HTTP_SHUTDOWN_TIMEOUT_MS || '5000', 10) || 5_000)),
  NODE_ENV: process.env.NODE_ENV || (IS_PACKAGED ? 'production' : 'development'),
  IS_PACKAGED,

  // 数据 / 资源目录
  // 开发模式: 项目根下 data/input/output/thumbnails
  // 打包模式: %APPDATA%/T8-PenguinCanvas/data ...走 userData
  BASE_DIR: DATA_ROOT,
  DATA_DIR: path.join(DATA_ROOT, 'data'),
  INPUT_DIR: path.join(DATA_ROOT, 'input'),
  OUTPUT_DIR: path.join(DATA_ROOT, 'output'),
  THUMBNAILS_DIR: path.join(DATA_ROOT, 'thumbnails'),
  ASSET_PREVIEWS_DIR: path.join(DATA_ROOT, 'thumbnails', 'asset-previews'),
  ASSET_BLOB_DIR: path.join(DATA_ROOT, 'data', 'asset-blobs'),
  COLLAB_UPLOAD_TEMP_DIR: path.join(DATA_ROOT, 'data', 'collaboration-uploads'),
  COLLAB_PUBLIC_EXPOSURE_FILE: path.join(DATA_ROOT, 'data', 'collaboration-public-exposure.json'),
  ASSET_SEMANTIC_MODELS_DIR: path.join(DATA_ROOT, 'semantic-models'),
  ASSET_SEMANTIC_WORK_DIR: path.join(DATA_ROOT, 'data', 'asset-semantic'),
  ASSET_SEMANTIC_SNAPSHOTS_DIR: path.join(DATA_ROOT, 'data', 'asset-semantic', 'snapshots'),
  ASSET_SEMANTIC_CONCURRENCY: Math.max(1, Math.min(1, Number(process.env.T8_ASSET_SEMANTIC_CONCURRENCY) || 1)),
  ASSET_SEMANTIC_MAX_ATTEMPTS: Math.max(1, Math.min(3, Number(process.env.T8_ASSET_SEMANTIC_MAX_ATTEMPTS) || 3)),
  ASSET_SEMANTIC_RETRY_BASE_MS: Math.max(100, Math.min(60_000, Number(process.env.T8_ASSET_SEMANTIC_RETRY_BASE_MS) || 1_500)),
  ASSET_SEMANTIC_JOB_TIMEOUT_MS: Math.max(30_000, Math.min(30 * 60_000, Number(process.env.T8_ASSET_SEMANTIC_JOB_TIMEOUT_MS) || 10 * 60_000)),
  ASSET_SEMANTIC_PIPELINE_VERSION: 'asset-semantic-v1',
  PROJECT_DB_FILE: path.join(DATA_ROOT, 'data', 't8-projects.sqlite3'),
  PROJECT_DB_BACKUP_FILE: path.join(DATA_ROOT, 'data', 't8-projects.sqlite3.backup'),
  PROJECT_DB_STORAGE_POLICY_32: resolveDevelopmentProjectDatabaseStoragePolicy32(),
  COLLAB_HOST: process.env.T8_COLLAB_HOST || '127.0.0.1',
  COLLAB_PORT: Number(process.env.T8_COLLAB_PORT || 18767),
  COLLAB_MANAGEMENT_TOKEN: resolveManagementAuthorityToken(),
  COLLAB_ALLOWED_ORIGINS: String(process.env.T8_COLLAB_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  COLLAB_PUBLIC_BASE_URL: String(process.env.T8_COLLAB_PUBLIC_BASE_URL || '').trim(),
  // Forwarded headers are ignored unless the immediately connected proxy is
  // explicitly listed here. Values are exact IPv4/IPv6 addresses, not hop counts.
  COLLAB_TRUST_PROXY_ADDRESSES: String(process.env.T8_COLLAB_TRUST_PROXY_ADDRESSES || '').split(',').map((value) => value.trim()).filter(Boolean),
  COLLAB_RATE_LIMIT_MAX_BUCKETS: Math.max(64, Math.min(65_536, Number(process.env.T8_COLLAB_RATE_LIMIT_MAX_BUCKETS) || 4_096)),
  COLLAB_INVITE_REDEEMS_PER_MINUTE_PER_IP: Math.max(1, Math.min(1_000, Number(process.env.T8_COLLAB_INVITE_REDEEMS_PER_MINUTE_PER_IP) || 12)),
  COLLAB_INVITE_REDEEMS_PER_MINUTE_PER_CODE: Math.max(1, Math.min(1_000, Number(process.env.T8_COLLAB_INVITE_REDEEMS_PER_MINUTE_PER_CODE) || 12)),
  COLLAB_UPLOAD_REQUESTS_PER_MINUTE_PER_IP: Math.max(1, Math.min(10_000, Number(process.env.T8_COLLAB_UPLOAD_REQUESTS_PER_MINUTE_PER_IP) || 600)),
  COLLAB_UPLOAD_REQUESTS_PER_MINUTE_PER_SESSION: Math.max(1, Math.min(10_000, Number(process.env.T8_COLLAB_UPLOAD_REQUESTS_PER_MINUTE_PER_SESSION) || 300)),
  COLLAB_UPLOAD_BYTES_PER_MINUTE_PER_IP: Math.max(1024 * 1024, Math.min(64 * 1024 * 1024 * 1024, Number(process.env.T8_COLLAB_UPLOAD_BYTES_PER_MINUTE_PER_IP) || 1024 * 1024 * 1024)),
  COLLAB_UPLOAD_BYTES_PER_MINUTE_PER_SESSION: Math.max(1024 * 1024, Math.min(32 * 1024 * 1024 * 1024, Number(process.env.T8_COLLAB_UPLOAD_BYTES_PER_MINUTE_PER_SESSION) || 512 * 1024 * 1024)),
  COLLAB_DOWNLOAD_REQUESTS_PER_MINUTE_PER_IP: Math.max(1, Math.min(10_000, Number(process.env.T8_COLLAB_DOWNLOAD_REQUESTS_PER_MINUTE_PER_IP) || 600)),
  COLLAB_DOWNLOAD_REQUESTS_PER_MINUTE_PER_SESSION: Math.max(1, Math.min(10_000, Number(process.env.T8_COLLAB_DOWNLOAD_REQUESTS_PER_MINUTE_PER_SESSION) || 300)),
  COLLAB_DOWNLOAD_BYTES_PER_SECOND_PER_IP: Math.max(64 * 1024, Math.min(4 * 1024 * 1024 * 1024, Number(process.env.T8_COLLAB_DOWNLOAD_BYTES_PER_SECOND_PER_IP) || 64 * 1024 * 1024)),
  COLLAB_DOWNLOAD_BYTES_PER_SECOND_PER_SESSION: Math.max(64 * 1024, Math.min(2 * 1024 * 1024 * 1024, Number(process.env.T8_COLLAB_DOWNLOAD_BYTES_PER_SECOND_PER_SESSION) || 32 * 1024 * 1024)),
  COLLAB_WS_MAX_CONNECTIONS_PER_IP: Math.max(1, Math.min(1_024, Number(process.env.T8_COLLAB_WS_MAX_CONNECTIONS_PER_IP) || 64)),
  COLLAB_WS_MAX_CONNECTIONS_PER_SESSION: Math.max(1, Math.min(128, Number(process.env.T8_COLLAB_WS_MAX_CONNECTIONS_PER_SESSION) || 8)),
  COLLAB_WS_HANDSHAKES_PER_MINUTE_PER_IP: Math.max(1, Math.min(10_000, Number(process.env.T8_COLLAB_WS_HANDSHAKES_PER_MINUTE_PER_IP) || 120)),
  COLLAB_WS_HANDSHAKES_PER_MINUTE_PER_SESSION: Math.max(1, Math.min(1_000, Number(process.env.T8_COLLAB_WS_HANDSHAKES_PER_MINUTE_PER_SESSION) || 60)),
  COLLAB_WS_MESSAGES_PER_WINDOW: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_MESSAGES_PER_WINDOW) || 240)),
  COLLAB_WS_MESSAGE_WINDOW_MS: Math.max(1_000, Math.min(60_000, Number(process.env.T8_COLLAB_WS_MESSAGE_WINDOW_MS) || 10_000)),
  COLLAB_WS_PRESENCE_MESSAGES_PER_WINDOW_PER_IP: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_PRESENCE_MESSAGES_PER_WINDOW_PER_IP) || 1_200)),
  COLLAB_WS_PRESENCE_MESSAGES_PER_WINDOW_PER_SESSION: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_PRESENCE_MESSAGES_PER_WINDOW_PER_SESSION) || 600)),
  COLLAB_WS_HEARTBEAT_MESSAGES_PER_WINDOW_PER_IP: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_HEARTBEAT_MESSAGES_PER_WINDOW_PER_IP) || 600)),
  COLLAB_WS_HEARTBEAT_MESSAGES_PER_WINDOW_PER_SESSION: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_HEARTBEAT_MESSAGES_PER_WINDOW_PER_SESSION) || 120)),
  COLLAB_WS_JOIN_MESSAGES_PER_WINDOW_PER_IP: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_JOIN_MESSAGES_PER_WINDOW_PER_IP) || 120)),
  COLLAB_WS_JOIN_MESSAGES_PER_WINDOW_PER_SESSION: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_JOIN_MESSAGES_PER_WINDOW_PER_SESSION) || 30)),
  COLLAB_WS_UNKNOWN_MESSAGES_PER_WINDOW_PER_IP: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_UNKNOWN_MESSAGES_PER_WINDOW_PER_IP) || 120)),
  COLLAB_WS_UNKNOWN_MESSAGES_PER_WINDOW_PER_SESSION: Math.max(1, Math.min(1_000_000, Number(process.env.T8_COLLAB_WS_UNKNOWN_MESSAGES_PER_WINDOW_PER_SESSION) || 60)),
  COLLAB_PROJECT_QUOTA_BYTES: Math.max(1, Number(process.env.T8_COLLAB_PROJECT_QUOTA_BYTES) || 20 * 1024 * 1024 * 1024),
  COLLAB_MEMBER_QUOTA_BYTES: Math.max(1, Number(process.env.T8_COLLAB_MEMBER_QUOTA_BYTES) || 5 * 1024 * 1024 * 1024),
  COLLAB_UPLOAD_CHUNK_BYTES: Math.max(1024 * 1024, Math.min(16 * 1024 * 1024, Number(process.env.T8_COLLAB_UPLOAD_CHUNK_BYTES) || 8 * 1024 * 1024)),
  COLLAB_MAX_UPLOAD_BYTES: Math.max(1024 * 1024, Math.min(4 * 1024 * 1024 * 1024, Number(process.env.T8_COLLAB_MAX_UPLOAD_BYTES) || 512 * 1024 * 1024)),
  COLLAB_UPLOAD_SESSION_TTL_MS: Math.max(5 * 60 * 1000, Math.min(7 * 24 * 60 * 60 * 1000, Number(process.env.T8_COLLAB_UPLOAD_SESSION_TTL_MS) || 24 * 60 * 60 * 1000)),

  // 数据文件
  CANVAS_FILE: path.join(DATA_ROOT, 'data', 'canvas_list.json'),
  SETTINGS_FILE: path.join(DATA_ROOT, 'data', 'settings.json'),
  FEISHU_BITABLE_PRIVATE_FILE: path.join(DATA_ROOT, 'data', 'feishu_bitable.private.json'),
  VOLCENGINE_ASSETS_CATALOG_FILE: path.join(DATA_ROOT, 'data', 'volcengine_assets_catalog.json'),
  VOLCENGINE_ASSETS_JOBS_FILE: path.join(DATA_ROOT, 'data', 'volcengine_assets_jobs.json'),
  ACHIEVEMENTS_FILE: path.join(DATA_ROOT, 'data', 'achievements.json'),
  RH_APPS_FILE: path.join(DATA_ROOT, 'data', 'rh_apps.json'),
  // v1.2.10+ RH 工具节点专用数据（与 rh_apps.json 完全分开）
  RH_TOOL_CATEGORIES_FILE: path.join(DATA_ROOT, 'data', 'rh_tool_categories.json'),
  RH_TOOL_APPS_FILE: path.join(DATA_ROOT, 'data', 'rh_tool_apps.json'),
  RH_TOOLBOX_MANIFEST_FILE: path.join(DATA_ROOT, 'data', 'rh_toolbox_manifest.json'),
  // 前端静态产物目录(打包后由 Express 同进程托管)
  FRONTEND_DIST: process.env.T8PC_FRONTEND_DIST || (IS_PACKAGED ? '' : path.join(PROJECT_DIR, 'dist')),
  // 缩略图配置
  THUMBNAIL_SIZE: 160,
  THUMBNAIL_QUALITY: 80,
  ASSET_PREVIEW_CONCURRENCY: Math.max(1, Math.min(4, Number.parseInt(process.env.T8PC_ASSET_PREVIEW_CONCURRENCY || '2', 10) || 2)),
  ASSET_PREVIEW_MAX_ATTEMPTS: Math.max(1, Math.min(3, Number.parseInt(process.env.T8PC_ASSET_PREVIEW_MAX_ATTEMPTS || '3', 10) || 3)),
  ASSET_PREVIEW_RETRY_BASE_MS: Math.max(100, Math.min(60_000, Number.parseInt(process.env.T8PC_ASSET_PREVIEW_RETRY_BASE_MS || '750', 10) || 750)),
  ASSET_PREVIEW_EPHEMERAL_QUEUE_LIMIT: Math.max(1, Math.min(256, Number.parseInt(process.env.T8PC_ASSET_PREVIEW_EPHEMERAL_QUEUE_LIMIT || '64', 10) || 64)),
  ASSET_PREVIEW_SHUTDOWN_TIMEOUT_MS: Math.max(100, Math.min(120_000, Number.parseInt(process.env.T8PC_ASSET_PREVIEW_SHUTDOWN_TIMEOUT_MS || '10000', 10) || 10_000)),
  ASSET_PREVIEW_TEMP_MAX_AGE_MS: Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, Number.parseInt(process.env.T8PC_ASSET_PREVIEW_TEMP_MAX_AGE_MS || String(6 * 60 * 60 * 1000), 10) || 6 * 60 * 60 * 1000)),
  ASSET_PREVIEW_PIPELINE_VERSION: 'asset-preview-v2-phash',
  ASSET_INDEX_STABILITY_ATTEMPTS: Math.max(1, Math.min(3, Number.parseInt(process.env.T8PC_ASSET_INDEX_STABILITY_ATTEMPTS || '2', 10) || 2)),

  // 业务配置
  // 上传素材节点不设置应用层大小上限；0 表示交给磁盘和系统自身约束。
  MAX_FILE_SIZE: 0,

  // 三套 API Key 默认值(均可在 settings 中覆盖)
  // 贞贞工坊 / LLM 独立 Key 强制走 https://ai.t8star.org
  ZHENZHEN_BASE_URL: 'https://ai.t8star.org',
  // 贞贞平价 AI 小屋链路：api.seedance.nz 的 LLM、Seedance 2.0、图片、音频等 API。
  ZHENZHEN_SD2_BASE_URL: 'https://api.seedance.nz',
  RH_BASE_URL: 'https://www.runninghub.cn',
  RH_INTL_BASE_URL: 'https://www.runninghub.ai',

  // v1.2.10.2: 全局生成素材自动保存到本地的默认路径
  //   用户可在「API 设置 → 文件自动保存路径」覆盖。
  //   不存在时启动会自动创建; 写入失败仅 console.warn, 不阻断业务。
  DEFAULT_LOCAL_SAVE_DIR: DEFAULT_ZHENZHEN_ROOT,
  // v1.3.1: 画布自动保存导出路径默认同本地素材保存路径。
  //   实际文件会写入 <path>/T8-penguin-canvas/canvases/*.json。
  DEFAULT_CANVAS_AUTO_SAVE_DIR: DEFAULT_ZHENZHEN_ROOT,
  // v1.3.4: 资源库默认路径。资源文件与 resource_library.json 元数据均保存在此路径,
  //   用户更换版本后只要设置同一路径即可继续读取资源库。
  DEFAULT_RESOURCE_LIBRARY_DIR,
  // v1.3.6: 主题模板目录。自定义模板 JSON 保存在这里，内置模板仍打包在前端代码里。
  DEFAULT_THEME_TEMPLATE_DIR,
  // 本地 Eagle API 默认地址。仅允许本机地址，避免桌面端变成远端请求代理。
  DEFAULT_EAGLE_API_BASE: 'http://127.0.0.1:41595',
  // 用于旧版本配置迁移：Windows 继续沿用 D:\zhenzhen，非 Windows 遇到旧硬编码默认值时迁移到用户目录。
  LEGACY_WINDOWS_DEFAULT_ROOT,
};

// 提前创建打包后的数据目录(避免首次启动报错)
if (IS_PACKAGED) {
  for (const dir of [config.DATA_DIR, config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, config.ASSET_PREVIEWS_DIR, config.ASSET_BLOB_DIR, config.COLLAB_UPLOAD_TEMP_DIR]) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }
}

module.exports = config;
