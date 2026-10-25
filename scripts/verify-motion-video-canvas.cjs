'use strict';
// Full development App/Canvas + production routes/ledger/storage. Only the
// external Provider HTTP/media boundary is a deterministic fixture. No paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/motion-video-development-20261026');
const { withDeadline } = require('./history-acceptance-safety.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_MOTION_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-motion-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile'));
  app.on('window-all-closed', () => {}); app.disableHardwareAcceleration();
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const directory of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'motion-ui-fixture-key' }));
  const fixtureFile = path.join(scratch, 'fixture.mp4');
  require('node:child_process').execFileSync(require('../backend/src/providers/llmMedia').resolveBundledFfmpeg(),
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:r=12:d=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', fixtureFile], { windowsHide: true });
  const bytes = fs.readFileSync(fixtureFile), tasks = new Map();
  globalThis.motionFixture = { posts: [], gets: [], hold: false, fail: false, downloads: 0 };
  const persistFixture = () => fs.writeFileSync(path.join(scratch, 'fixture-stats.json'), JSON.stringify(globalThis.motionFixture));
  persistFixture();
  const transport = async (url, init = {}) => {
    assert.ok(String(url).startsWith('https://api.seedance.nz/v1/video/generations'));
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); globalThis.motionFixture.posts.push(body);
      const taskId = `motion-fixture-${tasks.size + 1}`; tasks.set(taskId, body); persistFixture();
      return new Response(JSON.stringify({ data: { id: taskId } }), { headers: { 'content-type': 'application/json' } });
    }
    const id = String(url).split('/').at(-1), body = tasks.get(id); assert.ok(body, 'Only original fixture tasks may be queried');
    globalThis.motionFixture.gets.push(id);
    const controlFile = path.join(scratch, 'fixture-control.json');
    if (fs.existsSync(controlFile)) Object.assign(globalThis.motionFixture, JSON.parse(fs.readFileSync(controlFile, 'utf8')));
    persistFixture();
    const status = globalThis.motionFixture.hold ? 'IN_PROGRESS' : globalThis.motionFixture.fail ? 'FAILURE' : 'SUCCESS';
    return new Response(JSON.stringify({ data: { status, data: { status: status === 'SUCCESS' ? 'succeeded' : status.toLowerCase(), model: body.model,
      content: { video_urls: ['https://motion.example/result.mp4', 'https://motion.example/result.mp4'] },
      storyboard: { scenes: [{ title: body.motion?.revision_instruction ? 'MAKE' : 'CREATE', duration: 15 }] },
      fallback_scenes: id.endsWith('1') ? ['scene-1'] : [] } } }), { headers: { 'content-type': 'application/json' } });
  };
  const provider = require('../backend/src/providers/seedanceNz');
  for (const name of ['submitMotionVideoTask', 'queryMotionVideoTask']) { const original = provider[name]; provider[name] = (request, key, options) => original(request, key, { ...options, fetchImpl: transport }); }
  const remote = require('../backend/src/utils/safeRemoteMediaFetch');
  remote.safeRemoteMediaFetch = async url => { assert.equal(String(url), 'https://motion.example/result.mp4'); globalThis.motionFixture.downloads++; return { buffer: bytes, contentType: 'video/mp4', finalUrl: String(url), status: 200 }; };
  const db = require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const model = 'zhenzhen/motion-video', node = (id, type, x, data) => ({ id, entityUid: crypto.randomUUID(), type, position: { x, y: 30 }, data });
  db.ensureCanvas(process.env.T8_MOTION_CANVAS_ID, { nodes: [
    node('description', 'text', -330, { text: 'HELLO CREATE T8', prompt: 'HELLO CREATE T8' }),
    node('animation', 'code-animation', 30, { model, prompt: 'local fallback', duration: 15, ratio: '16:9', resolution: '720p', status: 'idle' }),
    node('relay', 'relay', 530, {}), node('output', 'output', 820, {}), node('storyboard-relay', 'relay', 1100, {}),
  ], edges: [{ id: 'prompt-edge', source: 'description', target: 'animation', targetHandle: 'prompt' },
    { id: 'relay-edge', source: 'animation', sourceHandle: 'video', target: 'relay' }, { id: 'storyboard-edge', source: 'animation', sourceHandle: 'storyboard', target: 'storyboard-relay' }, { id: 'output-edge', source: 'relay', target: 'output' }] }, require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedMotionBackend = backend; globalThis.ownedMotionDatabase = db;
  await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_MOTION_FRONTEND).origin, `http://127.0.0.1:${process.env.PORT}`]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const u = new URL(details.url); done({ cancel: !allowed.has(u.origin) && !['data:', 'blob:', 'devtools:'].includes(u.protocol) }); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  globalThis.ownedMotionWindow = win; await win.loadURL(process.env.T8_MOTION_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1 -Mode MotionCanvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-motion-canvas-')), canvasId = 'motion-' + crypto.randomUUID();
  const authority = path.join(root, '.t8-collaboration-management-authority.json'), authorityBefore = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  const backendPort = await freePort(), collabPort = await freePort(), backendOrigin = `http://127.0.0.1:${backendPort}`;
  process.env.T8PC_DEV_BACKEND_ORIGIN = backendOrigin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  let vite, application, page, closed = false;
  const report = { passed: false, phase: 'initialize', errors: [], cases: [], budget, boundary: 'Full App/Canvas with real fresh SQLite/Run/assets; external HTTP is a deterministic fixture, not real model generation or installed-client acceptance.' };
  fs.mkdirSync(evidence, { recursive: true });
  const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); process.stdout.write(phase + '\n'); };
  const read = async url => { const r = await fetch(backendOrigin + url), body = await r.json(); assert.equal(body.success, true, url); return body.data; };
  const until = async (fn, label, timeout = 60000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(150); } throw Error(label); };
  const quit = async () => { if (!application || closed) return; const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {});
    await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedMotionWindow?.destroy(); await globalThis.ownedMotionBackend.gracefulShutdown('motion-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned Motion shutdown'); await close; closed = true; };
  try {
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin()],
      server: { host: '127.0.0.1', port: 0, strictPort: false, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming full App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial Motion App warmup');
    const env = { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_MOTION_CANVAS_ROOT: scratch, T8_MOTION_CANVAS_ID: canvasId,
      T8_MOTION_FRONTEND: `http://127.0.0.1:${vite.httpServer.address().port}`, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'),
      T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token,
      ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
    checkpoint('launching isolated full App'); application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 });
    application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    const node = page.locator('[data-code-animation-node]'); await node.waitFor({ timeout: 120000 });
    await node.getByRole('button', { name: '放大工作台', exact: true }).click(); const panel = page.locator('[data-motion-workbench]'); await panel.waitFor();
    checkpoint('actual workbench fields and generation');
    await panel.getByRole('combobox', { name: '模型', exact: true }).selectOption('zhenzhen/motion-video');
    await panel.getByRole('combobox', { name: '时长（秒）', exact: true }).selectOption('15');
    // Test-owned file telemetry avoids Electron's occasionally collected CDP
    // evaluation context. This never reads a user database or product settings.
    const stats = () => JSON.parse(fs.readFileSync(path.join(scratch, 'fixture-stats.json'), 'utf8'));
    const control = value => fs.writeFileSync(path.join(scratch, 'fixture-control.json'), JSON.stringify(value));
    const posts = () => stats().posts.length;
    const run = async (name = '生成动画', resumed = false) => { const before = await posts(), beforeGets = stats().gets.length; await panel.getByRole('button', { name, exact: true }).click();
      await until(async () => { const preflight = page.getByTestId('run-preflight-modal'); if (await preflight.isVisible()) { await preflight.getByRole('button', { name: '确认并继续', exact: true }).click(); return true; }
        return resumed ? stats().gets.length > beforeGets : await posts() > before; }, 'Run did not reach preflight/submission'); };
    await run();
    const saved = async () => (await read('/api/canvas/' + canvasId)).nodes.find(n => n.id === 'animation').data;
    await until(async () => (await saved()).motionVersions?.[0]?.assetIds?.length === 2, 'Version did not commit stable asset slots');
    const first = (await saved()).motionVersions[0]; assert.equal(first.request.prompt, 'HELLO CREATE T8'); assert.equal(await posts(), 1);
    assert.equal(first.result.fallbackScenes.length, 1); assert.deepEqual(first.videoUrls.length, 2);
    await until(async () => {
      const canvas = await read('/api/canvas/' + canvasId);
      const downstream = new Set(canvas.edges.filter(e => e.source === 'relay').map(e => e.target));
      return new Set(canvas.nodes.filter(n => downstream.has(n.id)).flatMap(n => (n.data.motionAssetRefs || []).map(ref => ref.assetId))).size === 2;
    }, 'Relay/Output lost ordered AssetRefs');
    report.cases.push('Actual generate → Run → materialization → CAS → stable version → Relay/Output, duplicate slots retained');
    await until(async () => {
      const canvas = await read('/api/canvas/' + canvasId), text = canvas.nodes.find(n => n.id === 'storyboard-relay').data;
      return /CREATE/.test(text.prompt || '') && !text.videoUrl && !text.motionAssetRefs?.length;
    }, 'Storyboard port did not transmit text separately');
    checkpoint('actual saved video playback');
    const player = panel.locator('video'); await player.scrollIntoViewIfNeeded();
    await player.dispatchEvent('pointerdown');
    await until(() => player.evaluate(v => Boolean(v.getAttribute('src'))), 'Visible player did not receive a source');
    await player.evaluate(v => v.play());
    await until(() => player.evaluate(v => v.readyState >= 2 && v.currentTime > 0), 'Saved asset did not play');
    assert.equal(await player.evaluate(v => Math.round(v.duration)), 1);
    await player.evaluate(v => v.pause()); report.cases.push('Saved CAS video decodes and plays in the real workbench player');
    await panel.getByRole('button', { name: '标记为已审阅', exact: true }).click();
    await until(async () => (await saved()).motionVersions[0].review === 'accepted', 'Review not persisted');
    await panel.getByRole('button', { name: '修改此版本', exact: true }).click();
    await panel.getByRole('textbox', { name: '修改要求', exact: true }).fill('Change CREATE to MAKE');
    await run(); await until(async () => (await saved()).motionVersions?.length === 2 && (await saved()).motionVersions[1].assetIds.length === 2, 'Revision not persisted');
    const second = (await saved()).motionVersions[1]; assert.equal(second.baseVersionId, first.id); assert.deepEqual(second.ancestorQuality, [first.id]); assert.deepEqual(second.result.fallbackScenes, []);
    assert.equal(await posts(), 2); report.cases.push('Selected-base revision creates new task/version, keeps base review and separate ancestor warning');
    assert.equal(await page.locator('[data-code-animation-node] video, [data-motion-workbench] video').count(), 1);
    await page.setViewportSize({ width: 620, height: 480 }); await panel.getByRole('button', { name: '关闭工作台', exact: true }).click({ trial: true });
    const bounds = await panel.locator('[role=dialog]').boundingBox(); assert.ok(bounds && bounds.height <= 480 && bounds.width <= 620);
    await page.screenshot({ path: path.join(evidence, 'workbench-narrow.png') });
    await page.setViewportSize({ width: 1360, height: 940 }); await panel.getByRole('button', { name: '关闭工作台', exact: true }).click();
    await page.reload(); await node.waitFor(); await node.getByRole('button', { name: '放大工作台', exact: true }).click(); await panel.waitFor();
    assert.equal(await panel.getByRole('combobox', { name: '版本', exact: true }).locator('option').count(), 2);
    await panel.getByRole('combobox', { name: '版本', exact: true }).selectOption(first.id);
    assert.ok((await panel.textContent()).includes('已审阅')); assert.equal(await posts(), 2);
    await panel.getByRole('button', { name: '刷新已保存版本', exact: true }).click();
    await until(async () => (await saved()).motionSelectedVersionId === first.id, 'Selection changed while history refreshed');
    report.cases.push('One player; short/narrow modal; save/reload retains versions, review and selected old version without POST');
    checkpoint('stop and resume original task');
    await panel.getByRole('button', { name: '以这些设置新建', exact: true }).click();
    control({ hold: true });
    await run(); await until(async () => Boolean((await saved()).motionPending), 'Pending identity not persisted');
    await panel.getByRole('button', { name: '停止等待', exact: true }).click();
    await until(async () => !(await panel.getByRole('button', { name: '停止等待', exact: true }).count()), 'Stop did not settle');
    assert.equal((await saved()).motionVersions.length, 2); assert.equal(await posts(), 3);
    await panel.getByRole('combobox', { name: '模型', exact: true }).selectOption('zhenzhen/motion-video-pro');
    control({ hold: false });
    await run('继续查询／保存原任务', true);
    await until(async () => (await saved()).motionVersions.length === 3 && !(await saved()).motionPending, 'Resume did not commit original task');
    assert.equal(await posts(), 3); report.cases.push('Stop retains old result; resume uses GET only and commits the accepted original task');
    assert.equal((await saved()).motionVersions[2].request.model, 'zhenzhen/motion-video');
    checkpoint('themes, locales and focus');
    const themes = await page.evaluate(async () => (await import('/src/theme/defaultTemplates.ts')).BUILT_IN_THEME_TEMPLATES.filter(theme => ['tech', 'pixel', 'rh'].includes(theme.visuals.style)).map(theme => ({ id: theme.id, visual: theme.visuals.style })));
    let combinations = 0;
    for (const theme of themes) for (const mode of ['light', 'dark']) for (const locale of ['zh-CN', 'en-US']) {
      await page.evaluate(async ({ id, mode, locale }) => { (await import('/src/stores/theme.ts')).useThemeStore.getState().setTemplate(id, mode); await (await import('/src/i18n/index.ts')).default.changeLanguage(locale); }, { id: theme.id, mode, locale });
      const inspected = await panel.locator('[role=dialog]').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, filter: getComputedStyle(el).filter, text: el.textContent }));
      assert.notEqual(inspected.bg, 'rgba(0, 0, 0, 0)'); assert.notEqual(inspected.bg, inspected.color); assert.equal(inspected.filter, 'none'); assert.doesNotMatch(inspected.text, /motionVideo:/); combinations++;
    }
    await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN'));
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
    assert.equal(await node.getByRole('button', { name: '放大工作台', exact: true }).evaluate(el => el === document.activeElement), true);
    await node.getByRole('button', { name: '放大工作台', exact: true }).click(); await panel.waitFor();
    const description = panel.getByRole('textbox', { name: '动画描述', exact: true });
    await description.focus(); await description.dispatchEvent('compositionstart');
    await page.keyboard.press('Escape'); assert.equal(await panel.isVisible(), true);
    await description.dispatchEvent('compositionend');
    report.cases.push(`${combinations} theme/mode/language combinations, Escape and focus return`);
    await page.screenshot({ path: path.join(evidence, 'workbench-complete.png') });
    await quit(); await vite.close(); vite = null;
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), authorityBefore);
    report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'failure.png') }); } catch {} checkpoint('failed: ' + report.phase); throw error; }
  finally {
    try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = String(error.message); }
    await vite?.close(); require('esbuild').stop(); await pause(1000);
    fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2));
    fs.mkdirSync(path.join(evidence, 'attempts'), { recursive: true }); fs.writeFileSync(path.join(evidence, 'attempts', path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || 'unknown.json')), JSON.stringify(report, null, 2));
    if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-motion-canvas-')) fs.rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write('Owned fixture retained: ' + scratch + '\n');
    if (!report.passed) process.exitCode = 1;
  }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { process.stderr.write(error.stack + '\n'); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
