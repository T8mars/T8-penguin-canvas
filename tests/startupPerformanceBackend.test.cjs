const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');
const {
  ProjectDatabase,
  ProjectDatabaseSchemaInvalidError,
  closeProjectDatabase,
  getProjectDatabase,
} = require('../backend/src/services/projectDatabase');
const { stripSchema32ForSyntheticSchema31 } = require('./helpers/projectDatabaseVersion.cjs');
const settingsRouter = require('../backend/src/routes/settings');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_DB_SOURCE = path.join(ROOT, 'backend', 'src', 'services', 'projectDatabase.js');
const SETTINGS_SOURCE = path.join(ROOT, 'backend', 'src', 'routes', 'settings.js');
const SERVER_SOURCE = path.join(ROOT, 'backend', 'src', 'server.js');
const ELECTRON_SOURCE = path.join(ROOT, 'electron', 'main.cjs');
const mib = (value) => value * 1024 * 1024;
const TEST_PROJECT_DATABASE_STORAGE_POLICY_32 = Object.freeze({
  mainMaxBytes: mib(64),
  walCheckpointTargetBytes: mib(1),
  maximumSingleTransactionWalBytes: mib(4),
  walPressureBytes: mib(8),
  walReserveBytes: mib(16),
  walResidualLimitBytes: mib(0.5),
  shmReserveBytes: mib(4),
  hotJournalReserveBytes: mib(8),
  sqliteTempReserveBytes: mib(16),
  minimumFilesystemFreeBytes: mib(64),
  backupCandidateReserveBytes: mib(80),
  recoveryEvidenceReserveBytes: mib(96),
});

function makeTempDatabase(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    directory,
    filename: path.join(directory, 'projects.sqlite3'),
  };
}

async function seedDatabase(filename) {
  const database = new ProjectDatabase(filename, {
    autoBackup: false,
    projectDatabaseStoragePolicy32: TEST_PROJECT_DATABASE_STORAGE_POLICY_32,
  });
  try {
    database.ensureCanvas('seed-canvas', {
      name: 'Seed canvas',
      nodes: [],
      edges: [],
    });
  } finally {
    await database.close();
  }
}

test('canvas list fast path is stable, bounded, and parses only requested pages', async () => {
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const projectId = 'project-page';
    for (const [id, name, nodeCount] of [
      ['canvas-e', 'Echo', 5],
      ['canvas-c', 'Charlie', 3],
      ['canvas-a', 'Alpha', 1],
      ['canvas-d', 'Delta', 4],
      ['canvas-b', 'Bravo', 2],
    ]) {
      database.ensureCanvas(id, {
        name,
        nodes: Array.from({ length: nodeCount }, (_, index) => ({ id: `${id}-node-${index}` })),
        edges: [],
      }, projectId);
      database.db.prepare('UPDATE canvas_documents SET updated_at = ? WHERE canvas_id = ?')
        .run(1_000, id);
    }

    const first = database.listCanvasesPage(projectId, { limit: 2 });
    assert.deepEqual(first.items.map((item) => item.id), ['canvas-a', 'canvas-b']);
    assert.equal(first.hasMore, true);
    assert.deepEqual(
      JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8')),
      [1_000, 'canvas-b'],
    );

    const second = database.listCanvasesPage(projectId, {
      limit: 2,
      cursor: first.nextCursor,
    });
    assert.deepEqual(second.items.map((item) => item.id), ['canvas-c', 'canvas-d']);
    assert.equal(second.hasMore, true);

    const third = database.listCanvasesPage(projectId, {
      limit: 2,
      cursor: second.nextCursor,
    });
    assert.deepEqual(third.items.map((item) => item.id), ['canvas-e']);
    assert.equal(third.hasMore, false);
    assert.equal(third.nextCursor, null);

    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((item) => item.id),
      ['canvas-a', 'canvas-b', 'canvas-c', 'canvas-d', 'canvas-e'],
    );
    assert.throws(
      () => database.listCanvasesPage(projectId, { limit: 0 }),
      (error) => error?.code === 'canvas_list_limit_invalid' && error?.status === 400,
    );
    assert.throws(
      () => database.listCanvasesPage(projectId, { cursor: 'not*a*cursor' }),
      (error) => error?.code === 'canvas_list_cursor_invalid' && error?.status === 400,
    );
    assert.equal(database.listCanvases(projectId).length, 5);
  } finally {
    await database.close();
  }
});

