import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const electronI18n = require('../electron/i18n.cjs') as {
  catalog: Record<string, unknown>;
  normalizeElectronLocale: (value: unknown) => 'zh-CN' | 'en-US' | null;
  resolveElectronLocale: (user: unknown, os: unknown) => 'zh-CN' | 'en-US';
  readPersistedElectronLocale: (root: string) => 'zh-CN' | 'en-US' | null;
  initializeElectronLocale: (root: string, os: unknown) => 'zh-CN' | 'en-US';
  getElectronLocale: () => 'zh-CN' | 'en-US';
  electronT: (key: string, params?: Record<string, unknown>, locale?: string) => string;
};

function flatten(value: unknown, prefix = '', out = new Map<string, string>()) {
  if (typeof value === 'string') out.set(prefix, value);
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, out));
  }
  return out;
}

test('Electron locale uses persisted UI preference before OS locale', () => {
  const root = mkdtempSync(join(tmpdir(), 't8-electron-i18n-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'settings.json'), JSON.stringify({
      preferences: { uiLocale: 'en-US', language: 'zh-CN' },
    }));
    assert.equal(electronI18n.readPersistedElectronLocale(root), 'en-US');
    assert.equal(electronI18n.initializeElectronLocale(root, 'zh-CN'), 'en-US');
    assert.equal(electronI18n.getElectronLocale(), 'en-US');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Electron locale falls back to supported OS language and then Chinese', () => {
  assert.equal(electronI18n.normalizeElectronLocale('en-GB'), 'en-US');
  assert.equal(electronI18n.resolveElectronLocale(null, 'en-GB'), 'en-US');
  assert.equal(electronI18n.resolveElectronLocale(null, 'fr-FR'), 'zh-CN');
});

test('Electron catalogs have identical keys and placeholder contracts', () => {
  const zh = flatten(electronI18n.catalog['zh-CN']);
  const en = flatten(electronI18n.catalog['en-US']);
  assert.deepEqual([...zh.keys()].sort(), [...en.keys()].sort());
  const placeholders = (value: string) => [...value.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]).sort();
  for (const key of zh.keys()) {
    assert.deepEqual(placeholders(zh.get(key)!), placeholders(en.get(key)!), key);
  }
  assert.equal(
    electronI18n.electronT('updater.availableVersion', { version: '3.1.0' }, 'en-US'),
    'Version v3.1.0 is available',
  );
});

test('Electron bridge exposes locale IPC and updater status keeps stable message keys', () => {
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /initializeElectronLocale\(getUserDataDir\(\), app\.getLocale\(\)\)/);
  assert.match(main, /ipcMain\.handle\('t8pc:locale:get'/);
  assert.match(main, /ipcMain\.handle\('t8pc:locale:set'/);
  assert.match(main, /messageKey: 'updater\.checking'/);
  assert.match(preload, /'t8pc:locale:get'/);
  assert.match(preload, /'t8pc:locale:set'/);
});

test('Electron UI locale never rewrites generation/content language', () => {
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const localeStore = readFileSync(new URL('../src/stores/locale.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /preferences\.language\s*=/);
  assert.doesNotMatch(localeStore, /language\s*:/);
});
