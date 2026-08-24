import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

test('encrypted Electron loader only falls back to app require for bare packages', () => {
  const loader = read('../electron/loader.cjs');
  assert.match(loader, /function canFallbackToLoaderRequire/);
  assert.match(loader, /!text\.startsWith\('\.'\)/);
  assert.match(loader, /!path\.isAbsolute\(text\)/);
  assert.match(loader, /if \(!canFallbackToLoaderRequire\(id\)\) throw e;/);
  assert.match(loader, /if \(!canFallbackToLoaderRequire\(request\)\) throw e;/);
  assert.match(loader, /return require\(id\)/);
  assert.match(loader, /return require\.resolve\(request, options\)/);
});

test('clean installs include Three.js typings for Panorama3D type-check', () => {
  const packageJson = JSON.parse(read('../package.json'));
  const lock = read('../package-lock.json');
  const panorama = read('../src/components/nodes/Panorama3DNode.tsx');

  assert.equal(packageJson.devDependencies['@types/three'], '^0.184.1');
  assert.match(lock, /"node_modules\/@types\/three"/);
  assert.doesNotMatch(lock, /registry\.npmmirror\.com/);
  assert.match(panorama, /type ThreeModule = typeof import\('three'\)/);
});

test('dir packaging verification ignores stale release metadata unless update artifacts are required', () => {
  const postBuild = read('../electron/_post_build.cjs');
  const pkg = read('../package.json');
  assert.match(postBuild, /const strict = process\.env\.T8_REQUIRE_UPDATE_ARTIFACTS === '1'/);
  assert.match(postBuild, /const directoryBuild = process\.env\.T8_DIRECTORY_BUILD === '1'/);
  assert.match(pkg, /cross-env T8_DIRECTORY_BUILD=1 node electron\/_post_build\.cjs/);
  assert.match(pkg, /"rebuild:electron": "electron-rebuild -f -w better-sqlite3 --arch x64"/);
  assert.match(pkg, /electron-builder --win --x64 --dir --config\.npmRebuild=false/);
  assert.match(pkg, /electron-builder --win --x64 --config\.npmRebuild=false/);
  assert.match(postBuild, /const hasInstaller = fs\.existsSync\(installer\)/);
  assert.match(postBuild, /const hasBlockmap = fs\.existsSync\(blockmap\)/);
  assert.match(postBuild, /!strict && \(directoryBuild \|\| \(!hasInstaller && !hasBlockmap\)\)/);
  assert.match(postBuild, /skipping installer\/latest\.yml checks for dir build/);
});

test('Electron bytecode compilation is pinned to the project-local locked runtime', () => {
  const packageJson = JSON.parse(read('../package.json'));
  const packageLock = JSON.parse(read('../package-lock.json'));
  const encrypt = read('../electron/encrypt.cjs');

  assert.equal(
    packageJson.scripts.encrypt,
    'cross-env ELECTRON_RUN_AS_NODE=1 node node_modules/electron/cli.js electron/encrypt.cjs',
  );
  assert.equal(
    packageLock.packages['node_modules/electron'].version,
    packageJson.devDependencies.electron.replace(/^\^/, ''),
  );
  assert.match(encrypt, /function assertElectronCompilerRuntime\(\)/);
  assert.match(encrypt, /package-lock=\$\{expected\}, compiler=\$\{actual\}/);
  assert.match(encrypt, /project-local Electron \$\{expected\} is incomplete/);
  assert.match(encrypt, /assertElectronCompilerRuntime\(\);/);
});

