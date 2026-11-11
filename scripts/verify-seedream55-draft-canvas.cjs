'use strict';
// Real App/Canvas, fresh TEMP database, production routes and ledger. Only the
// external Provider boundary is replaced; this script never makes paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/seedream55-draft-20261111');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const { withDeadline } = require('./history-acceptance-safety.cjs');
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_SD55_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-sd55-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const dir of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'tripo-fixture-key' }));
  const picture = await require('sharp')({ create: { width: 128, height: 128, channels: 3, background: 'blue' } }).png().toBuffer();
  fs.writeFileSync(path.join(scratch, 'view.png'), picture);
  const videoCase = JSON.parse(fs.readFileSync(path.join(evidence, 'domestic-draft-source-private-local.json'), 'utf8'));
  const video = fs.readFileSync(videoCase.files[0]);
  const alpha = await require('sharp')({ create: { width: 48, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: .5 } } }).png().toBuffer();
  const tasks = new Map(), stats = { posts: [], uploads: 0, gets: 0, downloads: 0 };
  const persist = () => fs.writeFileSync(path.join(scratch, 'fixture-stats.json'), JSON.stringify(stats)); persist();
  const transport = async (url, init = {}) => {
    assert.ok(String(url).startsWith('https://api.seedance.nz/'));
    if (String(url).endsWith('/v1/files/upload')) { stats.uploads++; persist(); return Response.json({ url: 'https://sd55.example/input.png' }); }
    if (init.method === 'POST') { const body = JSON.parse(init.body), id = 'fixture-' + (tasks.size + 1); tasks.set(id, body); stats.posts.push(body); persist(); return Response.json({ task_id: id }); }
    const id = String(url).split('/').at(-1), body = tasks.get(id); assert.ok(body); stats.gets++; persist();
    if (String(url).includes('/v1/videos/')) return Response.json({ id, model: body.model, status: 'completed', metadata: { url: 'https://sd55.example/' + id + '.mp4', ...(body.metadata?.draft ? { draft_task_id: id } : {}), ...(body.metadata?.return_last_frame ? { last_frame_url: 'https://sd55.example/layer.png' } : {}) } });
    const urls = body.model.endsWith('decomposition') ? ['https://sd55.example/base.png', 'https://sd55.example/layer.png', 'https://sd55.example/layer.png'] : ['https://sd55.example/result.png'];
    return Response.json({ data: { status: 'SUCCESS', model: body.model, data: { content: { image_urls: urls, ...(body.model.endsWith('decomposition') ? { layers: urls.map((url, i) => ({ url, name: 'layer-' + i, zindex: i })) } : {}) } } } });
  };
  const provider = require('../backend/src/providers/seedanceNz');
  for (const name of ['submitImageTask', 'queryImageTask', 'submitTask', 'queryTask']) { const original = provider[name]; provider[name] = (request, key, options) => original(request, key, { ...options, fetchImpl: transport, uploadIntervalMs: 0 }); }
  require('../backend/src/utils/safeRemoteMediaFetch').safeRemoteMediaFetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://sd55.example/')); assert.equal(options.trustedProviderOutput, true); stats.downloads++; persist();
    const isVideo = String(url).endsWith('.mp4'), buffer = isVideo ? video : String(url).includes('layer') || String(url).includes('result') ? alpha : picture;
    return { buffer, contentType: isVideo ? 'video/mp4' : 'image/png', finalUrl: String(url), status: 200 };
  };
  const db = require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const node = (id, type, data, x) => ({ id, entityUid: crypto.randomUUID(), type, position: { x, y: 30 }, data });
  const image = (extra = {}) => ({ model: 'seedream-v5-pro', seedreamApiSource: 'seedance-nz', imageBuiltinSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '', seedreamNzModelFamily: 'domestic-55', seedreamNzResolution: '1k', seedreamOutputFormat: 'png', prompt: 'A blue robot', seedream55Background: 'transparent', imageOnlyOutput: true, reuseResult: false, ...extra });
  const videoData = (model, extra = {}) => ({ mainId: 'seedance-2.5', model, apiModel: model, videoBuiltinSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '', ratio: '16:9', duration: 4, resolution: '480p', generateAudio: true, returnLastFrame: false, prompt: 'A robot waves', reuseResult: false, ...extra });
  db.ensureCanvas(process.env.T8_SD55_CANVAS_ID, { nodes: [
    node('image', 'upload', { uploadType: 'image', lockedUploadType: 'image' }, -430),
    node('generate', 'image', image(), 0), node('edit', 'image', image({ seedream55Background: 'opaque' }), 430),
    node('layers', 'image', image({ model: 'seedream-layer-decomposition', apiModel: 'seedream-v5.5-layer-decomposition', seedreamLayerResolution: 'auto', seedream55MaxImages: 3, seedream55TextRecognition: true }), 860),
    node('draft', 'video', videoData('seedance-2.5-standard-t2v', { seedance25Draft: true }), 1290),
    node('enhance', 'video', videoData('seedance-2.5-standard-draft-to-video', { prompt: '' }), 1720),
    node('global', 'video', videoData('seedance-2.5-global-standard-draft-to-video', { seedance25DraftTaskId: 'fixture-global-draft', prompt: '' }), 2150),
    node('relay', 'relay', {}, 1420), node('output', 'output', {}, 1560),
  ], edges: [['image', 'edit'], ['image', 'layers'], ['draft', 'relay'], ['relay', 'output'], ['output', 'enhance']].map(([source, target], i) => ({ id: 'edge-' + i, source, target })) }, require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedSd55Backend = backend; await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_SD55_FRONTEND).origin, 'http://127.0.0.1:' + process.env.PORT]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const u = new URL(details.url); done({ cancel: !allowed.has(u.origin) && !['data:', 'blob:', 'devtools:'].includes(u.protocol) }); });
  globalThis.ownedSd55Downloads = []; fs.mkdirSync(path.join(scratch, 'downloads'));
  session.defaultSession.on('will-download', (_event, item) => { const file = path.join(scratch, 'downloads', crypto.randomUUID()); item.setSavePath(file); item.once('done', (_event, state) => globalThis.ownedSd55Downloads.push({ file, state })); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); globalThis.ownedSd55Window = win; await win.loadURL(process.env.T8_SD55_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use the low-load runner, Mode Seedream55Canvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-sd55-canvas-')), canvasId = 'tripo-' + crypto.randomUUID();
  const port = await freePort(), collabPort = await freePort(), origin = 'http://127.0.0.1:' + port;
  process.env.T8PC_DEV_BACKEND_ORIGIN = origin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  const authority = path.join(root, '.t8-collaboration-management-authority.json'), before = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  let vite, application, page, closed = false;
  const report = { passed: false, cases: [], errors: [], budget, boundary: 'Actual App/Canvas with fresh TEMP SQLite and production routes/ledger; deterministic Provider fixture, no paid calls, no installed-client evidence.' };
  fs.mkdirSync(evidence, { recursive: true }); const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); console.log(phase); };
  const read = async url => { const r = await fetch(origin + url), body = await r.json(); assert.equal(body.success, true, url); return body.data; };
  const saved = async id => (await read('/api/canvas/' + canvasId)).nodes.find(n => n.id === id).data;
  const until = async (fn, label, timeout = 90000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(200); } throw Error(label); };
  const quit = async () => { if (!application || closed) return; const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {}); await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedSd55Window?.destroy(); await globalThis.ownedSd55Backend.gracefulShutdown('tripo-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned Sd55 shutdown'); await close; closed = true; };
  try {
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin()], server: { host: '127.0.0.1', port: 0, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial Sd55 App warmup');
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_SD55_CANVAS_ROOT: scratch, T8_SD55_CANVAS_ID: canvasId, T8_SD55_FRONTEND: 'http://127.0.0.1:' + vite.httpServer.address().port, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'), T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token, ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE; delete env.SEEDANCE_NZ_API_KEY;
    application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 }); application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    const n = id => page.locator('.react-flow__node[data-id="' + id + '"]'); await n('generate').waitFor({ timeout: 120000 }); await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN'));
    const stats = () => JSON.parse(fs.readFileSync(path.join(scratch, 'fixture-stats.json'), 'utf8'));
    await n('generate').locator('select').filter({ has: page.locator('option[value="domestic-55"]') }).waitFor();
    await n('image').locator('input[type=file]').first().setInputFiles(path.join(scratch, 'view.png')); await until(async () => Boolean((await saved('image')).imageUrl), 'Image upload not persisted');
    await page.evaluate(() => { window.__tripoRequests = []; window.addEventListener('t8:canvas-node-run-request', event => { const d = event.detail, record = { nodeId: d.nodeId }; window.__tripoRequests.push(record); const prior = d.onSettled; d.onSettled = outcome => { record.outcome = outcome; prior?.(outcome); }; }, { capture: true }); });
    const run = async (id, name) => {
      console.log('running ' + id); await page.evaluate(() => document.activeElement?.blur()); await page.locator('.react-flow__pane').first().click({ position: { x: 30, y: 180 } }); await page.keyboard.press('z'); await pause(3000);
      const count = stats().posts.length, previous = (await saved(id)).taskId, index = await page.evaluate(() => window.__tripoRequests.length); await n(id).getByRole('button', { name, exact: true }).click();
      await until(async () => { const modal = page.getByTestId('run-preflight-modal'); if (await modal.isVisible()) { await modal.getByRole('button', { name: '确认并继续', exact: true }).click(); return false; } const r = await page.evaluate(i => window.__tripoRequests[i], index); if (r?.outcome?.accepted === false) throw Error(r.outcome.error); return r?.outcome?.accepted === true; }, 'Run not accepted: ' + id, 120000);
      await until(async () => { const data = await saved(id); if (data.taskId !== previous && ['error','failed'].includes(data.status)) throw Error(data.error); return ['success','completed'].includes(data.status) && data.taskId !== previous && stats().posts.length === count + 1; }, 'Run did not complete: ' + id);
      await pause(1000);
    };
    checkpoint('six 5.5 image identities and complete ordered layers');
    for (const [family, prefix] of [['domestic-55','seedream-v5.5'],['overseas-55','dola-seedream-5.5']]) {
      for (const id of ['generate','edit']) { await n(id).locator('select').filter({ has: page.locator('option[value="domestic-55"]') }).selectOption(family); await run(id, '生成'); const request = stats().posts.at(-1); assert.equal(request.model, prefix + (id === 'edit' ? '-i2i' : '-t2i')); assert.equal(request.metadata.background, id === 'edit' ? 'opaque' : 'transparent'); assert.equal(request.metadata.output_format, 'png'); }
      await n('layers').locator('select').filter({ has: page.locator('option[value="seedream-v5.5-layer-decomposition"]') }).selectOption(prefix + '-layer-decomposition'); await run('layers', '生成'); const request = stats().posts.at(-1), data = await saved('layers'); assert.equal(request.metadata.max_images, 3); assert.equal(request.metadata.text_recognition, true); assert.equal(request.metadata.background, undefined); assert.equal(data.imageUrls.length, 3); assert.equal(data.seedreamLayers.length, 3); assert.deepEqual(data.seedreamLayers.map(layer => layer.url), data.imageUrls);
    }
    report.cases.push('Six 5.5 identities, transparent PNG controls, ordered three-layer outputs including duplicate remote slots, aligned metadata and parameter isolation');
    checkpoint('draft creation and domestic/global ID-only enhancement'); await run('draft', '生成视频'); const draft = await saved('draft'); assert.equal(draft.seedance25DraftTaskIdResult, draft.taskId); assert.equal(stats().posts.at(-1).metadata.draft, true); assert.equal(stats().posts.at(-1).metadata.resolution, '480p');
    for (const id of ['enhance','global']) { if (id === 'global') await n(id).getByRole('checkbox', { name: '返回尾帧', exact: true }).check(); await run(id, '生成视频'); const request = stats().posts.at(-1); assert.deepEqual(Object.keys(request).sort(), ['metadata','model']); assert.deepEqual(Object.keys(request.metadata).sort(), ['draft_task_id','output_format','return_last_frame']); assert.equal(request.metadata.draft_task_id, id === 'enhance' ? draft.taskId : 'fixture-global-draft'); assert.equal(await n(id).locator('textarea').count(), 0); }
    assert.match((await saved('global')).lastFrameUrl, /\.png$/);
    report.cases.push('480P opt-in draft, Relay/Output automatic completed ID connection, both regions exact ID-only enhancement, prompt and unrelated controls hidden');
    const count = await application.evaluate(() => globalThis.ownedSd55Downloads.length); await n('generate').getByRole('link', { name: '保存原文件', exact: true }).click(); await until(async () => await application.evaluate(() => globalThis.ownedSd55Downloads.length) > count, 'Original download missing');
    await page.reload(); await n('generate').waitFor({ timeout: 120000 }); assert.equal((await saved('generate')).seedreamNzModelFamily, 'overseas-55'); assert.equal((await saved('layers')).imageUrls.length, 3); assert.equal((await saved('draft')).seedance25DraftTaskIdResult, draft.taskId);
    for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) { await page.evaluate(async ({theme,language}) => { (await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(theme); await (await import('/src/i18n/index.ts')).default.changeLanguage(language); }, {theme,language}); assert.doesNotMatch(await n('layers').innerText(), /seedream55:/); assert.doesNotMatch(await n('enhance').innerText(), /seedream55:/); }
    report.cases.push('Original download, refresh persistence, bilingual light/dark controls');
    report.stats = { posts: stats().posts.length, uploads: stats().uploads, gets: stats().gets, downloads: stats().downloads }; assert.equal(report.stats.posts, 9); await page.screenshot({ path: path.join(evidence, 'canvas-ui.png') }); await quit(); await vite.close(); vite = null; assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), before); report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'canvas-failure.png') }); } catch {} checkpoint('failed'); throw error; }
  finally { try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = error.message; } await vite?.close(); require('esbuild').stop(); await pause(1000); fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-sd55-canvas-')) fs.rmSync(scratch, { recursive: true, force: true }); else console.error('Owned fixture retained: ' + scratch); if (!report.passed) process.exitCode = 1; }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { console.error(error.stack); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
