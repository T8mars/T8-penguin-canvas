import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeUiLocale, resolveUiLocalePreference } from '../src/i18n';
import { pseudoLocalize } from '../src/i18n/pseudo';
import { ENGLISH_NODE_CATALOG, getNodeSearchText, localizeNodeMeta } from '../src/i18n/nodeCatalog';
import { enUS, zhCN } from '../src/i18n/resources';

function flatten(value: unknown, prefix = '', out = new Map<string, string>()) {
  if (typeof value === 'string') out.set(prefix, value);
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, out));
  }
  return out;
}

test('explicit UI locale wins over OS locale and unsupported locales fall back safely', () => {
  assert.equal(resolveUiLocalePreference('en-US', 'zh-CN'), 'en-US');
  assert.equal(resolveUiLocalePreference(null, 'en-GB'), 'en-US');
  assert.equal(resolveUiLocalePreference(null, 'fr-FR'), 'zh-CN');
  assert.equal(normalizeUiLocale('zh-Hans'), 'zh-CN');
});

test('zh-CN and en-US catalogs have matching keys and placeholders', () => {
  const zh = flatten(zhCN);
  const en = flatten(enUS);
  assert.deepEqual(Array.from(zh.keys()).sort(), Array.from(en.keys()).sort());
  for (const key of zh.keys()) {
    const params = (value: string) => Array.from(value.matchAll(/{{\s*([\w.-]+)\s*}}/g), (match) => match[1]).sort();
    assert.deepEqual(params(zh.get(key)!), params(en.get(key)!), key);
  }
});

test('pseudo locale expands text for clipping tests', () => {
  const source = 'Canvas performance';
  const pseudo = pseudoLocalize(source);
  assert.ok(pseudo.length > source.length * 1.3);
  assert.match(pseudo, /^［/);
});

test('UI locale remains separate from generation/content language in settings', () => {
  const typeSource = readFileSync(new URL('../src/types/canvas.ts', import.meta.url), 'utf8');
  const backendSettings = readFileSync(new URL('../backend/src/routes/settings.js', import.meta.url), 'utf8');
  assert.match(typeSource, /uiLocale\?: 'zh-CN' \| 'en-US'/);
  assert.match(typeSource, /language\?: string/);
  assert.match(backendSettings, /uiLocale: 'zh-CN'/);
  assert.match(backendSettings, /language: 'zh-CN'/);
  assert.match(backendSettings, /normalizeUiPreferences/);
});

test('build gate runs i18n coverage after feature synchronization', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts.prebuild, /feature-sync:check && npm run i18n:check/);
});

test('runtime English audit is opt-in and excludes explicitly marked user or provider content', () => {
  const source = readFileSync(new URL('../src/i18n/visibleAudit.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /params\.get\('i18nAudit'\) === '1'/);
  assert.match(source, /\[data-i18n-skip\]/);
  assert.match(source, /\[data-user-content\]/);
  assert.match(source, /\[data-provider-content\]/);
  assert.match(source, /\[data-runtime-diagnostic\]/);
  assert.match(source, /t8-i18n-visible-audit-result/);
  assert.match(source, /dataset\.t8I18nAuditFindings/);
  assert.match(main, /installVisibleI18nAudit\(\)/);
});

test('node catalog localizes display copy without mutating stable node identity and searches both languages', () => {
  const meta = {
    type: 'output' as const,
    label: '输出素材',
    description: '结果预览',
    category: 'input' as const,
    icon: 'Gem',
    color: 'emerald',
  };
  const localized = localizeNodeMeta(meta, 'en-US');
  assert.equal(localized.type, 'output');
  assert.equal(localized.label, ENGLISH_NODE_CATALOG.output.label);
  const search = getNodeSearchText(meta, 'en-US');
  assert.match(search, /输出素材/);
  assert.match(search, /output material/);
});
