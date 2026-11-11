'use strict';
// Real App/Canvas, fresh TEMP database, production routes and ledger. Only the
// external Provider boundary is replaced; this script never makes paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/tripo-20261111');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const { withDeadline } = require('./history-acceptance-safety.cjs');
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_TRIPO_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-tripo-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const dir of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'tripo-fixture-key' }));
  const picture = await require('sharp')({ create: { width: 128, height: 128, channels: 3, background: 'blue' } }).png().toBuffer();
  fs.writeFileSync(path.join(scratch, 'view.png'), picture);
  const live = JSON.parse(fs.readFileSync(path.join(evidence, 'segment-private-local.json'), 'utf8'));
  const glb = fs.readFileSync(path.join(evidence, 'outputs', path.basename(live.modelUrl)));
  const zip = new (require('yazl').ZipFile)(); zip.addBuffer(glb, 'model.glb'); zip.end(); const chunks = []; for await (const chunk of zip.outputStream) chunks.push(chunk); const archive = Buffer.concat(chunks);
  const tasks = new Map(), stats = { posts: [], uploads: 0, gets: 0, downloads: 0 };
  const persist = () => fs.writeFileSync(path.join(scratch, 'fixture-stats.json'), JSON.stringify(stats)); persist();
  const transport = async (url, init = {}) => {
    assert.ok(String(url).startsWith('https://api.seedance.nz/'));
    if (String(url).endsWith('/v1/files/upload')) { stats.uploads++; persist(); return Response.json({ url: 'https://tripo.example/uploaded.glb' }); }
    if (init.method === 'POST') { const body = JSON.parse(init.body), id = 'platform-' + (tasks.size + 1); tasks.set(id, body); stats.posts.push(body); persist(); return Response.json({ task_id: id }); }
    const id = String(url).split('/').at(-1), body = tasks.get(id); assert.ok(body); stats.gets++; persist();
    const type = body.model === 'tripo-convert' ? 'zip' : body.model === 'tripo-image-to-splat' ? 'splat' : 'glb';
    const files = [{ name: 'modelUrl', type, url: 'https://tripo.example/' + id + '.' + type }];
    if (type === 'glb') files.push({ name: 'renderedImageUrl', type: 'png', url: 'https://tripo.example/' + id + '.png' });
    return Response.json({ data: { status: 'SUCCESS', model: body.model, data: { content: { files, file_url: files[0].url, file_urls: files.map(f => f.url), tripo_task_id: 'native-' + id } } } });
  };
  const provider = require('../backend/src/providers/seedanceNz');
  for (const name of ['submitHunyuan3dTask', 'queryHunyuan3dTask']) { const original = provider[name]; provider[name] = (request, key, options) => original(request, key, { ...options, fetchImpl: transport, uploadIntervalMs: 0 }); }
  require('../backend/src/utils/safeRemoteMediaFetch').safeRemoteMediaFetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://tripo.example/')); assert.equal(options.trustedProviderOutput, true); stats.downloads++; persist();
    const ext = String(url).split('.').at(-1), buffer = { glb, png: picture, zip: archive, splat: Buffer.alloc(64, 1) }[ext]; assert.ok(buffer);
    return { buffer, contentType: ext === 'png' ? 'image/png' : 'application/octet-stream', finalUrl: String(url), status: 200 };
  };
  const db = require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const node = (id, type, data, x) => ({ id, entityUid: crypto.randomUUID(), type, position: { x, y: 30 }, data });
  db.ensureCanvas(process.env.T8_TRIPO_CANVAS_ID, { nodes: [
    node('image', 'upload', { uploadType: 'image', lockedUploadType: 'image' }, -430),
    node('generate', 'model-3d', { model: 'tripo-p-p1-text-to-3d', threeDTab: 'tripo-3d', prompt: 'A robot', tripo_texture: 'false', tripo_pbr: 'false', tripo_face_limit: 1000, reuseResult: false }, 0),
    node('segment', 'model-3d', { model: 'tripo-mesh-segment-v1', threeDTab: 'tripo-3d', reuseResult: false }, 430),
    node('complete', 'model-3d', { model: 'tripo-mesh-complete', threeDTab: 'tripo-3d', tripo_completion_mode: 'quick_cap', reuseResult: false }, 860),
    node('convert', 'model-3d', { model: 'tripo-convert', threeDTab: 'tripo-3d', reuseResult: false }, 1290),
    node('splat', 'model-3d', { model: 'tripo-image-to-splat', threeDTab: 'tripo-3d', reuseResult: false }, 1720),
    node('relay', 'relay', {}, 180), node('output', 'output', {}, 650),
  ], edges: [['generate', 'relay'], ['relay', 'segment'], ['segment', 'output'], ['output', 'complete'], ['generate', 'convert'], ['image', 'splat']].map(([source, target], i) => ({ id: 'edge-' + i, source, target })) }, require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedTripoBackend = backend; await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_TRIPO_FRONTEND).origin, 'http://127.0.0.1:' + process.env.PORT]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const u = new URL(details.url); done({ cancel: !allowed.has(u.origin) && !['data:', 'blob:', 'devtools:'].includes(u.protocol) }); });
  globalThis.ownedTripoDownloads = []; fs.mkdirSync(path.join(scratch, 'downloads'));
  session.defaultSession.on('will-download', (_event, item) => { const file = path.join(scratch, 'downloads', crypto.randomUUID()); item.setSavePath(file); item.once('done', (_event, state) => globalThis.ownedTripoDownloads.push({ file, state })); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); globalThis.ownedTripoWindow = win; await win.loadURL(process.env.T8_TRIPO_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use the low-load runner, Mode TripoCanvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-tripo-canvas-')), canvasId = 'tripo-' + crypto.randomUUID();
  const port = await freePort(), collabPort = await freePort(), origin = 'http://127.0.0.1:' + port;
  process.env.T8PC_DEV_BACKEND_ORIGIN = origin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  const authority = path.join(root, '.t8-collaboration-management-authority.json'), before = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  let vite, application, page, closed = false;
  const report = { passed: false, cases: [], errors: [], budget, boundary: 'Actual App/Canvas with fresh TEMP SQLite and production routes/ledger; deterministic Provider fixture, no paid calls, no installed-client evidence.' };
  fs.mkdirSync(evidence, { recursive: true }); const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); console.log(phase); };
  const read = async url => { const r = await fetch(origin + url), body = await r.json(); assert.equal(body.success, true, url); return body.data; };
  const saved = async id => (await read('/api/canvas/' + canvasId)).nodes.find(n => n.id === id).data;
  const until = async (fn, label, timeout = 90000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(200); } throw Error(label); };
  const quit = async () => { if (!application || closed) return; const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {}); await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedTripoWindow?.destroy(); await globalThis.ownedTripoBackend.gracefulShutdown('tripo-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned Tripo shutdown'); await close; closed = true; };
  try {
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin()], server: { host: '127.0.0.1', port: 0, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial Tripo App warmup');
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_TRIPO_CANVAS_ROOT: scratch, T8_TRIPO_CANVAS_ID: canvasId, T8_TRIPO_FRONTEND: 'http://127.0.0.1:' + vite.httpServer.address().port, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'), T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token, ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE; delete env.SEEDANCE_NZ_API_KEY;
    application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 }); application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    const n = id => page.locator('.react-flow__node[data-id="' + id + '"]'); await n('generate').waitFor({ timeout: 120000 }); await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN'));
    const stats = () => JSON.parse(fs.readFileSync(path.join(scratch, 'fixture-stats.json'), 'utf8'));
    checkpoint('25-model switching and dynamic controls');
    await n('generate').getByLabel('3D model', { exact: true }).waitFor();
    const models = require('../backend/src/providers/tripo3d').MODELS;
    assert.equal(await n('generate').getByLabel('3D model', { exact: true }).locator('option').count(), 25);
    for (const model of models) { await n('generate').getByLabel('3D model', { exact: true }).selectOption(model); assert.equal(await n('generate').getByLabel('3D model', { exact: true }).inputValue(), model); assert.doesNotMatch(await n('generate').innerText(), /tripo:fields/); }
    await n('generate').getByRole('button', { name: 'Hunyuan 3D', exact: true }).click(); assert.equal(await n('generate').getByLabel('3D model', { exact: true }).locator('option').count(), 2);
    await n('generate').getByRole('button', { name: 'Tripo 3D', exact: true }).click(); await n('generate').getByLabel('3D model', { exact: true }).selectOption('tripo-p-p1-text-to-3d');
    report.cases.push('25 models selectable; original Hunyuan tab intact; dynamic labels resolved');
    await n('image').locator('input[type=file]').first().setInputFiles(path.join(scratch, 'view.png')); await until(async () => Boolean((await saved('image')).imageUrl), 'Image upload not persisted');
    await page.evaluate(() => { window.__tripoRequests = []; window.addEventListener('t8:canvas-node-run-request', event => { const d = event.detail, record = { nodeId: d.nodeId }; window.__tripoRequests.push(record); const prior = d.onSettled; d.onSettled = outcome => { record.outcome = outcome; prior?.(outcome); }; }, { capture: true }); });
    const run = async id => {
      console.log('running ' + id); await page.evaluate(() => document.activeElement?.blur()); await page.locator('.react-flow__pane').first().click({ position: { x: 30, y: 180 } }); await page.keyboard.press('z'); await pause(3000);
      const count = stats().posts.length, index = await page.evaluate(() => window.__tripoRequests.length); await n(id).getByRole('button', { name: '生成 3D', exact: true }).click();
      await until(async () => { const preflight = page.getByTestId('run-preflight-modal'); if (await preflight.isVisible()) { await preflight.getByRole('button', { name: '确认并继续', exact: true }).click(); return false; } const r = await page.evaluate(i => window.__tripoRequests[i], index); if (r?.outcome?.accepted === false) throw Error(r.outcome.error); return r?.outcome?.accepted === true; }, 'Run not accepted: ' + id, 120000);
      await until(async () => { const data = await saved(id); if (data.status === 'error') throw Error(data.error); return data.status === 'success' && stats().posts.length === count + 1; }, 'Run did not complete: ' + id);
      await pause(1000); assert.equal((await saved(id)).tripoTaskId, 'native-platform-' + (count + 1));
    };
    checkpoint('real canvas generation → segment → native completion');
    await run('generate'); await run('segment'); assert.equal(stats().posts[1].images, undefined); assert.equal(stats().posts[1].prompt, undefined); assert.match(stats().posts[1].metadata.model_url, /uploaded.glb$/);
    await run('complete'); assert.equal(stats().posts[2].metadata.tripo_segment_task_id, 'native-platform-2'); assert.equal(stats().posts[2].metadata.model_url, undefined);
    report.cases.push('Generation, local GLB upload for segmentation, native ID completion; previews excluded from images; one POST per run');
    checkpoint('original ZIP/Splat formats, download and reload'); await run('convert'); await run('splat'); assert.match((await saved('convert')).modelUrl, /\.zip$/); assert.match((await saved('splat')).modelUrl, /\.splat$/);
    const assets = await read('/api/project-assets?kind=model3d&limit=100');
    for (let i = 1; i <= 5; i++) {
      const asset = assets.find(asset => asset.metadata?.tripoResult?.taskId === 'platform-' + i);
      assert.ok(asset, 'Missing authoritative Tripo result receipt for task ' + i);
      assert.equal(asset.kind, 'model3d'); assert.equal(asset.metadata.tripoResult.tripoTaskId, 'native-platform-' + i);
      assert.equal(asset.metadata.tripoResult.contentHash, asset.contentHash);
    }
    report.cases.push('Five model assets retain independently verified SHA-256/native provenance, including ZIP/Splat');
    const count = await application.evaluate(() => globalThis.ownedTripoDownloads.length); await n('convert').getByRole('link').first().click(); await until(async () => await application.evaluate(() => globalThis.ownedTripoDownloads.length) > count, 'Original download missing'); assert.equal(await application.evaluate(() => globalThis.ownedTripoDownloads.at(-1).state), 'completed');
    await page.reload(); await n('complete').waitFor({ timeout: 120000 }); assert.equal((await saved('complete')).tripoTaskId, 'native-platform-3'); assert.match((await saved('splat')).modelUrl, /\.splat$/);
    for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en-US']) { await page.evaluate(async ({ theme, language }) => { (await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(theme); await (await import('/src/i18n/index.ts')).default.changeLanguage(language); }, { theme, language }); assert.doesNotMatch(await n('generate').innerText(), /tripo:fields|tripo:errors/); }
    report.cases.push('ZIP and Splat typed outputs committed, original download, native ID and format persistence, bilingual light/dark controls');
    report.stats = { posts: stats().posts.length, uploads: stats().uploads, gets: stats().gets, downloads: stats().downloads }; assert.equal(report.stats.posts, 5); await page.screenshot({ path: path.join(evidence, 'canvas-ui.png') }); await quit(); await vite.close(); vite = null; assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), before); report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'canvas-failure.png') }); } catch {} checkpoint('failed'); throw error; }
  finally { try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = error.message; } await vite?.close(); require('esbuild').stop(); await pause(1000); fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-tripo-canvas-')) fs.rmSync(scratch, { recursive: true, force: true }); else console.error('Owned fixture retained: ' + scratch); if (!report.passed) process.exitCode = 1; }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { console.error(error.stack); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
