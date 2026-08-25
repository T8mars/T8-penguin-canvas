import { create } from 'zustand';
import i18n, {
  UI_LOCALE_STORAGE_KEY,
  normalizeUiLocale,
  resolveInitialUiLocale,
  type UiLocale,
} from '../i18n';

interface UiLocaleState {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
}

function persistUiLocale(locale: UiLocale) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // A locked-down webview may deny storage. Runtime language still changes.
  }
}

function syncElectronLocale(locale: UiLocale) {
  if (typeof window === 'undefined') return;
  void window.t8pc?.locale?.set(locale).catch(() => {
    // Browser builds and older desktop shells do not expose the locale bridge.
  });
}

export const useUiLocaleStore = create<UiLocaleState>((set) => ({
  locale: resolveInitialUiLocale(),
  setLocale(value) {
    const locale = normalizeUiLocale(value) || 'zh-CN';
    persistUiLocale(locale);
    void i18n.changeLanguage(locale);
    syncElectronLocale(locale);
    set({ locale });
  },
}));

if (typeof window !== 'undefined' && window.t8pc?.locale?.get) {
  void window.t8pc.locale.get().then((result) => {
    const locale = normalizeUiLocale(result?.locale);
    if (!locale || locale === useUiLocaleStore.getState().locale) return;
    persistUiLocale(locale);
    void i18n.changeLanguage(locale);
    useUiLocaleStore.setState({ locale });
  }).catch(() => {
    // The renderer's stored/OS locale remains the safe fallback.
  });
}
