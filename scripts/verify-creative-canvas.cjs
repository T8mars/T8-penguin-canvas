'use strict';
// Full App/Canvas on the normal Vite configuration and actual backend, with
// fresh storage, a hidden test window and no external/paid service access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/artcraft-ux-verification');
const { withDeadline } = require('./history-acceptance-safety.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function automationPackage(name) {
  try { return require.resolve(name); } catch (error) {
    if (!process.env.T8_ACCEPTANCE_NODE_MODULES) throw error;
    return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES, name));
  }
}
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_CREATIVE_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-creative-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile')); app.on('window-all-closed', () => {});
  app.disableHardwareAcceleration();
  require('./history-acceptance-safety.cjs').installRendererExitRecorder(app, record => fs.appendFileSync(path.join(scratch, 'renderer-exits.jsonl'), JSON.stringify(record) + '\n'));
  app.commandLine.appendSwitch('use-gl', 'angle'); app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const directory of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) fs.mkdirSync(directory, { recursive: true });
  const sharp = require('sharp'), original = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#37b8b0' } }).png().toBuffer();
  fs.writeFileSync(path.join(config.INPUT_DIR, 'original.png'), original);
  const database = require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database; globalThis.ownedCreativeDatabase = database;
  const canvasId = process.env.T8_CREATIVE_CANVAS_ID, url = '/files/input/original.png';
  database.ensureCanvas(canvasId, { nodes: [
    { id: 'materials', entityUid: crypto.randomUUID(), type: 'material-set', position: { x: 30, y: 30 }, data: { materialSetKind: 'image', materialSetItems: [{ id: 'slot-a', kind: 'image', url, name: 'Original A' }, { id: 'slot-b', kind: 'image', url, name: 'Repeated B' }], imageUrls: [url, url] } },
    { id: 'board', entityUid: crypto.randomUUID(), type: 'drawing-board', position: { x: 450, y: 30 }, data: { boardWidth: 160, boardHeight: 120, boardLayers: [], outputImageUrl: url, status: 'success' } },
  ], edges: [] }, require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedCreativeBackend = backend;
  await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([String(process.env.PORT), new URL(process.env.T8_CREATIVE_FRONTEND).port]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const url = new URL(details.url); const local = ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && allowed.has(url.port); done({ cancel: !local && !['data:', 'blob:', 'devtools:'].includes(url.protocol) }); });
  const window = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  globalThis.ownedCreativeWindow = window; await window.loadURL(process.env.T8_CREATIVE_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1 -Mode CreativeCanvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(automationPackage('playwright')), loader = path.join(path.dirname(automationPackage('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creative-canvas-')), canvasId = 'creative-' + crypto.randomUUID();
  const authority = path.join(root, '.t8-collaboration-management-authority.json'); assert.ok(fs.existsSync(authority), 'Do not create shared authority during isolated verification');
  const authorityBefore = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  const backendPort = await freePort(), collabPort = await freePort(), backendOrigin = `http://127.0.0.1:${backendPort}`;
  process.env.T8PC_DEV_BACKEND_ORIGIN = backendOrigin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  let vite, application, page, closed = false;
  const report = { passed: false, phase: 'initialize', errors: [], cases: [], budget, runnerReceipt: process.env.T8_ACCEPTANCE_RUNNER_RECEIPT, providerRequests: 0,
    boundary: 'full development App/Canvas, actual backend and fresh SQLite; hidden software renderer, not installed Electron main, physical GPU, live RH or real-user large-scene acceptance' };
  fs.mkdirSync(evidence, { recursive: true });
  const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'creative-canvas-ui.json'), JSON.stringify(report, null, 2)); process.stdout.write(phase + '\n'); };
  const read = async url => { const response = await fetch(backendOrigin + url); assert.equal(response.status, 200, url); const body = await response.json(); assert.equal(body.success, true); return body.data; };
  const until = async (check, label, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(100); } throw Error(label); };
  const quit = async () => { if (!application || closed) return; const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {});
    await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedCreativeWindow?.destroy(); await globalThis.ownedCreativeBackend.gracefulShutdown('creative-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned backend shutdown'); await close; closed = true; };
  try {
    const { createServer } = await import('vite'); const { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin(), {
      name: 'owned-creative-provider-boundary', configureServer(server) { server.middlewares.use((req, res, next) => { if (/^\/api\/(?:proxy|runninghub|llm|image-generation)(?:\/|$)/.test(req.url || '')) { report.providerRequests++; res.statusCode = 500; res.end('No Provider calls allowed'); } else next(); }); },
    }], server: { host: '127.0.0.1', port: 0, strictPort: false, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming App/Canvas'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial development warmup');
    const frontend = `http://127.0.0.1:${vite.httpServer.address().port}`, env = { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort),
      T8_CREATIVE_CANVAS_ROOT: scratch, T8_CREATIVE_CANVAS_ID: canvasId, T8_CREATIVE_FRONTEND: frontend, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'),
      T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token,
      ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
    checkpoint('launching hidden full App'); application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 });
    application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), async button => button.click());
    await until(() => page.locator('.t8-sidebar-node[data-canvas-node-ready=true]').count().then(count => count > 0), 'Canvas did not become interactive', 120000);
    assert.equal(await application.evaluate(() => globalThis.ownedCreativeWindow.isVisible()), false);
    checkpoint('actual sidebar create'); await page.locator('.t8-sidebar-search-row input').fill('3D世界');
    await page.locator('.t8-sidebar-node').filter({ hasText: '3D世界' }).click(); const world = page.locator('[data-world-scene-node]'); await world.waitFor();
    await page.locator('.t8-sidebar-search-row input').fill('');
    const scenePath = path.join(scratch, 'own-scene.splat'); fs.writeFileSync(scenePath, require('./lib/gaussian-fixtures.cjs').gaussianFixture('splat'));
    await world.locator('input[type=file]').setInputFiles(scenePath);
    await until(() => world.getByRole('button', { name: '输出当前构图', exact: true }).isEnabled(), 'Imported scene did not become ready');
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes.some(node => node.type === 'world-scene' && node.data.sourceAssetId), 'Scene upload was not autosaved');
    await page.locator('[data-canvas-floating-ui=control-tools-toggle]').click(); await page.locator('[data-workflow-doctor-enabled=false]').click();
    const assetId = (await read('/api/canvas/' + canvasId)).nodes.find(node => node.type === 'world-scene').data.sourceAssetId;
    await application.evaluate((_electron, id) => { const db = globalThis.ownedCreativeDatabase, asset = db.getAsset(id); db.upsertAsset({ ...asset, availability: 'missing' }); }, assetId);
    checkpoint('original Canvas missing-asset preflight cancel'); await world.getByRole('button', { name: '输出当前构图', exact: true }).click();
    const preflight = page.getByTestId('run-preflight-modal'); await preflight.waitFor(); await preflight.getByRole('button', { name: '取消', exact: true }).click(); await preflight.waitFor({ state: 'hidden' });
    assert.equal((await read('/api/project-runs?canvasId=' + encodeURIComponent(canvasId))).length, 0);
    await application.evaluate((_electron, id) => { const db = globalThis.ownedCreativeDatabase, asset = db.getAsset(id); db.upsertAsset({ ...asset, availability: 'available' }); }, assetId);
    await pause(2100); // Existing Canvas cancelled-request cooldown, not a new product delay.
    checkpoint('original Canvas valid-source preflight'); await world.getByRole('button', { name: '输出当前构图', exact: true }).click();
    await until(async () => { const runs = await read('/api/project-runs?canvasId=' + encodeURIComponent(canvasId)); return runs.length === 1 && runs[0].status === 'succeeded'; }, 'Canvas Run did not finish');
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes.some(node => node.type === 'world-scene' && node.data.imageUrl), 'Full App autosave missed world output');
    report.cases.push('sidebar creation', 'actual enabled-doctor missing-asset block/cancel', 'valid local capture without extra confirmation', 'one succeeded Run', 'actual App autosave');
    checkpoint('moodboard actual App persistence');
    // Locate the off-center original node with the normal fit-view control.
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('z');
    const materials = page.locator('.react-flow__node[data-id=materials]'); await materials.getByRole('button', { name: '素材灵感板', exact: true }).click();
    const moodboard = page.locator('[data-material-moodboard]'); await moodboard.waitFor(); await moodboard.locator('[data-moodboard-card=slot-a]').click();
    await moodboard.getByRole('spinbutton', { name: '旋转', exact: true }).fill('35');
    await until(() => moodboard.locator('[data-moodboard-card=slot-a]').evaluate(el => el.style.transform === 'rotate(35deg)'), 'Real input did not apply moodboard rotation');
    await moodboard.getByRole('spinbutton', { name: '旋转', exact: true }).press('ArrowUp');
    await until(() => moodboard.locator('[data-moodboard-card=slot-a]').evaluate(el => el.style.transform === 'rotate(40deg)'), 'Dialog keyboard was swallowed');
    await moodboard.getByRole('spinbutton', { name: '旋转', exact: true }).press('ArrowDown');
    await moodboard.getByRole('button', { name: '保存布局', exact: true }).click(); await moodboard.waitFor({ state: 'hidden' });
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes.find(node => node.id === 'materials').data.materialMoodboard?.cards['slot-a'].rotation === 35, 'App autosave missed moodboard layout');
    checkpoint('themes and narrow viewport');
    await materials.getByRole('button', { name: '素材灵感板', exact: true }).click(); await moodboard.waitFor();
    const themes = await page.evaluate(async () => (await import('/src/theme/defaultTemplates.ts')).BUILT_IN_THEME_TEMPLATES.map(theme => ({ id: theme.id, visual: theme.visuals.style })));
    report.themeChecks = [];
    for (const theme of themes) for (const mode of ['light', 'dark']) {
      await page.evaluate(async ({ id, mode }) => (await import('/src/stores/theme.ts')).useThemeStore.getState().setTemplate(id, mode), { id: theme.id, mode });
      await until(() => page.locator('html').getAttribute('data-theme-template').then(id => id === theme.id), 'Theme not applied');
      const style = await moodboard.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, width: el.getBoundingClientRect().width })); assert.notEqual(style.background, 'rgba(0, 0, 0, 0)'); assert.notEqual(style.color, style.background); report.themeChecks.push({ id: theme.id, mode, ...style });
    }
    await page.setViewportSize({ width: 800, height: 600 });
    await moodboard.getByRole('button', { name: '保存布局', exact: true }).click({ trial: true }); await moodboard.getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 1360, height: 900 });
    const tech = themes.find(theme => theme.visual === 'tech');
    await page.evaluate(async id => (await import('/src/stores/theme.ts')).useThemeStore.getState().setTemplate(id, 'light'), tech.id);
    await until(() => page.locator('html').getAttribute('data-theme-template').then(id => id === tech.id), 'Tech theme not applied');
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('z');
    await page.locator('.react-flow__node[data-id=board]').getByRole('button', { name: '编辑输出版本', exact: true }).click();
    const editor = page.locator('.img-edit-modal'); await editor.waitFor(); await page.setViewportSize({ width: 800, height: 600 });
    await editor.getByRole('button', { name: '应用裁剪', exact: true }).click({ trial: true });
    const closeBounds = await editor.getByTitle('关闭 (ESC)', { exact: true }).boundingBox(); assert.ok(closeBounds && closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= 800 && closeBounds.y >= 0, 'Editor close is clipped on narrow viewport');
    await editor.getByRole('button', { name: '应用裁剪', exact: true }).click();
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes.filter(node => node.data.imageEditLineage?.operation === 'crop').length === 1, 'Actual editor output was not persisted under inert Canvas');
    assert.equal(await editor.locator('[data-image-edit-versions] select option').count(), 2);
    await page.keyboard.press('3'); await editor.getByRole('button', { name: '应用画板', exact: true }).waitFor(); await page.keyboard.press('1');
    await page.keyboard.press('Escape'); await editor.waitFor({ state: 'hidden' }); await page.setViewportSize({ width: 1360, height: 900 });
    report.cases.push('full App theme application', '800x600 modal footer and close access', 'actual modal crop output autosave');
    checkpoint('actual page reload'); await page.reload(); await until(() => page.locator('.t8-sidebar-node[data-canvas-node-ready=true]').count().then(count => count > 0), 'Reload did not restore interactive Canvas');
    const document = await read('/api/canvas/' + canvasId); assert.equal(document.nodes.find(node => node.id === 'materials').data.materialMoodboard.cards['slot-a'].rotation, 35); assert.ok(document.nodes.find(node => node.type === 'world-scene').data.imageUrl);
    checkpoint('closed-view capture through original Canvas'); const restoredWorldId = document.nodes.find(node => node.type === 'world-scene').id;
    assert.equal(await page.locator('[data-world-scene-viewer]').count(), 0, 'Reload should not allocate an unopened scene renderer');
    await page.evaluate(async id => (await import('/src/utils/canvasRunRequest.ts')).requestCanvasNodeRun(id), restoredWorldId);
    await until(async () => { const runs = await read('/api/project-runs?canvasId=' + encodeURIComponent(canvasId)); return runs.length === 2 && runs.every(run => run.status === 'succeeded'); }, 'Closed viewer did not render its authorized Run');
    await until(() => page.locator('[data-world-scene-viewer]').count().then(count => count === 0), 'Closed-view capture kept GPU resources mounted'); report.cases.push('authorized closed-view capture and release');
    checkpoint('existing RH action while editor is open');
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('z');
    await page.locator('.react-flow__node-output img').first().dblclick(); await editor.waitFor();
    await editor.getByRole('button', { name: 'RH抠图', exact: true }).click();
    await preflight.waitFor(); assert.match(await preflight.textContent(), /RH|RunningHub/);
    await preflight.getByRole('button', { name: '取消', exact: true }).click(); await preflight.waitFor({ state: 'hidden' });
    assert.equal((await read('/api/project-runs?canvasId=' + encodeURIComponent(canvasId))).length, 2, 'Missing-key secondary action cannot create a paid Run');
    await page.keyboard.press('Escape'); await editor.waitFor({ state: 'hidden' }); report.cases.push('existing modal RH action reaches original missing-key preflight without submission');
    await page.screenshot({ path: path.join(evidence, 'creative-canvas.png') }); report.cases.push('full App reload'); assert.equal(report.providerRequests, 0); assert.deepEqual(report.errors, []);
    await quit(); await vite.close(); vite = null; assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), authorityBefore);
    report.passed = true; checkpoint('passed');
  } catch (error) {
    report.failure = String(error.message).slice(0, 1200);
    try { const saved = await read('/api/canvas/' + canvasId); report.savedMoodboard = saved.nodes.find(node => node.id === 'materials')?.data.materialMoodboard || null; } catch { /* No backend yet, or already closed. */ }
    if (page && !page.isClosed()) try { report.diagnostic = await withDeadline(() => page.evaluate(async () => ({ alerts: [...document.querySelectorAll('[role=alert]')].map(el => el.textContent?.slice(0, 500)).slice(0, 8),
      world: document.querySelector('[data-world-scene-node]')?.textContent?.slice(0, 1000), logs: (await import('/src/stores/logs.ts')).useLogStore.getState().entries.slice(-8).map(entry => ({ level: entry.level, message: entry.message.slice(0, 500) })) })), 5000, 'owned failure diagnostic'); await withDeadline(() => page.screenshot({ path: path.join(evidence, 'creative-canvas-failure.png') }), 5000, 'owned failure screenshot'); } catch { report.diagnosticUnavailable = true; }
    checkpoint('failed: ' + report.phase); throw error;
  }
  finally {
    try { await quit(); }
    catch (error) {
      report.passed = false; report.shutdownFailure = String(error.message).slice(0, 300);
      // Dispose only this helper's exact ChildProcess, never a name/PID search.
      const child = application?.process(); if (child && child.exitCode === null) child.kill();
    } finally { await vite?.close(); }
    const nativeFile = path.join(scratch, 'renderer-exits.jsonl');
    if (fs.existsSync(nativeFile) && fs.statSync(nativeFile).size <= 16384) report.nativeRendererExits = fs.readFileSync(nativeFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    fs.writeFileSync(path.join(evidence, 'creative-canvas-ui.json'), JSON.stringify(report, null, 2));
    const attempt = path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || 'unknown.json'); fs.mkdirSync(path.join(evidence, 'canvas-attempts'), { recursive: true });
    fs.writeFileSync(path.join(evidence, 'canvas-attempts', attempt), JSON.stringify(report, null, 2));
    if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-creative-canvas-')) fs.rmSync(scratch, { recursive: true, force: true }); else process.stderr.write('Owned fixture retained: ' + scratch + '\n');
  }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { process.stderr.write(error.stack + '\n'); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
