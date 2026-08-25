const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./i18n-catalog.json');

const DEFAULT_ELECTRON_LOCALE = 'zh-CN';
const SUPPORTED_ELECTRON_LOCALES = Object.freeze(['zh-CN', 'en-US']);
let currentElectronLocale = DEFAULT_ELECTRON_LOCALE;

function normalizeElectronLocale(value) {
  if (value === 'zh-CN' || value === 'en-US') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';
  return null;
}

function resolveElectronLocale(userLocale, osLocale) {
  return normalizeElectronLocale(userLocale)
    || normalizeElectronLocale(osLocale)
    || DEFAULT_ELECTRON_LOCALE;
}

function getCatalogValue(locale, key) {
  const segments = String(key || '').split('.').filter(Boolean);
  let value = catalog[locale] || catalog[DEFAULT_ELECTRON_LOCALE];
  for (const segment of segments) {
    if (!value || typeof value !== 'object') return null;
    value = value[segment];
  }
  return typeof value === 'string' ? value : null;
}

function interpolate(template, params = {}) {
  return String(template).replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key) => {
    const value = params && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : '';
    return value == null ? '' : String(value);
  });
}

function electronT(key, params = {}, locale = currentElectronLocale) {
  const normalized = normalizeElectronLocale(locale) || DEFAULT_ELECTRON_LOCALE;
  const template = getCatalogValue(normalized, key)
    || getCatalogValue(DEFAULT_ELECTRON_LOCALE, key)
    || String(key || '');
  return interpolate(template, params);
}

function setElectronLocale(locale) {
  currentElectronLocale = normalizeElectronLocale(locale) || DEFAULT_ELECTRON_LOCALE;
  return currentElectronLocale;
}

function getElectronLocale() {
  return currentElectronLocale;
}

function readPersistedElectronLocale(dataRoot) {
  try {
    const settingsPath = path.join(path.resolve(String(dataRoot || '')), 'data', 'settings.json');
    const stat = fs.statSync(settingsPath);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeElectronLocale(parsed?.preferences?.uiLocale);
  } catch (_) {
    return null;
  }
}

function initializeElectronLocale(dataRoot, osLocale) {
  return setElectronLocale(resolveElectronLocale(readPersistedElectronLocale(dataRoot), osLocale));
}

module.exports = {
  DEFAULT_ELECTRON_LOCALE,
  SUPPORTED_ELECTRON_LOCALES,
  catalog,
  normalizeElectronLocale,
  resolveElectronLocale,
  readPersistedElectronLocale,
  initializeElectronLocale,
  setElectronLocale,
  getElectronLocale,
  electronT,
};
