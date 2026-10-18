'use strict';
// Full development App + production backend + fresh SQLite + local HTTP fixture.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net'), http = require('node:http');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), liveUrl = process.env.T8_STRATA_CANVAS_LIVE_URL;
const visionCase = process.env.T8_STRATA_CANVAS_VISION === '1';
const secondAudit = process.env.T8_STRATA_CANVAS_AUDIT_ROUND === '2';
const evidence = path.join(root, 'local-private', secondAudit ? 'strata-llm-audit-20261019-round2' : 'strata-llm-audit-20261019', visionCase ? 'canvas-live-vision' : liveUrl ? 'canvas-live' : 'canvas-fixture');
const { withDeadline } = require('./history-acceptance-safety.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_STRATA_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-strata-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile')); app.on('window-all-closed', () => {}); app.disableHardwareAcceleration();
  require('./history-acceptance-safety.cjs').installRendererExitRecorder(app, record => fs.appendFileSync(path.join(scratch, 'renderer-exits.jsonl'), JSON.stringify(record) + '\n'));
  app.commandLine.appendSwitch('disable-gpu');
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  const db = require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  db.ensureCanvas(process.env.T8_STRATA_CANVAS_ID, { nodes: [{ id: 'llm-strata', entityUid: crypto.randomUUID(), type: 'llm', position: { x: 60, y: 30 }, data: {
    model: 'gpt-4o-mini', maxTokens: 2048, stream: true, system: 'Answer briefly.', userPrompt: visionCase ? 'Name the dominant color of this image using one English word. No explanation.' : liveUrl ? 'Reply with exactly STRATA_CANVAS_OK and nothing else.' : 'Hello from the isolated canvas.', history: [], status: 'idle',
  } }], edges: [] }, require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const allowed = new Set([new URL(process.env.T8_STRATA_CANVAS_FRONTEND).origin, `http://127.0.0.1:${process.env.PORT}`, process.env.T8_STRATA_FIXTURE_ORIGIN]);
  const nativeFetch = globalThis.fetch; globalThis.ownedStrataCloudRequests = 0; globalThis.ownedStrataPosts = 0; globalThis.ownedStrataAborts = 0;
  globalThis.fetch = (url, init) => {
    const target = new URL(String(url));
    if (!allowed.has(target.origin)) { globalThis.ownedStrataCloudRequests++; throw Error('External requests forbidden in Strata verifier'); }
    if (target.origin === process.env.T8_STRATA_FIXTURE_ORIGIN && target.pathname === '/v1/chat/completions' && init?.method === 'POST') {
      globalThis.ownedStrataPosts++;
      init.signal?.addEventListener('abort', () => globalThis.ownedStrataAborts++, { once: true });
    }
    return nativeFetch(url, init);
  };
  const backend = require('../backend/src/server'); globalThis.ownedStrataBackend = backend; globalThis.ownedStrataDatabase = db;
  await backend.serverStartPromise; await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const url = new URL(details.url); done({ cancel: !allowed.has(url.origin) && !['data:', 'blob:', 'devtools:'].includes(url.protocol) }); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  globalThis.ownedStrataWindow = win; await win.loadURL(process.env.T8_STRATA_CANVAS_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1 -Mode StrataCanvas');
  assert.ok(!visionCase || liveUrl, 'Vision scenario requires an explicit live Strata API');
  if (liveUrl) {
    const url = new URL(liveUrl);
    assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:' && !url.username && !url.password && !url.search && !url.hash, 'Real UI acceptance only permits an explicitly supplied keyless loopback API');
    assert.ok(['/', '/v1', '/v1/'].includes(url.pathname), 'Use the actual root or /v1 API URL');
  }
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const childProcess = require('node:child_process'), originalSpawn = childProcess.spawn, helperProcesses = [], helperClosed = [];
  childProcess.spawn = function (...args) {
    const child = originalSpawn.apply(this, args);
    const record = { name: path.basename(String(args[0])), pid: child.pid, closed: false };
    helperProcesses.push(record);
    helperClosed.push(new Promise(resolve => child.once('close', (code, signal) => { Object.assign(record, { closed: true, code, signal }); resolve(); })));
    return child;
  };
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-strata-canvas-')), canvasId = 'strata-' + crypto.randomUUID();
  const authority = path.join(root, '.t8-collaboration-management-authority.json'); assert.ok(fs.existsSync(authority));
  const authorityBefore = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  const backendPort = await freePort(), collabPort = await freePort(), backendOrigin = `http://127.0.0.1:${backendPort}`;
  process.env.T8PC_DEV_BACKEND_ORIGIN = backendOrigin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  let vite, application, page, closed = false, fixture, release, posts = 0, aborted = 0, holdNextHealth = false, releaseDiscovery, releaseCompletion;
  const report = { passed: false, phase: 'initialize', startedAt: new Date().toISOString(), errors: [], cases: [], budget, runnerReceipt: process.env.T8_ACCEPTANCE_RUNNER_RECEIPT,
    boundary: liveUrl ? 'Full development App/Canvas → real user-started Strata model; fresh isolated SQLite/profile; not installed Electron or LAN. No engine control or retries.' : 'Full development App/Canvas, real backend/Run/SQLite, isolated local Strata HTTP fixture; not installed Electron, GPU/LAN or real model inference.' };
  fs.mkdirSync(evidence, { recursive: true });
  const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); process.stdout.write(phase + '\n'); };
  const serviceState = async () => {
    const response = await fetch(`${new URL(liveUrl).origin}/v1/status`, { signal: AbortSignal.timeout(8000) });
    const state = await response.json(); assert.equal(state.service, 'strata');
    return { loaded: state.loaded, visionLoaded: state.vision?.loaded, inFlight: state.activity?.in_flight };
  };
  const read = async url => { const r = await fetch(backendOrigin + url), b = await r.json(); assert.equal(b.success, true, url); return b.data; };
  const until = async (check, label, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(100); } throw Error(label); };
  const quit = async () => {
    if (!application || closed) return;
    const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {});
    await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedStrataWindow?.destroy(); await globalThis.ownedStrataBackend.gracefulShutdown('strata-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned Strata backend shutdown');
    await close; closed = true;
  };
  try {
    if (secondAudit && liveUrl) {
      report.beforeDiscovery = await serviceState();
      assert.equal(report.beforeDiscovery.loaded, false, 'Cold audit requires an already unloaded model; verifier never unloads it automatically');
    }
    fixture = http.createServer(async (req, res) => {
      let text = ''; for await (const c of req) text += c;
      assert.equal(req.headers.authorization, undefined);
      const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      if (req.url === '/health') {
        if (holdNextHealth) { holdNextHealth = false; await new Promise(resolve => { releaseDiscovery = resolve; }); }
        return json({ service: 'strata', loaded: true });
      }
      if (req.url === '/v1/status') return json({ service: 'strata', protocol_version: 1, model: 'strata-ui-model', loaded: true, auto_load: true, context: { native: 32768 }, vision: { enabled: false, available: false } });
      if (req.url === '/v1/models') return json({ data: [{ id: 'strata-ui-model', architecture: { output_modalities: ['text'], input_modalities: ['text'] } }] });
      assert.equal(req.url, '/v1/chat/completions'); posts++;
      const body = JSON.parse(text); assert.equal(body.max_tokens, 1024); assert.equal(body.reasoning_effort, 'none');
      res.setHeader('Content-Type', 'text/event-stream'); res.write('data: {"model":"strata-ui-model","choices":[{"delta":{"content":"STRATA_UI_PARTIAL"}}]}\n\n');
      res.once('close', () => { if (!res.writableEnded) aborted++; });
      release = () => res.end('data: {"choices":[{"delta":{"content":"_DONE"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    await new Promise(r => fixture.listen(0, '127.0.0.1', r)); const fixtureOrigin = liveUrl ? new URL(liveUrl).origin : `http://127.0.0.1:${fixture.address().port}`;
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin()],
      server: { host: '127.0.0.1', port: 0, strictPort: false, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming full App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial Strata App warmup');
    const env = { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_STRATA_CANVAS_ROOT: scratch, T8_STRATA_CANVAS_ID: canvasId,
      T8_STRATA_CANVAS_FRONTEND: `http://127.0.0.1:${vite.httpServer.address().port}`, T8_STRATA_FIXTURE_ORIGIN: fixtureOrigin, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'),
      T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token,
      ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
    report.sourceHashes = Object.fromEntries(['backend/src/providers/strata.js', 'backend/src/providers/openaiCompatible.js', 'backend/src/providers/llmMedia.js', 'src/components/ApiSettings.tsx', 'src/components/nodes/LLMNode.tsx'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    checkpoint('launching isolated full App'); application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 });
    application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), async button => button.click());
    await until(() => page.locator('.t8-sidebar-node[data-canvas-node-ready=true]').count().then(n => n > 0), 'Canvas not interactive', 120000);
    checkpoint('actual settings preset and discovery'); await page.getByTitle('API 设置', { exact: true }).click();
    const modal = page.locator('.t8-api-settings-modal'); await modal.waitFor();
    await modal.locator('button.t8-api-settings-toggle').filter({ hasText: '扩展' }).click();
    await modal.getByRole('button', { name: '添加 Strata 本地服务', exact: true }).click();
    await modal.getByRole('textbox', { name: 'Base URL', exact: true }).fill(fixtureOrigin);
    if (!liveUrl) {
      checkpoint('actual delayed discovery must not overwrite edited configuration');
      holdNextHealth = true;
      const oldResponse = page.waitForResponse(response => response.url().includes('/api/proxy/external/test-provider'));
      await modal.getByRole('button', { name: '连接并读取模型（不推理）', exact: true }).click();
      await until(() => !!releaseDiscovery, 'Discovery GET did not reach delayed fixture');
      await modal.getByRole('textbox', { name: 'Base URL', exact: true }).fill(fixtureOrigin + '/changed');
      releaseDiscovery(); await (await oldResponse).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await modal.getByRole('textbox', { name: 'Base URL', exact: true }).inputValue(), fixtureOrigin + '/changed');
      assert.equal((await modal.textContent()).includes('模型 strata-ui-model'), false, 'Old discovery success must remain invalidated after editing');
      report.cases.push('delayed old discovery cannot restore success/models after URL edit');
      await modal.getByRole('textbox', { name: 'Base URL', exact: true }).fill(fixtureOrigin);
    }
    await modal.getByRole('button', { name: '连接并读取模型（不推理）', exact: true }).click();
    await until(() => modal.textContent().then(text => /模型 \S+/.test(text)), 'Discovery not shown'); assert.equal(posts, 0);
    assert.equal(await application.evaluate(() => globalThis.ownedStrataPosts), 0);
    if (secondAudit && liveUrl) {
      report.afterDiscovery = await serviceState();
      assert.equal(report.afterDiscovery.loaded, false, 'Reading metadata must not load the model');
      assert.equal(report.afterDiscovery.visionLoaded, false);
      report.cases.push('cold discovery leaves main and vision models unloaded');
    }
    await page.setViewportSize({ width: 800, height: 600 }); await modal.getByRole('button', { name: '保存', exact: true }).click({ trial: true }); await page.setViewportSize({ width: 1360, height: 940 });
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await read('/api/settings')).advancedProviders.some(p => p.profile === 'strata' && p.chatModels.length), 'Settings not persisted');
    await modal.waitFor({ state: 'hidden' });
    const provider = (await read('/api/settings')).advancedProviders.find(p => p.profile === 'strata');
    report.model = provider.chatModels[0];
    const node = page.locator('.react-flow__node[data-id=llm-strata]');
    checkpoint('actual LLM controls and parameter preservation');
    await node.getByRole('button', { name: /高级来源/ }).click();
    await node.locator('select').filter({ has: page.locator(`option[value="${provider.id}"]`) }).selectOption(provider.id);
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes[0].data.providerId === provider.id, 'Source not autosaved');
    assert.equal((await read('/api/canvas/' + canvasId)).nodes[0].data.maxTokens, 2048);
    await node.getByRole('button', { name: '采用本地推荐参数（1024 / 不思考）', exact: true }).click();
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('z');
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes[0].data.maxTokens === 1024, 'Explicit defaults not saved');
    if (visionCase) {
      const red = await require('sharp')({ create: { width: 128, height: 128, channels: 3, background: '#f00000' } }).png().toBuffer();
      await node.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'strata-red.png', mimeType: 'image/png', buffer: red });
      const thumbnail = node.getByRole('img', { name: 'strata-red.png', exact: true });
      await until(async () => await thumbnail.count() > 0 && await thumbnail.evaluate(image => image.complete && image.naturalWidth === 128 && image.naturalHeight === 128), 'Local image missing or undecoded in actual node preview');
      report.cases.push('actual file input uploads image into LLM node preview');
    }
    const postCount = () => application.evaluate(() => globalThis.ownedStrataPosts);
    const run = async () => { const baselinePosts = await postCount(); await node.getByRole('button', { name: '发送', exact: true }).click(); await until(async () => { const p = page.getByTestId('run-preflight-modal'); if (await p.isVisible()) { await p.getByRole('button', { name: '确认并继续', exact: true }).click(); return true; } return await postCount() > baselinePosts; }, 'Run preflight not reached'); };
    checkpoint('real Run and incremental output'); const firstStarted = Date.now(); await run();
    if (!liveUrl) {
      await until(() => node.textContent().then(text => text.includes('STRATA_UI_PARTIAL')), 'No visible streaming delta');
      assert.notEqual((await read('/api/canvas/' + canvasId)).nodes[0].data.reply, 'STRATA_UI_PARTIAL'); release();
    }
    await until(async () => {
      const runs = await read('/api/project-runs?canvasId=' + canvasId);
      assert.equal(runs.some(run => run.status === 'failed'), false, 'Initial generation failed');
      return runs.some(run => run.status === 'succeeded');
    }, 'Run did not succeed', liveUrl ? 195000 : 45000);
    report.firstRunElapsedMs = Date.now() - firstStarted;
    if (secondAudit && liveUrl) { report.afterFirstRun = await serviceState(); assert.equal(report.afterFirstRun.loaded, true); report.cases.push('actual canvas generation cold-loads the model'); }
    const expectedReply = visionCase ? 'RED' : liveUrl ? 'STRATA_CANVAS_OK' : 'STRATA_UI_PARTIAL_DONE';
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes[0].data.reply?.trim().toUpperCase() === expectedReply, 'Reply not autosaved');
    report.output = (await read('/api/canvas/' + canvasId)).nodes[0].data.reply;
    await page.screenshot({ path: path.join(evidence, 'strata-success.png') });
    report.cases.push('real settings add/discovery/save', 'no inference on connection', 'old explicit parameters preserved', 'explicit local defaults', visionCase ? 'actual uploaded image → real Strata vision → canvas Run' : liveUrl ? 'actual Strata text through canvas Run' : 'live delta before terminal', 'real successful Run and autosave');
    if (liveUrl) {
      const prompt = node.locator('[contenteditable=true][data-placeholder="备用：无上游连接时使用"]');
      await prompt.fill('Reply with exactly STRATA_CANVAS_NONSTREAM and nothing else.');
      await node.getByText('SSE', { exact: true }).click();
      await run();
      await until(async () => (await read('/api/canvas/' + canvasId)).nodes[0].data.reply?.trim() === 'STRATA_CANVAS_NONSTREAM', 'Non-stream reply not autosaved');
      await node.getByText('关', { exact: true }).click();
      await prompt.fill('Count from 1 to 1000, writing one number per line. Continue until 1000.');
      report.cases.push('actual Strata non-stream through canvas');
    }
    if (secondAudit) {
      checkpoint('actual Stop while completion ledger response is delayed');
      const beforeCommit = await read('/api/canvas/' + canvasId);
      const oldRuns = new Set((await read('/api/project-runs?canvasId=' + canvasId)).map(run => run.id || run.runId));
      let intercepted = false;
      const completionRoute = async route => {
        const event = route.request().postDataJSON();
        if (!intercepted && event?.type === 'provider.response' && event.payload?.status === 'succeeded') {
          intercepted = true;
          const response = await route.fetch();
          await new Promise(resolve => { releaseCompletion = resolve; });
          await route.fulfill({ response });
        } else await route.continue();
      };
      await page.route('**/api/project-runs/*/events', completionRoute);
      await run();
      if (!liveUrl) { await until(() => posts === 2, 'Completion-race fixture request missing'); release(); }
      await until(() => !!releaseCompletion, 'Successful provider event was not intercepted', 45000);
      await node.getByTitle('中止', { exact: true }).click();
      releaseCompletion(); releaseCompletion = null;
      await until(async () => (await read('/api/project-runs?canvasId=' + canvasId)).some(run => !oldRuns.has(run.id || run.runId) && run.status === 'stopped'), 'Late Stop did not persist stopped Run');
      await until(async () => (await read('/api/canvas/' + canvasId)).nodes[0].data.status === 'idle', 'Late Stop node did not autosave idle');
      await page.unroute('**/api/project-runs/*/events', completionRoute);
      const afterCommitStop = await read('/api/canvas/' + canvasId);
      assert.equal(afterCommitStop.nodes[0].data.status, 'idle');
      assert.equal(afterCommitStop.nodes[0].data.reply, beforeCommit.nodes[0].data.reply);
      assert.deepEqual(afterCommitStop.nodes[0].data.history, beforeCommit.nodes[0].data.history);
      report.cases.push('Stop during actual delayed completion ledger prevents success/history adoption');
    }
    const completedPosts = liveUrl ? secondAudit ? 4 : 3 : secondAudit ? 3 : 2;
    const beforeCancelDocument = secondAudit ? await read('/api/canvas/' + canvasId) : null;
    checkpoint('stop reaches Run and upstream'); await run(); await until(async () => await postCount() === completedPosts, 'Cancel call missing');
    if (secondAudit && liveUrl) await node.getByText('🤖 助手（流式中…）', { exact: true }).waitFor({ timeout: 45000 });
    await node.getByTitle('中止', { exact: true }).click();
    await until(async () => liveUrl ? await application.evaluate(() => globalThis.ownedStrataAborts) >= 1 : aborted === 1, 'Stop did not abort upstream');
    await until(async () => (await read('/api/project-runs?canvasId=' + canvasId)).some(r => ['stopped', 'cancelled'].includes(r.status)), 'Run stop not persisted');
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes[0].data.status === 'idle', 'Stopped node stayed generating in saved canvas');
    report.cases.push('actual inline Stop cancels upstream and persisted Run');
    if (secondAudit) {
      const stoppedDocument = await read('/api/canvas/' + canvasId);
      assert.equal(stoppedDocument.nodes[0].data.reply, beforeCancelDocument.nodes[0].data.reply);
      assert.deepEqual(stoppedDocument.nodes[0].data.history, beforeCancelDocument.nodes[0].data.history);
      report.cases.push('cancelling after a visible delta preserves previous successful reply/history');
    }
    checkpoint('reload and disabled source failure'); await page.reload(); await node.waitFor();
    await until(() => node.textContent().then(text => text.includes(provider.chatModels[0])), 'Saved model lost after reload');
    await page.evaluate(async p => { const store = (await import('/src/stores/apiKeys.ts')).useApiKeysStore; await store.getState().save({ advancedProviders: store.getState().settings.advancedProviders.map(item => item.id === p ? { ...item, enabled: false } : item) }); }, provider.id);
    const beforeBlockedRuns = new Set((await read('/api/project-runs?canvasId=' + canvasId)).map(run => run.id || run.runId));
    await node.getByRole('button', { name: '发送', exact: true }).click();
    const blocked = page.getByTestId('run-preflight-modal');
    await until(async () => await blocked.isVisible() || (await node.textContent()).includes('保存的来源或模型不存在'), 'No explicit unavailable-source block');
    if (await blocked.isVisible()) { assert.match(await blocked.textContent(), /停用|未启用|不可用|不存在/); await blocked.getByRole('button', { name: '取消', exact: true }).click(); }
    else await until(async () => {
      const blockedRuns = (await read('/api/project-runs?canvasId=' + canvasId)).filter(run => !beforeBlockedRuns.has(run.id || run.runId));
      assert.ok(blockedRuns.every(run => run.status !== 'succeeded'), 'Unavailable source must not be recorded as a successful Run');
      return blockedRuns.some(run => run.status === 'failed');
    }, 'Unavailable source did not persist a failed Run');
    await until(async () => (await read('/api/canvas/' + canvasId)).nodes[0].data.providerId === provider.id, 'Unavailable source identity was overwritten');
    assert.equal(await postCount(), completedPosts); assert.equal(await application.evaluate(() => globalThis.ownedStrataCloudRequests), 0);
    if (secondAudit) {
      const failedDocument = await read('/api/canvas/' + canvasId);
      assert.equal(failedDocument.nodes[0].data.reply, beforeCancelDocument.nodes[0].data.reply);
      assert.deepEqual(failedDocument.nodes.map(node => node.id).sort(), beforeCancelDocument.nodes.map(node => node.id).sort(), 'Stopped/failed runs cannot create output nodes');
      report.cases.push('stop and failed source do not overwrite prior output or add output nodes');
    }
    await page.screenshot({ path: path.join(evidence, 'strata-canvas.png') }); report.cases.push('reload retains provider/model', 'disabled source blocks without cloud requests or a false successful Run');
    checkpoint('localization and narrow settings');
    await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('en-US'));
    await page.getByTitle('API settings', { exact: true }).click(); await modal.waitFor();
    await modal.locator('button.t8-api-settings-toggle').filter({ hasText: /Advanced|Extended|External/ }).click();
    await modal.getByRole('button', { name: 'Add local Strata service', exact: true }).waitFor();
    for (const mode of ['light', 'dark']) {
      await page.evaluate(async mode => (await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(mode), mode);
      await page.setViewportSize({ width: 800, height: 600 }); await modal.getByRole('button', { name: 'Save', exact: true }).click({ trial: true });
      await page.screenshot({ path: path.join(evidence, `strata-settings-${mode}-en.png`) });
    }
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click(); report.cases.push('English preset controls', 'light/dark 800x600 settings footer access');
    assert.deepEqual(report.errors, []); report.posts = await postCount();
    report.runs = (await read('/api/project-runs?canvasId=' + canvasId)).map(run => ({ runId: run.runId || run.id, status: run.status }));
    if (secondAudit) {
      for (const run of report.runs) {
        const detail = await read('/api/project-runs/' + run.runId);
        run.nodeRuns = detail.nodeRuns.map(node => ({ nodeId: node.nodeId, status: node.status, attempts: node.attempts.map(attempt => ({ status: attempt.status })) }));
        assert.equal(run.nodeRuns.length, 1);
        for (const node of run.nodeRuns) {
          assert.equal(node.status, run.status, 'Run and NodeRun terminal must agree');
          assert.equal(node.attempts.length, 1, 'Each UI action owns exactly one Attempt');
          assert.equal(node.attempts[0].status, run.status, 'Run and Attempt terminal must agree');
        }
      }
      report.cases.push('Run/NodeRun/Attempt terminals agree for success, stop and local failure');
    }
    await quit(); await vite.close(); vite = null;
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), authorityBefore);
    report.passed = true; report.finishedAt = new Date().toISOString(); checkpoint('passed');
  } catch (error) {
    report.passed = false;
    report.failure = String(error.stack).slice(0, 2000);
    if (page && !page.isClosed()) { try { await page.screenshot({ path: path.join(evidence, 'failure.png') }); } catch {} }
    checkpoint('failed: ' + report.phase); throw error;
  } finally {
    releaseCompletion?.();
    try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = String(error.message); const child = application?.process(); if (child && child.exitCode === null) child.kill(); }
    await vite?.close(); fixture?.closeAllConnections(); await new Promise(resolve => fixture ? fixture.close(resolve) : resolve());
    // Vite's build helper is separate from the owned Electron application.
    // Explicitly stop its service and observe close, instead of exiting while
    // Windows is still reaping a helper and making the outer Job force-dispose it.
    try {
      require('esbuild').stop();
      await withDeadline(() => Promise.all(helperClosed), 10000, 'owned verifier helper close');
    } catch (error) { report.passed = false; report.helperShutdownFailure = String(error.message); }
    childProcess.spawn = originalSpawn;
    report.helperProcesses = helperProcesses;
    if (!report.passed) process.exitCode = 1;
    fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2));
    fs.mkdirSync(path.join(evidence, 'attempts'), { recursive: true }); fs.writeFileSync(path.join(evidence, 'attempts', path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || 'unknown.json')), JSON.stringify(report, null, 2));
    if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-strata-canvas-')) fs.rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write('Owned Strata fixture retained: ' + scratch + '\n');
  }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { process.stderr.write(error.stack + '\n'); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