test('Electron does not open the renderer before the packaged backend is ready', () => {
  const main = read('../electron/main.cjs');
  assert.match(main, /const backendReady = await waitForBackend\(backendPort, backendInstanceId, 30\)/);
  assert.match(main, /if \(!backendReady\) throw new Error\(`后端未能在端口 \$\{backendPort\} 就绪`\)/);
  assert.match(main, /const start = await backendModule\?\.serverStartPromise/);
  assert.match(main, /start\.state !== 'listening'/);
  assert.match(main, /status\?\.service === 't8-penguin-canvas-backend'/);
  assert.match(main, /status\?\.instanceId === expectedInstanceId/);
  assert.match(main, /function shutdownBackendForElectron\(reason = 'ELECTRON_QUIT'\)/);
  assert.match(main, /const ELECTRON_BACKEND_SHUTDOWN_DEADLINE_MS = 15_000/);
  assert.match(main, /settleWithinElectronDeadline\(\s+shutdownWork,\s+ELECTRON_BACKEND_SHUTDOWN_DEADLINE_MS,/);
  assert.match(main, /Electron shutdown deadline reached/);
  assert.match(main, /const outcome = await backendModule\?\.gracefulShutdown\?\.\(reason\)/);
  assert.match(main, /bounded shutdown left tracked work deferred; waiting within the Electron cutoff/);
  assert.match(main, /await backendModule\?\.waitForRuntimeStorageCloseLifecycle\?\.\(\)/);
  assert.match(main, /await shutdownBackendForElectron\('STARTUP_FAILURE'\)/);
  assert.match(main, /app\.on\('before-quit', \(event\) => \{/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /shutdownBackendForElectron\('ELECTRON_QUIT'\)/);
  assert.match(main, /electronQuitReady = true;\s+app\.quit\(\);/);
  assert.match(main, /if \(electronQuitRequested \|\| pendingMainWindow\.isDestroyed\(\)\) return;/);
  assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{\s+if \(!ELECTRON_SINGLE_INSTANCE_OWNER \|\| electronQuitRequested\) return;\s+createLogWindow\(\);/);
  assert.ok(main.indexOf('if (!backendReady)') < main.indexOf('createMainWindow();', main.indexOf('app.whenReady()')));
});

test('Electron shutdown deadline settles a permanently pending owner without losing fast failures', async () => {
  const main = read('../electron/main.cjs').replace(/\r\n/g, '\n');
  const start = main.indexOf('function settleWithinElectronDeadline(');
  const end = main.indexOf('\n}\n\nfunction shutdownBackendForElectron', start) + 2;
  assert.ok(start >= 0 && end > start);
  const settleWithinElectronDeadline = Function(
    `${main.slice(start, end)}; return settleWithinElectronDeadline;`,
  )() as (work: Promise<unknown>, timeoutMs: number, onTimeout: () => unknown) => Promise<unknown>;

  assert.equal(await settleWithinElectronDeadline(Promise.resolve('done'), 100, () => 'timeout'), 'done');
  let timeoutCalls = 0;
  const timeoutResult = await settleWithinElectronDeadline(new Promise(() => {}), 15, () => {
    timeoutCalls += 1;
    return { timedOut: true };
  });
  assert.deepEqual(timeoutResult, { timedOut: true });
  assert.equal(timeoutCalls, 1);
  await assert.rejects(
    settleWithinElectronDeadline(Promise.reject(new Error('shutdown failed')), 100, () => null),
    /shutdown failed/,
  );
});

test('Electron injects a persistent host authority only into exact main-window management requests', () => {
  const main = read('../electron/main.cjs');
  const preload = read('../electron/preload.cjs');
  const backendServer = read('../backend/src/server.js');
  const backendConfig = read('../backend/src/config.js');
  const vite = read('../vite.config.ts');
  const ignore = read('../.gitignore');

  assert.match(main, /electronManagementAuthorityPath\(\)[\s\S]*app\.getPath\('userData'\)[\s\S]*collaboration-management-authority\.json/);
  assert.match(main, /safeStorage\.encryptString\(token\)\.toString\('base64'\)/);
  assert.match(main, /safeStorage\.decryptString\(Buffer\.from\(record\.tokenEnc, 'base64'\)\)/);
  assert.match(main, /details\.webContentsId !== webContentsId/);
  assert.match(main, /isExactLocalCollaborationManagementUrl\(details\.url\)/);
  assert.match(main, /requestHeaders\[COLLABORATION_MANAGEMENT_HEADER\] = collaborationManagementToken/);
  const startBackend = main.slice(
    main.indexOf('async function startBackend()'),
    main.indexOf('// ---------- 创建主窗口 ----------'),
  );
  const injectIndex = startBackend.indexOf('process.env.T8_COLLAB_MANAGEMENT_TOKEN = collaborationManagementToken;');
  const requireIndex = startBackend.indexOf('backendModule = require(entry);', injectIndex);
  const clearIndex = startBackend.indexOf('delete process.env.T8_COLLAB_MANAGEMENT_TOKEN;', requireIndex);
  assert.ok(injectIndex >= 0 && injectIndex < requireIndex && requireIndex < clearIndex);
  assert.match(startBackend, /try \{\s+backendModule = require\(entry\);\s+\} finally \{\s+delete process\.env\.T8_COLLAB_MANAGEMENT_TOKEN;/);
  assert.doesNotMatch(startBackend.slice(injectIndex, clearIndex), /\b(?:spawn|execFile|fork)\s*\(/);
  assert.match(backendServer, /^const config = require\('\.\/config'\);/m);
  assert.match(backendConfig, /COLLAB_MANAGEMENT_TOKEN: resolveManagementAuthorityToken\(\)/);
  assert.match(backendConfig, /const injectedRaw = process\.env\.T8_COLLAB_MANAGEMENT_TOKEN;\s+if \(injectedRaw != null\) \{\s+delete process\.env\.T8_COLLAB_MANAGEMENT_TOKEN;/);
  assert.ok(main.indexOf('installMainWindowManagementAuthority(mainWindow);')
    < main.indexOf('mainWindow.loadURL(url);'));
  assert.doesNotMatch(preload, /collaboration-management-token|T8_COLLAB_MANAGEMENT_TOKEN|managementAuthority/i);

  assert.match(vite, /command === 'serve' \? ensureManagementAuthority\(\) : ''/);
  assert.match(vite, /'\/api\/collaboration': collaborationManagementProxy\(managementToken, backendTarget\)/);
  assert.match(vite, /proxyRequest\.setHeader\(MANAGEMENT_AUTHORITY_HEADER, token\)/);
  assert.match(ignore, /^\/\.t8-collaboration-management-authority\.json$/m);
});

test('Electron package verifies the crash-recovery service used on backend startup', () => {
  const postBuild = read('../electron/_post_build.cjs');
  const server = read('../backend/src/server.js');
  assert.match(postBuild, /services['"], ['"]runRecovery\.t8c/);
  assert.match(server, /scheduleStorageDependentMaintenance/);
  assert.match(server, /runs = projectRunsRouter\.getRuntime\(\)/);
  assert.match(server, /runs\.recoveryManager\.recoverPendingRuns\(\)/);
  assert.match(server, /shutdownRunRecoveryLifecycle/);
  assert.match(server, /\[run-recovery\] deferred startup failed/);
});

test('Electron package locks canvas Agent bytecode and shared node schema to source SHA-256', () => {
  const encrypt = read('../electron/encrypt.cjs');
  const postBuild = read('../electron/_post_build.cjs');
  const schema = JSON.parse(read('../backend/src/shared/canvasNodeSchema.json'));
  const requiredSources = [
    'routes/canvasAgentTools.js',
    'services/canvasAgentTools.js',
    'services/canvasAgentPublicView.js',
    'services/runEvidenceDiagnosis.js',
    'shared/canvasNodeSchema.json',
  ];
  const requiredOutputs = [
    'routes/canvasAgentTools.t8c',
    'services/canvasAgentTools.t8c',
    'services/canvasAgentPublicView.t8c',
    'services/runEvidenceDiagnosis.t8c',
    'shared/canvasNodeSchema.json',
  ];

  assert.equal(schema.schema, 't8-canvas-node-schema-v1');
  assert.equal(schema.version, 1);
  assert.equal(schema.types.length, 81);
  for (const source of requiredSources) assert.ok(encrypt.includes(`source: '${source}'`), source);
  for (const output of requiredOutputs) {
    assert.ok(encrypt.includes(`output: '${output}'`), output);
    assert.ok(postBuild.includes(`output: '${output}'`), output);
  }
  assert.match(encrypt, /writeCanvasAgentIntegrityManifest\(canvasAgentBuildHashes\)/);
  assert.match(encrypt, /const sourceSha256 = sha256Buffer\(sourceBytes\)/);
  assert.match(encrypt, /const canvasAgentBuildHashes = new Map\(\)/);
  assert.match(encrypt, /canvasAgentBuildHashes\.set\(rel, hashes\)/);
  assert.match(encrypt, /captured\.sourceSha256 !== sourceSha256 \|\| captured\.outputSha256 !== outputSha256/);
  assert.match(encrypt, /canvas Agent source\/output changed during encryption/);
  assert.match(encrypt, /item\.format === 'json' && sourceSha256 !== outputSha256/);
  assert.match(postBuild, /function checkCanvasAgentIntegrity\(\)/);
  assert.match(postBuild, /canvas Agent encrypted output was built from stale source/);
  assert.match(postBuild, /canvas Agent packaged output SHA-256 mismatch/);
  assert.match(postBuild, /header !== 'T8ENC1\\n'/);
  assert.match(postBuild, /checkCanvasAgentIntegrity\(\)/);
  assert.match(postBuild, /services['"], ['"]runEvidenceDiagnosis\.t8c/);
});

test('Electron package verifies the intelligent asset center and picker media coverage', () => {
  const packageJson = JSON.parse(read('../package.json'));
  const postBuild = read('../electron/_post_build.cjs');
  const encrypt = read('../electron/encrypt.cjs');
  const main = read('../electron/main.cjs');
  const workbench = read('../src/components/ProjectWorkbench.tsx');
  const assetCenter = read('../src/components/assets/AssetCenter.tsx');
  const semanticResource = packageJson.build.extraResources.find(
    (item: { from?: string; to?: string }) => item.to === 'tools/asset-semantic',
  );

  assert.match(postBuild, /routes['"], ['"]projectAssets\.t8c/);
  assert.match(postBuild, /routes['"], ['"]files\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetIndexer\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetPreviewPipeline\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetSemanticModels\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetSemanticWorker\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetSemanticPipeline\.t8c/);
  assert.match(postBuild, /services['"], ['"]modelPreviewRenderer\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetPublicView\.t8c/);
  assert.match(postBuild, /services['"], ['"]projectDatabase\.t8c/);
  assert.match(postBuild, /services['"], ['"]projectDatabaseMigration23\.t8c/);
  assert.match(postBuild, /services['"], ['"]projectDatabaseMigration29\.t8c/);
  assert.match(postBuild, /services['"], ['"]projectDatabaseMigration30\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetBlobStore\.t8c/);
  assert.match(postBuild, /services['"], ['"]assetUploadManager\.t8c/);
  assert.match(postBuild, /collaboration['"], ['"]gateway\.t8c/);
  assert.match(encrypt, /const backendFiles = walk\(BACKEND_SRC\)/);
  assert.match(postBuild, /tools['"], ['"]asset-semantic['"], ['"]semantic_runner\.py/);
  assert.deepEqual(semanticResource, {
    from: 'tools/asset-semantic',
    to: 'tools/asset-semantic',
    filter: ['semantic_runner.py'],
  });
  assert.match(postBuild, /requiredAssetEncoders = \['libx264', 'aac', 'libwebp'\]/);
  assert.match(main, /\['\.mp3', \{ kind: 'audio'/);
  assert.match(main, /\['\.glb', \{ kind: 'model3d'/);
  assert.match(main, /\['image', 'video', 'audio', 'model3d'\]/);
  assert.match(workbench, /<AssetCenter/);
  assert.match(assetCenter, /kinds: \['image', 'video', 'audio', 'model3d'\]/);
  assert.match(assetCenter, /<AssetSemanticSettingsPanel/);
});

test('Electron release publishing requires explicit per-version approval', () => {
  const distRelease = read('../scripts/dist-release.cjs');
  const githubRelease = read('../scripts/release-github.cjs');
  const releaseProvenance = read('../scripts/release-provenance.cjs');
  const releaseWorktree = read('../scripts/release-worktree.cjs');
  const latestYml = read('../scripts/latest-yml.cjs');

  assert.match(distRelease, /const releaseApproval = `release-\$\{pkg\.version\}`/);
  assert.match(distRelease, /function assertReleaseApproval\(\)/);
  assert.match(distRelease, /process\.env\.T8_RELEASE_APPROVAL === releaseApproval/);
  assert.match(distRelease, /refusing to run Electron release without explicit approval/);
  assert.match(distRelease, /only after the user explicitly asks to publish/);
  assert.match(distRelease, /function assertReleaseTarget\(\)/);
  assert.match(distRelease, /function assertReleaseSourceClean\(phase\)/);
  assert.equal(distRelease.match(/assertReleaseSourceClean\(/g)?.length, 4);
  assert.match(distRelease, /release worktree check before build or recovery/);
  assert.match(distRelease, /release worktree check before provenance sealing/);
  assert.match(distRelease, /release worktree check before recovery sealing/);
  assert.match(distRelease, /function assertReleaseTargetUnchanged\(expectedTarget, phase\)/);
  assert.equal(distRelease.match(/assertReleaseTargetUnchanged\(/g)?.length, 3);
  assert.match(distRelease, /release target check before provenance/);
  assert.match(distRelease, /release target check before recovery sealing/);
  assert.match(distRelease, /release target changed during the build/);
  assert.match(distRelease, /T8_RELEASE_TARGET must be the exact 40-character source commit SHA/);
  assert.match(distRelease, /const target = explicitTarget \|\| head/);
  assert.match(distRelease, /\['ls-remote', releaseRemote, 'refs\/heads\/main'\]/);
  assert.match(distRelease, /env\.T8_RELEASE_TARGET = target/);
  assert.match(distRelease, /fixed release target/);
  assert.match(distRelease, /crypto\.randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(distRelease, /T8_RELEASE_BUILD_NONCE/);
  assert.match(distRelease, /readReleaseRecovery/);
  assert.match(distRelease, /writeReleaseRecovery/);
  assert.match(distRelease, /reusing release recovery/);
  assert.match(distRelease, /assertSealedReleaseRecovery/);
  assert.match(distRelease, /assertReleaseProvenanceMatchesSealedRecovery/);
  assert.match(distRelease, /resuming sealed/);
  assert.match(distRelease, /--remote-artifacts-only/);
  assert.match(distRelease, /reconcile existing published release/);
  assert.match(distRelease, /removed stale automatic-update artifacts/);
  assert.match(distRelease, /writeReleaseProvenance/);
  assert.match(distRelease, /sealReleaseRecovery/);
  assert.match(distRelease, /sealed release recovery/);
  assert.match(distRelease, /assertReleaseTarget\(\)/);
  assert.match(distRelease, /github release upload \+ verify/);
  assert.match(distRelease, /run\('rebuild native modules for Electron', command\('npm'\), \['run', 'rebuild:electron'\]\)/);
  assert.match(distRelease, /\['--win', '--x64', '--config\.npmRebuild=false'\]/);

  assert.match(githubRelease, /const releaseApproval = `release-\$\{version\}`/);
  assert.match(githubRelease, /function assertReleaseApproval\(\)/);
  assert.match(githubRelease, /if \(dryRun\) return/);
  assert.match(githubRelease, /process\.env\.T8_RELEASE_APPROVAL === releaseApproval/);
  assert.match(githubRelease, /refusing to publish GitHub Release without explicit approval/);
  assert.match(githubRelease, /formal automatic-update tag must be \$\{expectedTag\}/);
  assert.match(githubRelease, /function assertReleaseGitState\(target\)/);
  assert.match(githubRelease, /assertReleaseWorktreeClean\(\{ root: ROOT \}\)/);
  assert.match(githubRelease, /refs\/heads\/main/);
  assert.match(githubRelease, /refs\/tags\/\$\{tag\}/);
  assert.match(githubRelease, /function existingReleaseMetadata\(options\)/);
  assert.match(githubRelease, /function releaseNotesBody\(releaseTarget\)/);
  assert.match(githubRelease, /'show'/);
  assert.match(githubRelease, /`\$\{releaseTarget\}:\$\{relativeNotesPath\}`/);
  assert.match(githubRelease, /cannot read release notes from fixed source target/);
  assert.match(githubRelease, /this publisher refuses to replace automatic-update assets/);
  assert.match(githubRelease, /t8-electron-release-draft-v1/);
  assert.match(githubRelease, /is not owned by this release build/);
  assert.match(githubRelease, /contains unexpected assets/);
  assert.match(githubRelease, /databaseId,tagName,name,isDraft/);
  assert.match(githubRelease, /creating draft release/);
  assert.match(githubRelease, /'--draft',[\s\S]*'--latest=false'/);
  assert.match(githubRelease, /verifyReleaseWithRetries\('prepublish'/);
  assert.match(githubRelease, /function publishOwnedDraft/);
  assert.match(githubRelease, /assertReleaseGitState\(ownership\.expectedTarget\)/);
  assert.match(githubRelease, /const current = readReleaseMetadata\(\)/);
  assert.match(githubRelease, /databaseId changed immediately before publish/);
  assert.match(githubRelease, /function uploadMissingAssets/);
  assert.match(githubRelease, /function releaseAssetUploadBase/);
  assert.match(githubRelease, /uploads\.github\.com/);
  assert.match(githubRelease, /'--input'/);
  assert.match(githubRelease, /repos\/\$\{repo\}\/releases\/\$\{releaseId\}/);
  assert.match(githubRelease, /'draft=false'/);
  assert.match(githubRelease, /'make_latest=true'/);
  assert.match(githubRelease, /tag_name=\$\{ownership\.expectedTag\}/);
  assert.match(githubRelease, /target_commitish=\$\{ownership\.expectedTarget\}/);
  assert.match(githubRelease, /const publishStatuses = \[\]/);
  assert.match(githubRelease, /verifyReleaseWithRetries\('final'/);
  assert.match(githubRelease, /assertOwnedDraftReadyForPublish\(remote, ownership\)/);
  assert.match(githubRelease, /no second publish request was sent/);
  assert.match(githubRelease, /reconcilePublishedRelease/);
  assert.match(githubRelease, /--reconcile-only/);
  assert.match(githubRelease, /--remote-artifacts-only/);
  assert.match(githubRelease, /recoveryManifest: true/);
  assert.match(githubRelease, /no automatic draft deletion or rollback was attempted/);
  assert.match(githubRelease, /no automatic rollback was attempted/);
  assert.doesNotMatch(githubRelease, /cleanupOwnedDraft/);
  assert.doesNotMatch(githubRelease, /['"]release['"],\s*[\r\n\s]*['"]delete['"]/);
  assert.doesNotMatch(githubRelease, /['"]--clobber['"]/);
  assert.doesNotMatch(githubRelease, /\['release', 'upload'/);
  assert.doesNotMatch(githubRelease, /returnReleaseToDraft/);
  assert.doesNotMatch(githubRelease, /clearRecoveryAfterUnownedPublishedRelease/);
  assert.doesNotMatch(githubRelease, /releaseHasExpectedMarker/);
  assert.match(githubRelease, /metadataOnly: true/);
  assert.match(githubRelease, /formal automatic-update publishing cannot intentionally stop at a draft/);
  assert.match(githubRelease, /assertReleaseProvenanceMatchesSealedRecovery/);
  assert.match(githubRelease, /function assertLocalArtifactsMatchSealedRecovery/);
  assert.match(githubRelease, /uploadMissingAssets\(existing, missingAssets, ownership, releaseTarget\)/);
  assert.match(githubRelease, /creating draft release[\s\S]*assertLocalArtifactsMatchSealedRecovery\(releaseTarget\)/);
  assert.match(githubRelease, /assertSealedReleaseRecovery/);
  assert.match(githubRelease, /T8_RELEASE_BUILD_NONCE/);
  assert.match(githubRelease, /hashFile\(installer, 'sha512', 'base64'\)/);
  assert.match(githubRelease, /assertLatestYamlArtifact/);
  assert.match(latestYml, /yaml\.load/);
  assert.match(latestYml, /files\.length !== 1/);
  assert.match(releaseProvenance, /t8-electron-release-provenance-v1/);
  assert.match(releaseProvenance, /t8-electron-release-recovery-v1/);
  assert.match(releaseProvenance, /path\.join\(root, ['"]\.git['"]\)/);
  assert.match(releaseProvenance, /path\.join\(gitDirectory, ['"]t8-release['"]/);
  assert.match(releaseProvenance, /provenance source target does not match T8_RELEASE_TARGET/);
  assert.match(releaseProvenance, /provenance build nonce does not match this dist:release invocation/);
  assert.match(releaseProvenance, /artifact provenance mismatch/);
  assert.match(releaseProvenance, /already sealed with different artifact bytes and cannot be overwritten/);
  assert.match(releaseProvenance, /current provenance and local artifact bytes do not match sealed release recovery/);
  assert.match(releaseWorktree, /DEFAULT_ALLOWED_PACKAGING_DIRTY_PATHS/);
  assert.match(releaseWorktree, /source worktree is not release-clean/);

  const require = createRequire(import.meta.url);
  const {
    artifactPaths,
    assertReleaseRecovery,
    assertReleaseProvenance,
    assertReleaseProvenanceMatchesSealedRecovery,
    assertSealedReleaseRecovery,
    clearReleaseRecovery,
    readReleaseRecovery,
    releaseRecoveryPath,
    sealReleaseRecovery,
    writeReleaseRecovery,
    writeReleaseProvenance,
  } = require('../scripts/release-provenance.cjs');
  const {
    assertExistingDraftOwnership,
    assertOwnedDraftReadyForPublish,
    assertPublishedReleaseOwnership,
    assertReleaseAssetsMatchManifest,
    buildReleaseDraftMarker,
    markedReleaseBody,
    releaseAssetUploadBase,
    releaseNotFound,
    withMarkedReleaseNotes,
  } = require('../scripts/release-github.cjs');
  const {
    classifyReleaseWorktreeStatus,
  } = require('../scripts/release-worktree.cjs');
  const { assertLatestYamlArtifact } = require('../scripts/latest-yml.cjs');
  const {
    assertExactReleaseAssets,
    assertReleaseAssetMetadata,
    withReleaseTemp,
  } = require('../scripts/verify-github-release.cjs');
  const fixtureInstallerName = 'T8-ProvenanceFixture-Setup-9.9.9.exe';
  const fixtureInstallerSha512 = 'fixture-installer-sha512';
  const fixtureBlockmapName = `${fixtureInstallerName}.blockmap`;
  const fixtureAssetNames = [fixtureInstallerName, fixtureBlockmapName, 'latest.yml'];
  const fixtureTarget = 'c'.repeat(40);
  const fixtureNonceHash = 'd'.repeat(64);
  const fixtureTitle = 'Fixture v9.9.9';
  const fixtureMarker = buildReleaseDraftMarker({
    target: fixtureTarget,
    nonceSha256: fixtureNonceHash,
  });
  const fixtureBody = `fixture notes\n\n${fixtureMarker}\n`;
  const fixtureExpectedArtifacts = {
    installer: {
      name: fixtureInstallerName,
      size: 128,
      sha256: 'a'.repeat(64),
    },
    blockmap: {
      name: fixtureBlockmapName,
      size: 129,
      sha256: 'b'.repeat(64),
    },
    latest: {
      name: 'latest.yml',
      size: 130,
      sha256: 'c'.repeat(64),
    },
  };
  const fixtureAssets = Object.values(fixtureExpectedArtifacts).map((artifact) => ({
    name: artifact.name,
    size: artifact.size,
    digest: `sha256:${artifact.sha256}`,
  }));
  const fixtureOwnership = {
    expectedTag: 'v9.9.9',
    expectedTarget: fixtureTarget,
    expectedMarker: fixtureMarker,
    expectedAssetNames: fixtureAssetNames,
    expectedTitle: fixtureTitle,
    expectedBody: fixtureBody,
    expectedArtifacts: fixtureExpectedArtifacts,
  };
  assert.deepEqual(classifyReleaseWorktreeStatus([
    ' M tools/ffmpeg-runtime/ffmpeg.exe',
    ' M tools/remove-ai-watermarks-runtime/README.md',
  ].join('\n')), {
    unexpected: [],
    permitted: [
      ' M tools/ffmpeg-runtime/ffmpeg.exe',
      ' M tools/remove-ai-watermarks-runtime/README.md',
    ],
  });
  assert.deepEqual(classifyReleaseWorktreeStatus(
    'M  tools/ffmpeg-runtime/ffmpeg.exe',
  ).unexpected, ['M  tools/ffmpeg-runtime/ffmpeg.exe']);
  assert.deepEqual(classifyReleaseWorktreeStatus(
    ' M scripts/release-github.cjs',
  ).unexpected, [' M scripts/release-github.cjs']);
  let markedNotesPath = '';
  assert.equal(withMarkedReleaseNotes(fixtureMarker, undefined, (tempNotes: string) => {
    markedNotesPath = tempNotes;
    const text = readFileSync(tempNotes, 'utf8');
    assert.equal(text.includes(fixtureMarker), true);
    assert.equal(text.match(/t8-electron-release-draft-v1/g)?.length, 1);
    return 'marked-notes-ok';
  }), 'marked-notes-ok');
  assert.equal(markedReleaseBody(fixtureMarker).match(/t8-electron-release-draft-v1/g)?.length, 1);
  assert.equal(existsSync(markedNotesPath), false);
  assert.equal(releaseNotFound({
    status: 1,
    stdout: '',
    stderr: 'release not found',
  }), true);
  assert.equal(releaseNotFound({
    status: 1,
    stdout: '',
    stderr: 'HTTP 429 rate limit exceeded',
  }), false);
  const fixtureDraft = (overrides: Record<string, unknown> = {}) => ({
    databaseId: 123456,
    uploadUrl: 'https://uploads.github.com/repos/T8mars/T8-penguin-canvas/releases/123456/assets{?name,label}',
    tagName: 'v9.9.9',
    name: fixtureTitle,
    isDraft: true,
    isPrerelease: false,
    targetCommitish: fixtureTarget,
    body: fixtureBody,
    assets: [fixtureAssets[0]],
    ...overrides,
  });
  assert.doesNotThrow(() => assertExistingDraftOwnership(fixtureDraft(), fixtureOwnership));
  assert.doesNotThrow(() => assertReleaseAssetsMatchManifest(
    fixtureDraft().assets,
    fixtureExpectedArtifacts,
    { allowSubset: true },
  ));
  assert.doesNotThrow(() => assertOwnedDraftReadyForPublish(
    fixtureDraft({ assets: fixtureAssets }),
    fixtureOwnership,
  ));
  assert.equal(
    releaseAssetUploadBase(fixtureDraft()).toString(),
    'https://uploads.github.com/repos/T8mars/T8-penguin-canvas/releases/123456/assets',
  );
  assert.throws(() => releaseAssetUploadBase(fixtureDraft({
    uploadUrl: 'https://uploads.github.com/repos/T8mars/other/releases/123456/assets{?name,label}',
  })), /does not match/);
  assert.throws(() => assertExistingDraftOwnership(fixtureDraft({
    targetCommitish: 'e'.repeat(40),
  }), fixtureOwnership), /targets/);
  assert.throws(() => assertExistingDraftOwnership(fixtureDraft({
    body: '<!-- t8-electron-release-draft-v1 target=cccccccccccccccccccccccccccccccccccccccc nonceSha256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee -->',
  }), fixtureOwnership), /not owned/);
  assert.throws(() => assertExistingDraftOwnership(fixtureDraft({
    assets: [{ name: fixtureInstallerName }, { name: 'unexpected-debug.zip' }],
  }), fixtureOwnership), /unexpected assets/);
  assert.throws(() => assertOwnedDraftReadyForPublish(fixtureDraft({
    assets: fixtureAssets.map((asset, index) => (
      index === 1 ? { ...asset, digest: `sha256:${'e'.repeat(64)}` } : asset
    )),
  }), fixtureOwnership), /SHA-256 metadata mismatch/);
  const fixturePublished = {
    ...fixtureDraft({ assets: fixtureAssets }),
    isDraft: false,
  };
  assert.doesNotThrow(() => assertPublishedReleaseOwnership(fixturePublished, fixtureOwnership));
  assert.throws(() => assertPublishedReleaseOwnership({
    ...fixturePublished,
    body: `changed notes\n\n${fixtureMarker}\n`,
  }, fixtureOwnership), /notes do not match/);
  assert.doesNotThrow(() => assertExactReleaseAssets(
    fixtureAssetNames.map((name) => ({ name, size: 1 })),
    fixtureAssetNames,
  ));
  assert.throws(() => assertExactReleaseAssets(
    [...fixtureAssetNames, 'unexpected-debug.zip'].map((name) => ({ name, size: 1 })),
    fixtureAssetNames,
  ), /unexpected release asset/);
  assert.throws(() => assertExactReleaseAssets(
    fixtureAssetNames.slice(0, 2).map((name) => ({ name, size: 1 })),
    fixtureAssetNames,
  ), /missing release asset/);
  assert.throws(() => assertExactReleaseAssets(
    [fixtureInstallerName, fixtureInstallerName, 'latest.yml'].map((name) => ({ name, size: 1 })),
    fixtureAssetNames,
  ), /duplicate asset names/);
  assert.doesNotThrow(() => assertReleaseAssetMetadata(
    new Map(fixtureAssets.map((asset) => [asset.name, asset])),
    new Map(Object.values(fixtureExpectedArtifacts).map((artifact) => [
      artifact.name,
      { size: artifact.size, sha256: artifact.sha256 },
    ])),
  ));
  const latestFixture = ({
    version = '9.9.9',
    entrySha512 = fixtureInstallerSha512,
    topLevelSha512 = fixtureInstallerSha512,
  } = {}) => [
    `version: ${version}`,
    'files:',
    `  - url: ${fixtureInstallerName}`,
    `    sha512: ${entrySha512}`,
    '    size: 128',
    `path: ${fixtureInstallerName}`,
    `sha512: ${topLevelSha512}`,
    'releaseDate: 2026-07-16T00:00:00.000Z',
  ].join('\n');
  assert.doesNotThrow(() => assertLatestYamlArtifact({
    text: latestFixture(),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }));
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture({ version: '9.9.90' }),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /version mismatch/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture({ version: '[9.9.9]' }),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /version mismatch/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture().replace(
      `  - url: ${fixtureInstallerName}`,
      `  - url: [${fixtureInstallerName}]`,
    ),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /missing or duplicated/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture().replace(
      `path: ${fixtureInstallerName}`,
      `path: [${fixtureInstallerName}]`,
    ),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /top-level path mismatch/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture({
      entrySha512: 'wrong-files-entry-sha512',
      topLevelSha512: fixtureInstallerSha512,
    }),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /sha512 mismatch/);
  assert.throws(() => assertLatestYamlArtifact({
    text: [
      'version: 9.9.9',
      'unrelated:',
      `  - url: ${fixtureInstallerName}`,
      `    sha512: ${fixtureInstallerSha512}`,
      '    size: 128',
      'files:',
      '  - url: wrong-installer.exe',
      `    sha512: ${fixtureInstallerSha512}`,
      '    size: 128',
      `path: ${fixtureInstallerName}`,
      `sha512: ${fixtureInstallerSha512}`,
    ].join('\n'),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /missing or duplicated/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture().replace(
      `    sha512: ${fixtureInstallerSha512}`,
      [
        '    sha512: wrong-files-entry-sha512',
        '    metadata:',
        `      sha512: ${fixtureInstallerSha512}`,
      ].join('\n'),
    ),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /installer sha512 mismatch/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture().replace(
      [
        `    sha512: ${fixtureInstallerSha512}`,
        '    size: 128',
      ].join('\n'),
      [
        '    metadata:',
        `      sha512: ${fixtureInstallerSha512}`,
        '      size: 128',
      ].join('\n'),
    ),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /installer sha512 is missing/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture().replace(
      `  - url: ${fixtureInstallerName}`,
      [
        '  - url: unexpected-first-installer.exe',
        `    sha512: ${fixtureInstallerSha512}`,
        '    size: 128',
        `  - url: ${fixtureInstallerName}`,
      ].join('\n'),
    ),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /exactly one entry/);
  assert.throws(() => assertLatestYamlArtifact({
    text: `${latestFixture()}\nversion: 9.9.9`,
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /YAML parse failed/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture().replace(
      `    size: 128`,
      `    size: 128\n    size: 128`,
    ),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /YAML parse failed/);
  assert.throws(() => assertLatestYamlArtifact({
    text: `${latestFixture()}\nfiles:\n  - url: duplicate.exe`,
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /YAML parse failed/);
  assert.throws(() => assertLatestYamlArtifact({
    text: latestFixture().replace(
      `\nsha512: ${fixtureInstallerSha512}\n`,
      '\nsha512: wrong-top-level-sha512\n',
    ),
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /top-level sha512 mismatch/);
  assert.throws(() => assertLatestYamlArtifact({
    text: `${latestFixture()}\nbad: [`,
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /YAML parse failed/);
  assert.throws(() => assertLatestYamlArtifact({
    text: `${latestFixture()}\n---\nversion: 9.9.9`,
    version: '9.9.9',
    installerName: fixtureInstallerName,
    installerSha512: fixtureInstallerSha512,
    installerSize: 128,
  }), /YAML parse failed/);
  let failedVerifyTemp = '';
  assert.throws(() => withReleaseTemp((tempDir: string) => {
    failedVerifyTemp = tempDir;
    writeFileSync(join(tempDir, 'partial-installer.exe'), Buffer.alloc(16));
    throw new Error('fixture verification failure');
  }), /fixture verification failure/);
  assert.equal(existsSync(failedVerifyTemp), false);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 't8-release-provenance-'));
  const fixturePackage = { version: '9.9.9', build: { productName: 'T8-ProvenanceFixture' } };
  const target = fixtureTarget;
  const nonce = 'ab'.repeat(32);
  try {
    mkdirSync(join(fixtureRoot, '.git'), { recursive: true });
    const paths = artifactPaths(fixtureRoot, fixturePackage);
    mkdirSync(paths.distDir, { recursive: true });
    for (const [index, artifact] of paths.artifacts.entries()) {
      writeFileSync(artifact.path, Buffer.alloc(128 + index, index + 1));
    }
    const recoveryPath = releaseRecoveryPath(fixtureRoot, fixturePackage);
    assert.match(recoveryPath, /[\\\/]\.git[\\\/]t8-release[\\\/]release-recovery-9\.9\.9\.json$/);
    assert.equal(readReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
    }), null);
    writeReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    });
    assert.equal(existsSync(recoveryPath), true);
    assert.equal(assertReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }).recovery.nonce, nonce);
    assert.throws(() => assertReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce: 'de'.repeat(32),
    }), /recovery nonce/);
    assert.throws(() => readReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target: 'e'.repeat(40),
    }), /source target mismatch/);
    writeReleaseProvenance({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    });
    sealReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    });
    const sealed = assertSealedReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    });
    assert.equal(sealed.recovery.artifacts.installer.name, fixtureInstallerName);
    assert.equal(sealed.recovery.artifacts.installer.size, 128);
    assert.doesNotThrow(() => assertReleaseProvenanceMatchesSealedRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }));
    writeFileSync(paths.artifacts[0].path, Buffer.alloc(256, 9));
    writeReleaseProvenance({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    });
    assert.throws(() => sealReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }), /already sealed with different artifact bytes/);
    assert.throws(() => assertReleaseProvenanceMatchesSealedRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }), /do not match sealed release recovery/);
    writeFileSync(paths.artifacts[0].path, Buffer.alloc(128, 1));
    writeReleaseProvenance({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    });
    assert.doesNotThrow(() => sealReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }));
    assert.equal(assertReleaseProvenance({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }).target, target);
    assert.throws(() => assertReleaseProvenance({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce: 'de'.repeat(32),
    }), /build nonce/);
    writeFileSync(paths.artifacts[1].path, Buffer.from('changed blockmap'));
    assert.throws(() => assertReleaseProvenance({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }), /artifact provenance mismatch/);
    assert.equal(clearReleaseRecovery({
      root: fixtureRoot,
      pkg: fixturePackage,
      target,
      nonce,
    }), recoveryPath);
    assert.equal(existsSync(recoveryPath), false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Electron release verifies packaged media and offline runtime sidecars', () => {
  const packageJson = JSON.parse(read('../package.json'));
  const files = packageJson.build.files;
  const resources = packageJson.build.win.extraResources.map((item: any) => `${item.from}->${item.to}`);
  const ffmpegResource = packageJson.build.win.extraResources.find((item: any) => item.to === 'tools/ffmpeg');
  const llmMedia = read('../backend/src/providers/llmMedia.js');

  assert.equal(packageJson.build.compression, 'normal');
  assert.ok(files.includes('!node_modules/@ffmpeg-installer/**/*'));
  assert.ok(files.includes('!node_modules/@ffprobe-installer/**/*'));
  assert.ok(resources.includes('tools/ffmpeg-runtime->tools/ffmpeg'));
  const sharedResource = packageJson.build.extraResources.find((item: any) => item.to === 'shared');
  assert.deepEqual(ffmpegResource.filter, ['ffmpeg.exe', 'ffprobe.exe', 'README.md']);
  assert.ok(sharedResource.filter.includes('videoTransitions.json'));
  assert.match(llmMedia, /resRoot && path\.join\(resRoot, 'tools', 'ffmpeg', binary\)/);
  assert.match(llmMedia, /function resolveBundledFfprobe\(\)/);
  assert.match(llmMedia, /resRoot && path\.join\(resRoot, 'tools', 'ffmpeg', binary\)/);
  assert.match(llmMedia, /ffprobeBinaryName/);
  assert.match(llmMedia, /optional dev fallback only/);

  const postBuild = read('../electron/_post_build.cjs');
  const runtimeArchivePrep = read('../scripts/prepare-runtime-archives.cjs');
  assert.match(postBuild, /function loadPackagedVideoTransitions\(\)/);
  assert.match(postBuild, /videoTransitions\.json/);
  assert.match(postBuild, /for \(const transition of loadPackagedVideoTransitions\(\)\)/);
  assert.match(postBuild, /transition\.quality !== 'native-xfade'/);
  assert.match(postBuild, /transition\.xfade/);
  assert.match(postBuild, /missingTransitions/);
  assert.match(postBuild, /function checkFfprobeRuntime\(\)/);
  assert.match(postBuild, /ffprobe/);
  assert.match(postBuild, /show_format/);
  assert.match(postBuild, /packaged ffprobe JSON probe verified/);
  assert.match(runtimeArchivePrep, /function assertStrictRuntimeSource\(/);
  assert.match(runtimeArchivePrep, /python\/Scripts\/remove-ai-watermarks\.exe/);
  assert.match(runtimeArchivePrep, /parsehub\/__init__\.py/);
  assert.match(runtimeArchivePrep, /minimumSourceFiles: 40_000/);
  assert.match(runtimeArchivePrep, /archiveSha256: sha256File\(archivePath\)/);
  assert.match(runtimeArchivePrep, /sourceSha256: sourceHash\.digest\('hex'\)/);
  assert.match(runtimeArchivePrep, /String\(entry\.sourceSha256\)\.toLowerCase\(\) === sourceStats\.sourceSha256/);
  assert.ok(runtimeArchivePrep.includes("if (!/^[a-f0-9]{64}$/i.test(String(entry.archiveSha256 || ''))) return true;"));
  assert.match(postBuild, /function verifyPackagedRuntimeArchive\(/);
  assert.match(postBuild, /minimumArchiveBytes: 500_000_000/);
  assert.match(postBuild, /entry\.sourceSha256/);
  assert.match(postBuild, /spawnSync\(\s*path7za,\s*\['t', '-mmt=2'/);
  assert.match(postBuild, /packaged runtime archive is missing required entries/);
  assert.match(postBuild, /T8_RUNTIME_ARCHIVE_7Z/);
  assert.match(postBuild, /ProgramFiles[\s\S]*7-Zip[\s\S]*7z\.exe/);
  assert.match(read('../scripts/prepare-runtime-archives.cjs'), /T8_RUNTIME_ARCHIVE_7Z/);
  assert.match(postBuild, /archive SHA-256, CRC and required entries verified/);
  assert.match(postBuild, /if \(archiveStrict\) \{[\s\S]*verifyPackagedRuntimeArchive\([\s\S]*verifyDirectAiWatermarkRuntime\(runtimeRoot\)/);
  assert.match(postBuild, /if \(archiveStrict\) \{[\s\S]*verifyPackagedRuntimeArchive\([\s\S]*verifyDirectParseHubRuntime\(libsRoot\)/);
  assert.match(postBuild, /function verifyDirectAiWatermarkRuntime\(/);
  assert.match(postBuild, /function verifyDirectParseHubRuntime\(/);

  const fixtureRoot = mkdtempSync(join(tmpdir(), 't8-runtime-gate-'));
  const postBuildPath = fileURLToPath(new URL('../electron/_post_build.cjs', import.meta.url));
  const runHelper = (helper: string, env: Record<string, string>) => spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(postBuildPath)}).${helper}(${JSON.stringify(fixtureRoot)})`],
    {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  try {
    const aiRoot = join(fixtureRoot, 'tools', 'remove-ai-watermarks');
    mkdirSync(aiRoot, { recursive: true });
    writeFileSync(join(aiRoot, 'remove-ai-watermarks.exe'), Buffer.alloc(32 * 1024, 1));
    writeFileSync(join(aiRoot, 'runtime-manifest.json'), '{}');
    const strictArchiveFirst = runHelper('checkAiWatermarkRuntime', {
      T8_REQUIRE_AI_WATERMARK_RUNTIME: '1',
      T8_REQUIRE_RUNTIME_ARCHIVES: '1',
    });
    assert.equal(strictArchiveFirst.status, 1, strictArchiveFirst.stderr || strictArchiveFirst.stdout);
    assert.match(
      `${strictArchiveFirst.stdout}\n${strictArchiveFirst.stderr}`,
      /packaged runtime archive is missing/,
    );

    writeFileSync(join(aiRoot, 'remove-ai-watermarks.exe'), Buffer.from([1]));
    const tinyDirectAi = runHelper('checkAiWatermarkRuntime', {
      T8_REQUIRE_AI_WATERMARK_RUNTIME: '1',
      T8_REQUIRE_RUNTIME_ARCHIVES: '0',
    });
    assert.equal(tinyDirectAi.status, 1, tinyDirectAi.stderr || tinyDirectAi.stdout);
    assert.match(
      `${tinyDirectAi.stdout}\n${tinyDirectAi.stderr}`,
      /direct remove-ai-watermarks runtime is incomplete or implausibly small/,
    );

    const parseBridge = join(fixtureRoot, 'tools', 'parsehub-bridge');
    const parseLibs = join(fixtureRoot, 'tools', 'parsehub-pythonlibs');
    mkdirSync(parseBridge, { recursive: true });
    mkdirSync(parseLibs, { recursive: true });
    writeFileSync(join(parseBridge, 'parsehub_bridge.py'), '# fixture');
    const emptyDirectParseHub = runHelper('checkParseHubRuntime', {
      T8_REQUIRE_PARSEHUB_RUNTIME: '1',
      T8_REQUIRE_RUNTIME_ARCHIVES: '0',
    });
    assert.equal(emptyDirectParseHub.status, 1, emptyDirectParseHub.stderr || emptyDirectParseHub.stdout);
    assert.match(
      `${emptyDirectParseHub.stdout}\n${emptyDirectParseHub.stderr}`,
      /direct ParseHub runtime is incomplete or implausibly small/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Electron packaging verifies encrypted local extension hook points', () => {
  const postBuild = read('../electron/_post_build.cjs');
  const encrypt = read('../electron/encrypt.cjs');

  assert.match(postBuild, /extensions['"], ['"]runtimeHooks\.t8c/);
  assert.match(postBuild, /routes['"], ['"]figma\.t8c/);
  assert.match(postBuild, /routes['"], ['"]grokOAuth\.t8c/);
  assert.match(postBuild, /routes['"], ['"]codexCli\.t8c/);
  assert.match(postBuild, /utils['"], ['"]codexCliRunner\.t8c/);
  assert.match(postBuild, /utils['"], ['"]figmaBridge\.t8c/);
  assert.match(postBuild, /checkFigmaBridgeRuntime/);
  assert.match(postBuild, /tools['"], ['"]figma-bridge/);
  assert.match(encrypt, /const LOCAL_PRIVATE_BACKEND_DIRS = \[/);
  assert.match(encrypt, /path\.join\(LOCAL_PRIVATE_SRC, 'extensions', 'backend'\)/);
  assert.match(encrypt, /path\.join\(LOCAL_PRIVATE_SRC, 'recharge', 'backend'\)/);
  assert.doesNotMatch(encrypt, /walk\(LOCAL_PRIVATE_SRC\)/);
  const packageJson = JSON.parse(read('../package.json'));
  const resources = packageJson.build.extraResources.map((item: any) => `${item.from}->${item.to}`);
  assert.ok(resources.includes('tools/figma-bridge->tools/figma-bridge'));
  const localHook = new URL('../local-private/extensions/build/post-build.cjs', import.meta.url);
  if (existsSync(localHook)) {
    const localPostBuild = read('../local-private/extensions/build/post-build.cjs');
    assert.match(localPostBuild, /zhenzhenGroups\.t8c/);
    assert.match(localPostBuild, /private New API group source must be encrypted/);
    assert.match(localPostBuild, /backend-enc['"], ['"]local-private/);
  }
});

test('formal Electron releases fail closed when required private sidecars are missing', () => {
  const distRelease = read('../scripts/dist-release.cjs');
  const viteConfig = read('../vite.config.ts');
  const encrypt = read('../electron/encrypt.cjs');
  const postBuild = read('../electron/_post_build.cjs');

  assert.match(distRelease, /T8_REQUIRE_AI_WATERMARK_RUNTIME:\s*['"]1['"]/);
  assert.match(distRelease, /T8_REQUIRE_PARSEHUB_RUNTIME:\s*['"]1['"]/);
  assert.match(distRelease, /T8_REQUIRE_RUNTIME_ARCHIVES:\s*['"]1['"]/);
  assert.match(distRelease, /T8_REQUIRE_UPDATE_ARTIFACTS:\s*['"]1['"]/);
  assert.match(distRelease, /T8_REQUIRE_LOCAL_PRIVATE:\s*['"]1['"]/);
  assert.match(distRelease, /T8_ENABLE_LOCAL_PRIVATE:\s*['"]1['"]/);
  assert.match(distRelease, /T8_DISABLE_LOCAL_EXTENSIONS:\s*['"]0['"]/);
  assert.doesNotMatch(distRelease, /T8_REQUIRE_[A-Z_]+:\s*process\.env\./);

  assert.match(viteConfig, /LOCAL_REQUIRED_FRONTEND_ENTRY/);
  assert.match(viteConfig, /process\.env\.T8_REQUIRE_LOCAL_PRIVATE !== ['"]1['"]/);
  assert.match(viteConfig, /formal release requires local private frontend/);
  assert.match(viteConfig, /formal release cannot disable local private extensions/);

  assert.match(encrypt, /REQUIRED_LOCAL_PRIVATE_BACKEND/);
  assert.match(encrypt, /REQUIRED_LOCAL_PRIVATE_OUTPUT/);
  assert.match(encrypt, /recharge['"], ['"]backend['"], ['"]routes\.cjs/);
  assert.match(encrypt, /recharge['"], ['"]backend['"], ['"]routes\.t8c/);
  assert.match(encrypt, /formal release requires local private backend/);
  assert.match(encrypt, /local private bytecode missing after encryption/);

  assert.match(postBuild, /const required = process\.env\.T8_REQUIRE_LOCAL_PRIVATE === ['"]1['"]/);
  assert.match(postBuild, /formal release cannot disable local private build hook/);
  assert.match(postBuild, /formal release requires local private build hook/);
  assert.match(postBuild, /function checkRequiredLocalPrivateArtifacts\(\)/);
  assert.match(postBuild, /formal release missing encrypted local private backend/);
  assert.match(postBuild, /formal release leaked local private backend source/);
  assert.match(postBuild, /local-private['"], ['"]recharge['"], ['"]backend['"], ['"]routes\.t8c/);
  assert.match(postBuild, /checkRequiredLocalPrivateArtifacts\(\)/);
});
