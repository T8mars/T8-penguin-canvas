export type UiFontPresetId = 'readable' | 'system' | 'theme' | 'custom';

export const DEFAULT_UI_FONT_PRESET: UiFontPresetId = 'readable';

export const READABLE_UI_FONT_STACK =
  "'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif";

export const SYSTEM_UI_FONT_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";

export const UI_FONT_PRESETS = [
  {
    id: 'readable',
    labelKey: 'fonts.presets.readable.label',
    descriptionKey: 'fonts.presets.readable.description',
    stack: READABLE_UI_FONT_STACK,
  },
  {
    id: 'system',
    labelKey: 'fonts.presets.system.label',
    descriptionKey: 'fonts.presets.system.description',
    stack: SYSTEM_UI_FONT_STACK,
  },
  {
    id: 'theme',
    labelKey: 'fonts.presets.theme.label',
    descriptionKey: 'fonts.presets.theme.description',
    stack: '',
  },
  {
    id: 'custom',
    labelKey: 'fonts.presets.custom.label',
    descriptionKey: 'fonts.presets.custom.description',
    stack: '',
  },
] satisfies Array<{ id: UiFontPresetId; labelKey: string; descriptionKey: string; stack: string }>;

export function normalizeUiFontPresetId(value: unknown): UiFontPresetId {
  if (value === 'readable' || value === 'system' || value === 'theme' || value === 'custom') {
    return value;
  }
  return DEFAULT_UI_FONT_PRESET;
}

export function sanitizeCustomUiFont(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[;{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export function resolveUiFontStack(presetId: unknown, customFont: unknown): string {
  const preset = normalizeUiFontPresetId(presetId);
  if (preset === 'theme') return '';
  if (preset === 'custom') {
    return sanitizeCustomUiFont(customFont) || READABLE_UI_FONT_STACK;
  }
  if (preset === 'system') return SYSTEM_UI_FONT_STACK;
  return READABLE_UI_FONT_STACK;
}

export function applyUiFontPreference(root: HTMLElement, presetId: unknown, customFont: unknown): void {
  const preset = normalizeUiFontPresetId(presetId);
  const stack = resolveUiFontStack(preset, customFont);
  root.setAttribute('data-ui-font', preset);

  if (!stack) {
    root.style.removeProperty('--t8-user-font-family');
    return;
  }

  root.style.setProperty('--t8-user-font-family', stack);
  root.style.setProperty('--t8-font-family', 'var(--t8-user-font-family)');
  root.style.setProperty('--t8-font-display', 'var(--t8-user-font-family)');
  root.style.setProperty('--px-font-display', 'var(--t8-user-font-family)');
  root.style.setProperty('--px-font-pixel', 'var(--t8-user-font-family)');
}