test('five thousand canvases stay available without hydrating the whole catalog at startup', async () => {
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const insert = database.db.prepare(`
      INSERT INTO canvas_documents(
        canvas_id, project_id, schema_version, revision,
        snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    database.db.transaction(() => {
      for (let index = 0; index < 5_000; index += 1) {
        const canvasId = `canvas-${String(index).padStart(5, '0')}`;
        const timestamp = index + 1;
        insert.run(
          canvasId,
          'project-large-catalog',
          1,
          1,
          JSON.stringify({
            canvasId,
            projectId: 'project-large-catalog',
            schemaVersion: 1,
            revision: 1,
            name: `Canvas ${index}`,
            nodeCount: index % 17,
            nodes: [],
            edges: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
          timestamp,
          timestamp,
        );
      }
    })();

    const startedAt = performance.now();
    const firstPage = database.listCanvasesPage('project-large-catalog', { limit: 50 });
    const elapsedMs = performance.now() - startedAt;

    assert.equal(database.db.prepare(`
      SELECT COUNT(*) AS count FROM canvas_documents WHERE project_id = ?
    `).get('project-large-catalog').count, 5_000);
    assert.equal(firstPage.items.length, 50);
    assert.equal(firstPage.hasMore, true);
    assert.ok(firstPage.nextCursor);
    assert.equal(firstPage.items[0].id, 'canvas-04999');
    assert.equal(firstPage.items.at(-1).id, 'canvas-04950');
    assert.ok(elapsedMs < 500, `first catalog page took ${elapsedMs.toFixed(1)}ms`);
  } finally {
    await database.close();
  }
});

test('clean current database skips only duplicate isolated preflight and still runs active checks', async () => {
  const fixture = makeTempDatabase('t8-startup-clean-');
  try {
    await seedDatabase(fixture.filename);
    let preflightCalls = 0;
    const database = new ProjectDatabase(fixture.filename, {
      autoBackup: false,
      projectDatabaseStoragePolicy32: TEST_PROJECT_DATABASE_STORAGE_POLICY_32,
      beforeStartupPreflight: () => { preflightCalls += 1; },
    });
    try {
      assert.equal(database.startupUsedCleanActiveFastPath, true);
      assert.equal(preflightCalls, 0);
      assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
      assert.ok(Object.hasOwn(database.startupDurations, 'active-initialized'));
      assert.ok(Object.hasOwn(database.startupDurations, 'clean-active-fast-path'));
    } finally {
      await database.close();
    }
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('source state changes between active open and validation force isolated preflight', async () => {
  const fixture = makeTempDatabase('t8-startup-change-');
  const sentinel = new ProjectDatabaseSchemaInvalidError('preflight-observed-after-change');
  try {
    await seedDatabase(fixture.filename);
    let activeOpenCalls = 0;
    let preflightCalls = 0;
    assert.throws(() => new ProjectDatabase(fixture.filename, {
      autoBackup: false,
      projectDatabaseStoragePolicy32: TEST_PROJECT_DATABASE_STORAGE_POLICY_32,
      afterStartupFastPathOpen: () => {
        activeOpenCalls += 1;
        const stat = fs.statSync(fixture.filename);
        fs.utimesSync(fixture.filename, stat.atime, new Date(stat.mtimeMs + 60_000));
      },
      beforeStartupPreflight: () => {
        preflightCalls += 1;
        throw sentinel;
      },
    }), (error) => error === sentinel);
    assert.equal(activeOpenCalls, 1);
    assert.equal(preflightCalls, 1);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('non-empty WAL state cannot enter the clean active fast path', async () => {
  const fixture = makeTempDatabase('t8-startup-wal-');
  const sentinel = new ProjectDatabaseSchemaInvalidError('dirty-wal-preflight-observed');
  try {
    await seedDatabase(fixture.filename);
    fs.writeFileSync(`${fixture.filename}-wal`, Buffer.from('dirty-startup-evidence'));
    let activeOpenCalls = 0;
    let preflightCalls = 0;
    assert.throws(() => new ProjectDatabase(fixture.filename, {
      autoBackup: false,
      projectDatabaseStoragePolicy32: TEST_PROJECT_DATABASE_STORAGE_POLICY_32,
      afterStartupFastPathOpen: () => { activeOpenCalls += 1; },
      beforeStartupPreflight: () => {
        preflightCalls += 1;
        throw sentinel;
      },
    }), (error) => error === sentinel);
    assert.equal(activeOpenCalls, 0);
    assert.equal(preflightCalls, 1);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('older schema state cannot skip isolated preflight or migration safety gates', async () => {
  const fixture = makeTempDatabase('t8-startup-migration-');
  const sentinel = new ProjectDatabaseSchemaInvalidError('legacy-schema-preflight-observed');
  try {
    await seedDatabase(fixture.filename);
    const raw = new BetterSqlite3(fixture.filename);
    try {
      assert.equal(stripSchema32ForSyntheticSchema31(raw), true);
    } finally {
      raw.close();
    }

    let activeOpenCalls = 0;
    let preflightCalls = 0;
    assert.throws(() => new ProjectDatabase(fixture.filename, {
      autoBackup: false,
      projectDatabaseStoragePolicy32: TEST_PROJECT_DATABASE_STORAGE_POLICY_32,
      afterStartupFastPathOpen: () => { activeOpenCalls += 1; },
      beforeStartupPreflight: () => {
        preflightCalls += 1;
        throw sentinel;
      },
    }), (error) => error === sentinel);
    assert.equal(activeOpenCalls, 1);
    assert.equal(preflightCalls, 1);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('startup backup can be deferred until the frontend is interactive', async () => {
  const fixture = makeTempDatabase('t8-startup-backup-');
  const backupFilename = path.join(fixture.directory, 'projects.backup.sqlite3');
  const database = new ProjectDatabase(fixture.filename, {
    backupFilename,
    deferStartupBackup: true,
    projectDatabaseStoragePolicy32: TEST_PROJECT_DATABASE_STORAGE_POLICY_32,
  });
  try {
    database.ensureCanvas('backup-canvas', { name: 'Backup', nodes: [], edges: [] });
    assert.equal(fs.existsSync(backupFilename), false);
    await database.startStartupBackup();
    assert.equal(fs.existsSync(backupFilename), true);
  } finally {
    await database.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('no-argument project database access stays lazy and preserves singleton compatibility', async () => {
  const fixture = makeTempDatabase('t8-startup-noarg-db-');
  const runtimeConfig = require('../backend/src/config');
  const previousDatabaseFile = runtimeConfig.PROJECT_DB_FILE;
  const previousBackupFile = runtimeConfig.PROJECT_DB_BACKUP_FILE;
  const previousStoragePolicy = runtimeConfig.PROJECT_DB_STORAGE_POLICY_32;
  try {
    runtimeConfig.PROJECT_DB_FILE = fixture.filename;
    runtimeConfig.PROJECT_DB_BACKUP_FILE = path.join(fixture.directory, 'projects.backup.sqlite3');
    runtimeConfig.PROJECT_DB_STORAGE_POLICY_32 = TEST_PROJECT_DATABASE_STORAGE_POLICY_32;
    const first = getProjectDatabase();
    const second = getProjectDatabase();
    assert.strictEqual(second, first);
    assert.equal(first.db.open, true);
  } finally {
    await closeProjectDatabase();
    runtimeConfig.PROJECT_DB_FILE = previousDatabaseFile;
    runtimeConfig.PROJECT_DB_BACKUP_FILE = previousBackupFile;
    runtimeConfig.PROJECT_DB_STORAGE_POLICY_32 = previousStoragePolicy;
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
test('settings import does not synchronously touch user-selected save paths', async () => {
  const source = fs.readFileSync(SETTINGS_SOURCE, 'utf8');
  assert.doesNotMatch(source, /\nensureLocalSavePaths\(\);\s*\n/);
  assert.match(source, /mkdir\(target, \{ recursive: true \}\)/);
  assert.match(source, /path_probe_timeout/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-settings-paths-'));
  try {
    const settings = {
      fileSavePath: path.join(directory, '中文用户', '文件保存'),
      canvasAutoSavePath: path.join(directory, '中文用户', '画布自动保存'),
      resourceLibraryPath: path.join(directory, '中文用户', '资源库'),
      themeTemplatePath: path.join(directory, '中文用户', '主题模板'),
    };
    const results = await settingsRouter.ensureLocalSavePaths(settings, { timeoutMs: 5_000 });
    assert.equal(results.length, 4);
    assert.equal(results.every((result) => result.ok), true);
    for (const value of Object.values(settings)) assert.equal(fs.statSync(value).isDirectory(), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a never-settling network path returns at its deadline and stops later probes', async () => {
  const calls = [];
  const startedAt = Date.now();
  const results = await settingsRouter.ensureLocalSavePaths({
    fileSavePath: '\\\\offline-host\\share\\first',
    canvasAutoSavePath: '\\\\offline-host\\share\\second',
    resourceLibraryPath: '\\\\offline-host\\share\\third',
    themeTemplatePath: '\\\\offline-host\\share\\fourth',
  }, {
    timeoutMs: 25,
    mkdir: (target) => {
      calls.push(target);
      return new Promise(() => {});
    },
  });
  const elapsedMs = Date.now() - startedAt;
  assert.deepEqual(results, [{
    field: 'fileSavePath',
    ok: false,
    timedOut: true,
    code: 'path_probe_timeout',
  }]);
  assert.deepEqual(calls, ['\\\\offline-host\\share\\first']);
  assert.ok(elapsedMs >= 10, `probe returned before its deadline: ${elapsedMs}ms`);
  assert.ok(elapsedMs < 500, `probe exceeded its bounded deadline: ${elapsedMs}ms`);
});

test('Electron paints a local shell before requiring the synchronous backend', () => {
  const source = fs.readFileSync(ELECTRON_SOURCE, 'utf8');
  const readyBlock = source.slice(source.indexOf('app.whenReady().then'), source.indexOf('app.on(\'window-all-closed\''));
  assert.ok(readyBlock.indexOf('createLogWindow();') >= 0);
  assert.ok(readyBlock.indexOf('await waitForStartupShellPaint();') > readyBlock.indexOf('createLogWindow();'));
  assert.ok(readyBlock.indexOf('backendStartPromise = startBackend();') > readyBlock.indexOf('await waitForStartupShellPaint();'));
  assert.match(source, /backendModule\?\.markFrontendInteractive\?\.\('electron-main-window-visible'\)/);
  assert.match(source, /startup-shell-visible/);
  assert.match(source, /ELECTRON_FRONTEND_LOAD_RETRY_ATTEMPTS/);
  assert.match(source, /development frontend unavailable; falling back to packaged backend UI/);
  assert.match(source, /const ELECTRON_MAIN_WINDOW_REVEAL_DEADLINE_MS = 15_000/);
  assert.match(source, /const ELECTRON_MAIN_WINDOW_LOAD_HARD_DEADLINE_MS = 60_000/);
  assert.match(source, /frontend-load-still-in-progress/);
  assert.match(source, /startup-shell-kept-visible/);
  assert.match(source, /frontend-load-hard-deadline/);
  assert.match(source, /showMainWindowStartupFailure/);
  assert.match(source, /main-window-local-error/);
  assert.match(source, /MAIN_WINDOW_STARTUP_RETRY_URL/);
  assert.match(source, /MAIN_WINDOW_STARTUP_BACKEND_URL/);
  assert.ok(source.includes("revealMainWindowWhenReady({ force: true, reason: 'ready-to-show-deadline' });"));
  const loadIndex = source.indexOf('const loadMainWindowUrl = () => mainWindow.loadURL(url);');
  const loadedIndex = source.indexOf('markMainFrontendLoaded(', loadIndex);
  assert.ok(loadIndex >= 0 && loadedIndex > loadIndex, 'frontend cannot be marked loaded before loadURL');
});

test('backend maintenance waits for frontend readiness or bounded fallback', () => {
  const source = fs.readFileSync(SERVER_SOURCE, 'utf8');
  const listenBlock = source.slice(source.indexOf('const server = app.listen'), source.indexOf("server.once('error'"));
  assert.doesNotMatch(listenBlock, /startFigmaBridgeOnAppStart\(console\)/);
  assert.doesNotMatch(listenBlock, /semanticPipeline\.refreshModelStates\(\)/);
  assert.doesNotMatch(listenBlock, /recoverPendingRuns\(\)/);
  assert.match(listenBlock, /STARTUP_MAINTENANCE_FALLBACK_MS/);

  const maintenanceBlock = source.slice(
    source.indexOf('function scheduleStartupMaintenance'),
    source.indexOf('function settleServerStart'),
  );
  assert.match(maintenanceBlock, /startFigmaBridgeOnAppStart\(console, \{/);
  assert.ok(maintenanceBlock.includes('startupSemanticModelRefreshPromise = Promise.resolve({ ok: true, deferred: true });'));
  assert.ok(maintenanceBlock.includes('startupRunRecoveryPromise = Promise.resolve({ ok: true, deferred: true });'));
  assert.ok(maintenanceBlock.includes('requestProjectStorageStartupBackup();'));
  assert.ok(maintenanceBlock.includes('const startupBackup = requestProjectStorageStartupBackup();'));
  assert.match(maintenanceBlock, /Promise\.allSettled\(\[[\s\S]*startupBackup,/);
  assert.match(source, /STORAGE_MAINTENANCE_RETRY_DELAYS_MS = \[1_000, 3_000, 10_000, 30_000\]/);
  assert.match(maintenanceBlock, /Promise\.allSettled/);
  assert.match(source, /markFrontendInteractive,/);
  assert.match(source, /startupReadinessSnapshot,/);
  assert.ok(source.includes('readiness: startupReadinessSnapshot()'));
  assert.match(source, /app\.post\('\/api\/status\/interactive'/);
  assert.match(source, /markFrontendInteractive\('renderer-http'\)/);
  assert.ok(
    source.indexOf("app.post('/api/status/interactive'") < source.indexOf("app.use('/api', (req, res) => sendApiError"),
    'renderer readiness route must be registered before the API 404 boundary',
  );
  assert.ok(maintenanceBlock.includes('signal: figmaStartupAbortController.signal'));
  const readinessBlock = source.slice(
    source.indexOf('function publishBackgroundMaintenanceReadiness'),
    source.indexOf('const figmaStartupAbortController'),
  );
  assert.ok(readinessBlock.includes('startupNonStorageMaintenanceSettled && startupStorageMaintenanceSettled'));
  assert.ok(readinessBlock.includes("complete ? 'background-ready' : 'background-deferred'"));
  assert.ok(maintenanceBlock.includes('startupNonStorageMaintenanceSettled = true;'));
  assert.ok(source.includes('startupStorageMaintenanceSettled = true;'));
  assert.ok(source.includes('cancelProjectStorageDeferredWork();'));
  assert.ok(source.includes('await waitForProjectStorageDeferredWork();'));
  assert.ok(source.includes('retryStorageDependentMaintenance(error);'));
  assert.doesNotMatch(source, /const collaborationGateway = getCollaborationGateway(config)/);
  assert.ok(source.includes('peekAssetPreviewPipeline();'));
  const shutdownBlock = source.slice(source.indexOf('function gracefulShutdown'), source.indexOf('function handleShutdownSignal'));
  assert.ok(
    shutdownBlock.indexOf('figmaStartupAbortController.abort();')
      < shutdownBlock.indexOf('shutdownFigmaBridgeLifecycle();'),
  );
  assert.match(shutdownBlock, /clearTimeout\(deferredStorageMaintenanceRetryTimer\)/);
  assert.match(shutdownBlock, /await figmaShutdown;/);
  assert.ok(source.includes('stopFigmaBridge({ timeoutMs: 2_000 })'));
});

test('database source retains strict clean-path predicates and active integrity checks', () => {
  const source = fs.readFileSync(PROJECT_DB_SOURCE, 'utf8');
  assert.match(source, /states\.primary\.size > 0n/);
  assert.match(source, /!states\.wal \|\| states\.wal\.size === 0n/);
  assert.match(source, /!states\.journal \|\| states\.journal\.size === 0n/);
  assert.match(source, /sameProjectDatabaseStartupSourceStates\(cleanCandidateBefore, cleanCandidateAfter\)/);
  assert.match(source, /this\.initializeDatabase\(\);[\s\S]*markStartupPhase\('active-initialized'\)/);
});
