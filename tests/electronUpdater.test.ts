import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('package config enables GitHub release updates and local release scripts', () => {
  const pkg = JSON.parse(read('../package.json'));
  const publish = pkg.build.publish?.[0];

  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version.split('.').every((part: string) => Number(part) >= 0 && Number(part) <= 9), true);
  assert.ok(pkg.dependencies['electron-updater']);
  assert.ok(pkg.dependencies['electron-log']);
  assert.equal(publish.provider, 'github');
  assert.equal(publish.owner, 'T8mars');
  assert.equal(publish.repo, 'T8-penguin-canvas');
  assert.match(pkg.scripts['dist:release'], /scripts\/dist-release\.cjs|scripts\\dist-release\.cjs/);
  assert.match(pkg.scripts['release:verify'], /verify-github-release\.cjs/);
});

test('electron main process owns updater checks, downloads, and install IPC', () => {
  const pkg = JSON.parse(read('../package.json'));
  const main = read('../electron/main.cjs');
  const catalog = JSON.parse(read('../electron/i18n-catalog.json'));
  const installerNsh = read('../electron/build-resources/installer.nsh');
  const nsis = pkg.build.nsis;

  assert.match(main, /const APP_VERSION = require\('\.\.\/package\.json'\)\.version/);
  assert.match(main, /process\.env\.T8PC_APP_VERSION = APP_VERSION/);
  assert.equal(nsis.createDesktopShortcut, 'always');
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.match(main, /require\('electron-updater'\)/);
  assert.match(main, /autoUpdater\.autoDownload\s*=\s*false/);
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/);
  assert.match(main, /autoUpdater\.on\('download-progress'/);
  assert.match(main, /ipcMain\.handle\('t8pc:updater:status'/);
  assert.match(main, /ipcMain\.handle\('t8pc:updater:check'/);
  assert.match(main, /ipcMain\.handle\('t8pc:updater:download'/);
  assert.match(main, /ipcMain\.handle\('t8pc:updater:install'/);
  assert.match(main, /const isMac = process\.platform === 'darwin'/);
  assert.match(main, /quitAndInstall\(isMac,\s*true\)/);
  assert.match(main, /'updater\.installingMac'/);
  assert.match(main, /'updater\.installingWindows'/);
  assert.equal(catalog['zh-CN'].updater.installingMac, '正在安装更新，应用将自动重启');
  assert.equal(catalog['zh-CN'].updater.installingWindows, '正在打开安装向导，请按提示完成安装');
  assert.match(installerNsh, /!macro customInit/);
  assert.match(installerNsh, /SetSilent\s+normal/);
  assert.match(installerNsh, /!macro customInstall/);
  assert.match(installerNsh, /CreateShortCut "\$newStartMenuLink"/);
  assert.match(installerNsh, /CreateShortCut "\$DESKTOP\\\$\{SHORTCUT_NAME\}\.lnk"/);
});

test('preload and frontend expose a narrow updater surface', () => {
  const preload = read('../electron/preload.cjs');
  const types = read('../src/vite-env.d.ts');
  const app = read('../src/App.tsx');
  const button = read('../src/components/AppUpdaterButton.tsx');

  assert.match(preload, /updater:\s*\{/);
  assert.match(preload, /ipcRenderer\.invoke\('t8pc:updater:check'\)/);
  assert.match(preload, /ipcRenderer\.on\('t8pc:updater-status'/);
  assert.match(types, /interface T8UpdaterStatus/);
  assert.match(types, /onStatus:\s*\(callback:/);
  assert.match(app, /<AppUpdaterButton isPixel=\{isPixel\} isDark=\{isDark\} \/>/);
  assert.match(button, /status\.status === 'available'/);
  assert.match(button, /status\.status === 'downloaded'/);
  assert.match(button, /desktopShellDetected/);
  assert.match(button, /isElectronUserAgent/);
  assert.match(button, /'updater\.bridgeMissing'/);
  assert.match(button, /if \(!desktopShellDetected\) return null/);
  assert.doesNotMatch(button, /if \(!hasUpdater\) return null/);
  assert.match(button, /t\('updater\.labels\.openInstaller'\)/);
});

test('release scripts verify installer, blockmap, latest.yml, and GitHub assets', () => {
  const postBuild = read('../electron/_post_build.cjs');
  const distRelease = read('../scripts/dist-release.cjs');
  const release = read('../scripts/release-github.cjs');
  const verify = read('../scripts/verify-github-release.cjs');
  const latestYml = read('../scripts/latest-yml.cjs');

  assert.match(distRelease, /T8_REQUIRE_UPDATE_ARTIFACTS/);
  assert.match(distRelease, /release-github\.cjs/);
  assert.match(postBuild, /T8_REQUIRE_UPDATE_ARTIFACTS/);
  assert.match(postBuild, /latest\.yml/);
  assert.match(postBuild, /\.blockmap/);
  assert.match(release, /const createArgs = \[/);
  assert.match(release, /'create'/);
  assert.match(release, /function uploadMissingAssets/);
  assert.match(release, /uploads\.github\.com/);
  assert.match(release, /'--input'/);
  assert.match(release, /assertLatestYamlArtifact/);
  assert.match(latestYml, /\$\{label\} version mismatch/);
  assert.match(verify, /'release',\s*[\r\n]\s*'download'/);
  assert.match(verify, /missing release asset/);
  assert.match(verify, /T8_RELEASE_TARGET must be the exact 40-character source commit SHA/);
  assert.match(verify, /automatic-update tag must be \$\{expectedTag\}/);
  assert.match(verify, /prepublish verification requires a stable draft release/);
  assert.match(verify, /draft \$\{tag\} targets/);
  assert.match(verify, /must be a published non-prerelease automatic-update release/);
  assert.match(verify, /remote tag \$\{tag\} targets/);
  assert.match(verify, /release asset SHA-256 mismatch/);
  assert.match(verify, /release asset advertised SHA-256 mismatch/);
  assert.match(verify, /unexpected release asset/);
  assert.match(verify, /allowedMacAssetNames/);
  assert.match(verify, /prepublish \? \[\] : allowedMacAssetNames/);
  assert.match(verify, /isImmutable/);
  assert.match(verify, /publisher-level no-overwrite only/);
  assert.match(verify, /metadata-only/);
  assert.match(verify, /recovery-manifest/);
  assert.match(verify, /assertSealedReleaseRecovery/);
  assert.match(verify, /sealed recovery manifest \+ GitHub digest\/size metadata/);
  assert.match(verify, /sealed-recovery-full-download/);
  assert.doesNotMatch(verify, /requires --metadata-only/);
  assert.match(verify, /if \(!metadataOnly\)/);
  assert.match(verify, /assertLatestYamlArtifact/);
  assert.match(latestYml, /\$\{label\} installer sha512 mismatch/);
  assert.match(verify, /tagName,isLatest,isDraft,isPrerelease/);
  assert.match(verify, /is not marked as GitHub Latest/);
});
