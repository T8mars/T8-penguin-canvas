'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

function loadManifest() {
  const candidates = [
    process.env.T8PC_RES ? path.join(process.env.T8PC_RES, 'shared', 'achievementManifest.json') : '',
    path.resolve(__dirname, '..', '..', '..', 'shared', 'achievementManifest.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {
      // Try the next known layout.
    }
  }
  return require('../../../shared/achievementManifest.json');
}

const manifest = loadManifest();

const SCHEMA = 't8-achievements';
const VERSION = 1;
const MAX_EVENTS = 120;
const MAX_TICK_SECONDS = 30;
const SESSION_GAP_MS = 5 * 60 * 1000;
const THEME_STYLES = new Set(manifest.themes.map((theme) => theme.style));
const EVENT_TYPES = new Set([
  'theme.active_tick',
  'theme.switched',
  'hidden_mode.enabled',
  'hidden_mode.used',
  'node.created',
  'node.run_success',
  'resource.saved',
  'workflow.saved',
  'panorama.generated',
  'parsehub.resolved',
]);

function nowIso(ts = Date.now()) {
  return new Date(ts).toISOString();
}

function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeText(value, fallback = '') {
  return String(value || fallback)
    .trim()
    .replace(/[^\w.\-:/]/g, '')
    .slice(0, 96);
}

function normalizeTheme(style) {
  const raw = String(style || '').trim();
  return THEME_STYLES.has(raw) ? raw : 'tech';
}

function buildDefinitions() {
  return manifest.themes.flatMap((theme) => {
    const timeDefs = manifest.timeMilestones.map((milestone) => ({
      id: `${theme.style}-time-${milestone.key}`,
      theme: theme.style,
      themeLabel: theme.label,
      title: milestone.titleTemplate.replace('{theme}', theme.label),
      description: milestone.descriptionTemplate.replace('{theme}', theme.label),
      rarity: milestone.rarity,
      condition: {
        type: 'time',
        seconds: milestone.seconds,
        count: milestone.seconds,
        metric: 'activeSeconds',
      },
      medal: milestone.rarity === 'master',
      hidden: false,
    }));
    const featuredDefs = theme.featured.map((item) => ({
      id: `${theme.style}-${item.idSuffix}`,
      theme: theme.style,
      themeLabel: theme.label,
      title: item.title,
      description: item.description,
      rarity: item.rarity,
      condition: item.condition,
      medal: item.rarity === 'master' || item.rarity === 'gold' || item.rarity === 'hidden',
      hidden: item.rarity === 'hidden',
    }));
    return [...timeDefs, ...featuredDefs];
  });
}

const DEFINITIONS = buildDefinitions();
const DEFINITIONS_BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

function emptyThemeStats() {
  return {
    activeSeconds: 0,
    sessions: 0,
    lastActiveAt: '',
    dailySeconds: {},
    nodesCreated: 0,
    runsSucceeded: 0,
    resourcesSaved: 0,
    workflowsSaved: 0,
    hiddenModeActivations: 0,
    hiddenModeUses: 0,
    panoramasGenerated: 0,
    parseHubResolved: 0,
    nodeTypeCounts: {},
    nodeRunCounts: {},
    hiddenModes: {},
  };
}

function defaultData() {
  const profileId = `local_${crypto.randomBytes(8).toString('hex')}`;
  return {
    schema: SCHEMA,
    version: VERSION,
    profileId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    themeStats: Object.fromEntries(manifest.themes.map((theme) => [theme.style, emptyThemeStats()])),
    events: [],
    unlockedAchievements: {},
    claimedMedals: {},
    unlockedFilms: {},
    preferences: {
      enabled: true,
      showToast: true,
      showTopBadge: true,
    },
  };
}

