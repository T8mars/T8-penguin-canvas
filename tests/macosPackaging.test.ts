import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

test('package metadata declares an arm64 macOS DMG/ZIP update channel without changing Windows NSIS', () => {
  const pkg = JSON.parse(read('../package.json'));

  assert.deepEqual(pkg.build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(pkg.build.win.artifactName, '${productName}-Setup-${version}.${ext}');
  assert.deepEqual(pkg.build.mac.target, [
    { target: 'dmg', arch: ['arm64'] },
    { target: 'zip', arch: ['arm64'] },
  ]);
  assert.equal(pkg.build.mac.artifactName, '${productName}-${version}-mac-${arch}.${ext}');
  assert.equal(pkg.build.mac.category, 'public.app-category.graphics-design');
  assert.equal(pkg.build.mac.minimumSystemVersion, '12.0');
  assert.ok(pkg.build.mac.entitlements.endsWith('entitlements.mac.plist'));
  assert.ok(pkg.build.mac.entitlementsInherit.endsWith('entitlements.mac.plist'));
  assert.equal(pkg.build.afterSign, 'scripts/notarize-macos.cjs');
  assert.equal(pkg.build.mac.afterSign, undefined);

  const commonResources = pkg.build.extraResources.map((item: any) => item.to);
  assert.ok(!commonResources.includes('tools/runtime-archives'));
  assert.ok(!commonResources.includes('tools/ffmpeg'));
  const windowsResources = pkg.build.win.extraResources.map((item: any) => `${item.from}->${item.to}`);
  const macResources = pkg.build.mac.extraResources.map((item: any) => `${item.from}->${item.to}`);
  assert.ok(windowsResources.includes('tools/runtime-archives->tools/runtime-archives'));
  assert.ok(windowsResources.includes('tools/ffmpeg-runtime->tools/ffmpeg'));
  assert.ok(macResources.includes('build/mac-runtime->tools/ffmpeg'));

  assert.match(pkg.scripts['dist:mac'], /dist-macos\.cjs/);
  assert.match(pkg.scripts['release:mac'], /release-macos-github\.cjs/);
  assert.match(pkg.scripts['release:mac:verify'], /verify-macos-release\.cjs/);
  assert.equal(pkg.dependencies['@ffprobe-installer/ffprobe'], '^2.1.2');
});

test('macOS release helpers prepare native media tools and fail closed on platform, source and release drift', () => {
  const prepare = read('../scripts/prepare-macos-runtime.cjs');
  const dist = read('../scripts/dist-macos.cjs');
  const publish = read('../scripts/release-macos-github.cjs');
  const verify = read('../scripts/verify-macos-release.cjs');
  const postBuild = read('../electron/_post_build_macos.cjs');

  assert.match(prepare, /process\.platform !== 'darwin'/);
  assert.match(prepare, /require\('ffmpeg-static'\)/);
  assert.match(prepare, /require\('@ffprobe-installer\/ffprobe'\)/);
  assert.match(prepare, /lipo/);
  assert.match(prepare, /runtime-manifest\.json/);

  const notarize = read('../scripts/notarize-macos.cjs');
  assert.match(notarize, /function adHocSign/);
  assert.match(notarize, /'--sign', '-'/);
  assert.match(notarize, /'--timestamp=none'/);

  assert.match(dist, /T8_MAC_RELEASE_APPROVAL/);
  assert.match(dist, /T8_RELEASE_TARGET/);
  assert.match(dist, /--mac/);
  assert.match(dist, /--arm64/);
  assert.match(dist, /_post_build_macos\.cjs/);
  assert.match(dist, /T8_REQUIRE_LOCAL_PRIVATE/);
  assert.match(dist, /OPTIONAL_SIGNING_ENV/);
  assert.match(dist, /delete env\[key\]/);

  assert.match(postBuild, /mac-arm64/);
  assert.match(postBuild, /latest-mac\.yml/);
  assert.match(postBuild, /hdiutil/);
  assert.match(postBuild, /better_sqlite3\.node/);
  assert.match(postBuild, /packaged ffprobe JSON probe verified/);
  assert.match(postBuild, /T8_MAC_REQUIRE_SIGNING/);

  assert.match(publish, /existing release target/);
  assert.match(publish, /refusing to overwrite a different existing macOS asset/);
  assert.match(publish, /gh release upload/);
  assert.match(publish, /latest-mac\.yml/);
  assert.match(verify, /downloaded macOS release asset/);
  assert.match(verify, /sha256/);
  assert.match(verify, /latest-mac\.yml/);
});

test('macOS source binding peels annotated remote tags to their commit', () => {
  const { remoteRefCommit } = require('../scripts/dist-macos.cjs');
  const ref = 'refs/tags/v3.0.2';
  const tagObject = 'e2aa674e844e1edc25cdf10dcdab3845b6f424c9';
  const commit = '24a4481b377aca3793c87dbb224b3c9aeccbe5c8';
  const output = `${tagObject}\t${ref}\n${commit}\t${ref}^{}`;

  assert.equal(remoteRefCommit(output, ref), commit);
  assert.equal(remoteRefCommit(`${commit}\t${ref}`, ref), commit);
  assert.equal(remoteRefCommit('', ref), '');
});

test('GitHub Actions builds current and future Mac releases on a real Apple Silicon runner', () => {
  const workflow = read('../.github/workflows/release-macos.yml');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release_tag:/);
  assert.match(workflow, /source_ref:/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /T8_MAC_LOCAL_PRIVATE_BUNDLE_B64/);
  assert.match(workflow, /T8_MAC_LOCAL_PRIVATE_FRONTEND_BUNDLE_B64/);
  assert.match(workflow, /local-private\/recharge\/frontend\/RechargeModal\.tsx/);
  assert.match(workflow, /npm run dist:mac/);
  assert.match(workflow, /npm run release:mac/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /contents: write/);
});

