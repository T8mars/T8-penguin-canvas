'use strict';

const path = require('node:path');
const asar = require('@electron/asar');

const REQUIRED_ELECTRON_ASAR_ENTRIES = Object.freeze([
  'electron/main.cjs',
  'electron/i18n.cjs',
  'electron/i18n-catalog.json',
  'electron/preload.cjs',
  'electron/loader.cjs',
  'electron/systemFetchBridge.cjs',
  'package.json',
]);

function normalizeAsarEntry(entry) {
  return String(entry || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function missingRequiredElectronEntries(entries) {
  const packaged = new Set(Array.from(entries || [], normalizeAsarEntry));
  return REQUIRED_ELECTRON_ASAR_ENTRIES.filter((entry) => !packaged.has(entry));
}

function assertElectronAppAsar(appAsarPath) {
  let entries;
  try {
    entries = asar.listPackage(appAsarPath);
  } catch (error) {
    throw new Error(`cannot read Electron app.asar ${path.resolve(appAsarPath)}: ${error?.message || error}`);
  }
  const missing = missingRequiredElectronEntries(entries);
  if (missing.length > 0) {
    throw new Error(`Electron app.asar is missing required startup files: ${missing.join(', ')}`);
  }
  return {
    appAsarPath: path.resolve(appAsarPath),
    requiredEntries: [...REQUIRED_ELECTRON_ASAR_ENTRIES],
    entryCount: entries.length,
  };
}

module.exports = {
  REQUIRED_ELECTRON_ASAR_ENTRIES,
  assertElectronAppAsar,
  missingRequiredElectronEntries,
  normalizeAsarEntry,
};