function ensureDir() {
  fs.mkdirSync(path.dirname(config.ACHIEVEMENTS_FILE), { recursive: true });
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function ensureThemeStats(data, theme) {
  const key = normalizeTheme(theme);
  data.themeStats = ensureObject(data.themeStats);
  const raw = ensureObject(data.themeStats[key]);
  data.themeStats[key] = {
    ...emptyThemeStats(),
    ...raw,
    activeSeconds: Math.max(0, Math.floor(Number(raw.activeSeconds) || 0)),
    sessions: Math.max(0, Math.floor(Number(raw.sessions) || 0)),
    dailySeconds: ensureObject(raw.dailySeconds),
    nodeTypeCounts: ensureObject(raw.nodeTypeCounts),
    nodeRunCounts: ensureObject(raw.nodeRunCounts),
    hiddenModes: ensureObject(raw.hiddenModes),
  };
  return data.themeStats[key];
}

function sanitizeData(raw) {
  const data = raw && typeof raw === 'object' ? raw : defaultData();
  data.schema = SCHEMA;
  data.version = VERSION;
  data.profileId = safeText(data.profileId, `local_${crypto.randomBytes(8).toString('hex')}`);
  data.createdAt = typeof data.createdAt === 'string' ? data.createdAt : nowIso();
  data.updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : nowIso();
  data.events = Array.isArray(data.events) ? data.events.slice(-MAX_EVENTS) : [];
  data.unlockedAchievements = ensureObject(data.unlockedAchievements);
  data.claimedMedals = ensureObject(data.claimedMedals);
  data.unlockedFilms = ensureObject(data.unlockedFilms);
  data.preferences = {
    enabled: data.preferences?.enabled !== false,
    showToast: data.preferences?.showToast !== false,
    showTopBadge: data.preferences?.showTopBadge !== false,
  };
  manifest.themes.forEach((theme) => ensureThemeStats(data, theme.style));
  return data;
}

function loadData() {
  ensureDir();
  if (!fs.existsSync(config.ACHIEVEMENTS_FILE)) {
    const data = defaultData();
    saveData(data);
    return data;
  }
  try {
    return sanitizeData(JSON.parse(fs.readFileSync(config.ACHIEVEMENTS_FILE, 'utf8')));
  } catch (error) {
    const backup = `${config.ACHIEVEMENTS_FILE}.broken-${Date.now()}`;
    try { fs.copyFileSync(config.ACHIEVEMENTS_FILE, backup); } catch (_) {}
    console.warn('[achievements] achievements.json 已损坏，已重建:', error?.message || error);
    const data = defaultData();
    saveData(data);
    return data;
  }
}

function saveData(data) {
  ensureDir();
  data.updatedAt = nowIso();
  fs.writeFileSync(config.ACHIEVEMENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function countForNodeTypes(map, nodeTypes) {
  const source = ensureObject(map);
  const list = Array.isArray(nodeTypes) ? nodeTypes : [];
  if (list.length === 0) {
    return Object.values(source).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }
  return list.reduce((sum, nodeType) => sum + (Number(source[nodeType]) || 0), 0);
}

function hiddenCount(stats, condition) {
  const kind = safeText(condition.kind);
  const mode = condition.mode === 'used' ? 'used' : 'enabled';
  if (!kind) return 0;
  return Number(stats.hiddenModes?.[kind]?.[mode]) || 0;
}

function metricValue(stats, condition) {
  switch (condition.type) {
    case 'time':
      return Number(stats.activeSeconds) || 0;
    case 'nodeCreated':
      return countForNodeTypes(stats.nodeTypeCounts, condition.nodeTypes);
    case 'nodeRun':
      return countForNodeTypes(stats.nodeRunCounts, condition.nodeTypes);
    case 'hidden':
      return hiddenCount(stats, condition);
    case 'counter': {
      const metric = safeText(condition.metric);
      return Number(stats[metric]) || 0;
    }
    default:
      return 0;
  }
}

function conditionTarget(condition) {
  if (condition.type === 'time') return Number(condition.seconds) || Number(condition.count) || 1;
  return Number(condition.count) || 1;
}

function evaluateUnlocks(data, event) {
  const unlocked = [];
  for (const definition of DEFINITIONS) {
    if (data.unlockedAchievements[definition.id]) continue;
    const stats = ensureThemeStats(data, definition.theme);
    if (metricValue(stats, definition.condition) < conditionTarget(definition.condition)) continue;
    data.unlockedAchievements[definition.id] = {
      id: definition.id,
      theme: definition.theme,
      title: definition.title,
      rarity: definition.rarity,
      unlockedAt: nowIso(),
      eventType: event?.type || 'migration',
    };
    unlocked.push(definition);
  }

  const unlockedFilms = [];
  for (const film of manifest.films) {
    if (data.unlockedFilms[film.id]) continue;
    if (!data.unlockedAchievements[film.unlockAchievementId]) continue;
    data.unlockedFilms[film.id] = {
      id: film.id,
      theme: normalizeTheme(film.theme),
      title: film.title,
      unlockedAt: nowIso(),
      sourceAchievementId: film.unlockAchievementId,
      hasMedia: false,
      status: 'awaiting-media',
      lockedText: film.lockedText || '待解锁',
      unavailableText: film.unavailableText || '影片素材待提供',
      playedSeconds: 0,
    };
    unlockedFilms.push(data.unlockedFilms[film.id]);
  }
  return { unlocked, unlockedFilms };
}

function sanitizeEvent(payload) {
  const type = String(payload?.type || '').trim();
  if (!EVENT_TYPES.has(type)) return null;
  const at = Date.now();
  const event = {
    type,
    theme: normalizeTheme(payload?.theme),
    at: nowIso(at),
  };
  if (type === 'theme.active_tick') {
    event.amountSeconds = Math.max(0, Math.min(MAX_TICK_SECONDS, Math.floor(Number(payload?.amountSeconds) || 0)));
  }
  if (payload?.nodeType) event.nodeType = safeText(payload.nodeType);
  if (payload?.kind) event.kind = safeText(payload.kind);
  if (payload?.category) event.category = safeText(payload.category);
  return event;
}

function bump(map, key, amount = 1) {
  if (!key) return;
  map[key] = Math.max(0, Math.floor(Number(map[key]) || 0)) + amount;
}

function applyEventToStats(data, event) {
  const stats = ensureThemeStats(data, event.theme);
  if (event.type === 'theme.active_tick') {
    const amount = Math.max(0, Math.min(MAX_TICK_SECONDS, Number(event.amountSeconds) || 0));
    if (amount <= 0) return;
    const previous = stats.lastActiveAt ? Date.parse(stats.lastActiveAt) : 0;
    const current = Date.parse(event.at) || Date.now();
    if (!previous || current - previous > SESSION_GAP_MS) stats.sessions += 1;
    stats.activeSeconds += amount;
    const day = localDateKey(current);
    stats.dailySeconds[day] = Math.max(0, Math.floor(Number(stats.dailySeconds[day]) || 0)) + amount;
    stats.lastActiveAt = event.at;
    return;
  }
  if (event.type === 'node.created') {
    stats.nodesCreated += 1;
    bump(stats.nodeTypeCounts, event.nodeType || 'unknown');
    return;
  }
  if (event.type === 'node.run_success') {
    stats.runsSucceeded += 1;
    bump(stats.nodeRunCounts, event.nodeType || 'unknown');
    return;
  }
  if (event.type === 'hidden_mode.enabled' || event.type === 'hidden_mode.used') {
    const kind = event.kind || 'unknown';
    stats.hiddenModes[kind] = ensureObject(stats.hiddenModes[kind]);
    if (event.type === 'hidden_mode.enabled') {
      stats.hiddenModeActivations += 1;
      bump(stats.hiddenModes[kind], 'enabled');
    } else {
      stats.hiddenModeUses += 1;
      bump(stats.hiddenModes[kind], 'used');
    }
    return;
  }
  if (event.type === 'resource.saved') {
    stats.resourcesSaved += 1;
    return;
  }
  if (event.type === 'workflow.saved') {
    stats.workflowsSaved += 1;
    return;
  }
  if (event.type === 'panorama.generated') {
    stats.panoramasGenerated += 1;
    return;
  }
  if (event.type === 'parsehub.resolved') {
    stats.parseHubResolved += 1;
  }
}

function buildSummary(data, unlockResult = { unlocked: [], unlockedFilms: [] }) {
  const today = localDateKey();
  const totalActiveSeconds = Object.values(data.themeStats || {}).reduce(
    (sum, stats) => sum + (Number(stats?.activeSeconds) || 0),
    0,
  );
  const todaySeconds = Object.values(data.themeStats || {}).reduce(
    (sum, stats) => sum + (Number(stats?.dailySeconds?.[today]) || 0),
    0,
  );
  return {
    today,
    todaySeconds,
    totalActiveSeconds,
    achievementCount: DEFINITIONS.length,
    unlockedCount: Object.keys(data.unlockedAchievements || {}).length,
    filmCount: manifest.films.length,
    unlockedFilmCount: Object.keys(data.unlockedFilms || {}).length,
    recentUnlocks: unlockResult.unlocked,
    recentFilms: unlockResult.unlockedFilms,
  };
}

function publicData(data, unlockResult) {
  return {
    profile: data,
    manifest,
    definitions: DEFINITIONS,
    summary: buildSummary(data, unlockResult),
  };
}

function getProfile() {
  const data = loadData();
  const unlockResult = evaluateUnlocks(data, null);
  if (unlockResult.unlocked.length > 0 || unlockResult.unlockedFilms.length > 0) saveData(data);
  return publicData(data, unlockResult);
}

function recordEvent(payload) {
  const data = loadData();
  const event = sanitizeEvent(payload);
  if (!event) return { ...publicData(data), ignored: true };
  if (data.preferences?.enabled === false && event.type !== 'theme.switched') {
    return { ...publicData(data), ignored: true };
  }
  applyEventToStats(data, event);
  data.events.push(event);
  data.events = data.events.slice(-MAX_EVENTS);
  const unlockResult = evaluateUnlocks(data, event);
  saveData(data);
  return { ...publicData(data, unlockResult), event, ignored: false };
}

function setPreferences(patch) {
  const data = loadData();
  data.preferences = {
    ...data.preferences,
    ...(typeof patch?.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
    ...(typeof patch?.showToast === 'boolean' ? { showToast: patch.showToast } : {}),
    ...(typeof patch?.showTopBadge === 'boolean' ? { showTopBadge: patch.showTopBadge } : {}),
  };
  saveData(data);
  return publicData(data);
}

function resetData() {
  const data = defaultData();
  saveData(data);
  return publicData(data);
}

function exportData() {
  return loadData();
}

function importData(raw) {
  const data = sanitizeData(raw?.data || raw);
  const unlockResult = evaluateUnlocks(data, null);
  saveData(data);
  return publicData(data, unlockResult);
}

module.exports = {
  buildDefinitions,
  getProfile,
  recordEvent,
  setPreferences,
  resetData,
  exportData,
  importData,
  normalizeTheme,
  _private: {
    sanitizeEvent,
    metricValue,
    conditionTarget,
    defaultData,
    loadData,
  },
};