test('macOS updater language does not tell Mac users to open an NSIS wizard', () => {
  const main = read('../electron/main.cjs');
  const catalog = JSON.parse(read('../electron/i18n-catalog.json'));
  assert.match(main, /process\.platform === 'darwin'/);
  assert.match(main, /\? 'updater\.installingMac'/);
  assert.match(main, /: 'updater\.installingWindows'/);
  assert.equal(catalog['zh-CN'].updater.installingMac, '正在安装更新，应用将自动重启');
  assert.equal(catalog['zh-CN'].updater.installingWindows, '正在打开安装向导，请按提示完成安装');
  assert.notEqual(catalog['en-US'].updater.installingMac, catalog['en-US'].updater.installingWindows);
});

test('macOS release process and live release evidence are documented after publication', () => {
  const processDoc = read('../docs/macos-release.md');
  const features = JSON.parse(read('../features.json'));

  assert.match(processDoc, /v3\.0\.0-mac\.1/);
  assert.match(processDoc, /v3\.0\.0-mac\.5/);
  assert.match(processDoc, /从下个版本开始的 Windows \+ Mac 同版流程/);
  assert.match(processDoc, /--clobber/);
  assert.equal(features.macDesktopRelease.platform, 'macOS 12+ / Apple Silicon arm64');
  assert.equal(features.macDesktopRelease.currentReleasePlan.releaseTag, 'v3.0.3');
  assert.equal(features.macDesktopRelease.currentReleasePlan.sourceRef, 'v3.0.3');
  assert.equal(features.macDesktopRelease.status, 'released-v3.0.3-mac-arm64-preview-live-verified');
  assert.equal(features.macDesktopRelease.releaseIncluded, true);
  assert.equal(features.macDesktopRelease.releaseEvidence.sourceCommit, '64d9a708dd92d38a77b710e06855ddcf6b4e652c');
  assert.equal(features.macDesktopRelease.releaseEvidence.workflowConclusion, 'success');
  assert.equal(features.macDesktopRelease.releaseEvidence.releaseTargetUnchanged, true);
  assert.equal(features.macDesktopRelease.releaseEvidence.macArtifacts.length, 3);
  assert.equal(features.macDesktopRelease.releaseEvidence.macArtifacts[0].sha256, '18ab11a8dfbf4f23a6a66f8167160a6bae1f00c758ddcd9ca796e181b890dfa5');
  assert.equal(features.macDesktopRelease.processDoc, 'docs/macos-release.md');
});
