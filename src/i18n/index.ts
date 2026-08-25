import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export type UiLocale = keyof typeof resources;
export const UI_LOCALE_STORAGE_KEY = 't8-ui-locale-v1';

export function normalizeUiLocale(value: unknown): UiLocale | null {
  if (value === 'zh-CN' || value === 'en-US') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';
  return null;
}

export function readStoredUiLocale(): UiLocale | null {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeUiLocale(window.localStorage.getItem(UI_LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function resolveUiLocalePreference(stored: unknown, browserLocale: unknown): UiLocale {
  return normalizeUiLocale(stored) || normalizeUiLocale(browserLocale) || 'zh-CN';
}

export function resolveInitialUiLocale(): UiLocale {
  const stored = readStoredUiLocale();
  const browserLocale = typeof navigator === 'undefined' ? '' : navigator.languages?.[0] || navigator.language;
  return resolveUiLocalePreference(stored, browserLocale);
}

const initialLocale = resolveInitialUiLocale();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: 'zh-CN',
  defaultNS: 'common',
  ns: ['common', 'shell', 'canvas', 'nodes', 'resources', 'settings', 'electron', 'errors'],
  interpolation: { escapeValue: false },
  returnNull: false,
  initImmediate: false,
});

if (typeof document !== 'undefined') document.documentElement.lang = initialLocale;

i18n.on('languageChanged', (language) => {
  const locale = normalizeUiLocale(language) || 'zh-CN';
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
});

export default i18n;
