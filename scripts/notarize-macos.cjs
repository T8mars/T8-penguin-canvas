'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function configured(value) {
  return Boolean(String(value || '').trim());
}

function notarizationCredentials(env = process.env) {
  if (configured(env.APPLE_API_KEY)
    && configured(env.APPLE_API_KEY_ID)
    && configured(env.APPLE_API_ISSUER)) {
    return {
      appleApiKey: env.APPLE_API_KEY,
      appleApiKeyId: env.APPLE_API_KEY_ID,
      appleApiIssuer: env.APPLE_API_ISSUER,
    };
  }
  if (configured(env.APPLE_ID)
    && configured(env.APPLE_APP_SPECIFIC_PASSWORD)
    && configured(env.APPLE_TEAM_ID)) {
    return {
      appleId: env.APPLE_ID,
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: env.APPLE_TEAM_ID,
    };
  }
  return null;
}

function adHocSign(appPath) {
  const entitlements = path.resolve(__dirname, '..', 'electron', 'build-resources', 'entitlements.mac.plist');
  const result = spawnSync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign', '-',
    '--entitlements', entitlements,
    '--options', 'runtime',
    '--timestamp=none',
    appPath,
  ], { encoding: 'utf8', stdio: 'pipe' });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`[notarize-macos] ad-hoc codesign failed${detail ? `: ${detail}` : ''}`);
  }
  console.log(`[notarize-macos] ad-hoc integrity signature applied to ${appPath}`);
}

module.exports = async function notarizeMac(context) {
  if (process.platform !== 'darwin') return;
  const requireSigning = process.env.T8_MAC_REQUIRE_SIGNING === '1';
  const credentials = notarizationCredentials();
  const appName = context?.packager?.appInfo?.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!credentials) {
    if (requireSigning) {
      throw new Error('[notarize-macos] signed release requires complete Apple notarization credentials');
    }
    adHocSign(appPath);
    console.warn('[notarize-macos] Apple credentials are not configured; produced an explicit ad-hoc signed technical preview');
    return;
  }

  const { notarize } = require('@electron/notarize');
  console.log(`[notarize-macos] submitting ${appPath}`);
  await notarize({ appPath, ...credentials });
  console.log('[notarize-macos] notarization accepted and stapled by electron-builder');
};

module.exports.notarizationCredentials = notarizationCredentials;
module.exports.adHocSign = adHocSign;
