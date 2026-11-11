'use strict';
// Full App, production Creator placement/Canvas merge and Run handlers.
// All storage is fresh TEMP; Provider generation and real model installation
// are forbidden. The local-engine boundary alone returns a fixture receipt.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const net = require('node:net'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { withDeadline } = require('./history-acceptance-safety.cjs');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/issues-20261112');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_ISSUES_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-issues-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
  require('./history-acceptance-safety.cjs').installRendererExitRecorder(app, record => fs.appendFileSync(path.join(scratch, 'renderer-exits.jsonl'), JSON.stringify(record) + '\n'));
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const dir of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'isolated-fixture-not-a-provider-key' }));
  const png = await require('sharp')({ create: { width: 96, height: 64, channels: 3, background: '#237d96' } }).png().toBuffer();
  const file = path.join(config.OUTPUT_DIR, 'issue-result.png'); fs.writeFileSync(file, png);
  const hash = crypto.createHash('sha256').update(png).digest('hex');
  const db = require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const projectId = require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID, canvasId = process.env.T8_ISSUES_CANVAS;
  db.ensureCanvas(canvasId, { nodes: [
    { id: 'draft', entityUid: crypto.randomUUID(), type: 'text', position: { x: 0, y: 0 }, data: { text: 'Before placement' } },
    { id: 'localization', entityUid: crypto.randomUUID(), type: 'localization-master', position: { x: 400, y: 0 }, data: {} },
  ], edges: [] }, projectId);
  db.upsertAsset({ id: 'issue-result', projectId, kind: 'image', mimeType: 'image/png', filename: 'issue-result.png', managedPath: file,
    storageMode: 'managed', availability: 'available', contentHash: hash, metadata: { size: png.length, width: 96, height: 64 } });
  const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository');
  const repository = new CreatorConversationRepository({ filename: path.join(config.DATA_DIR, 'creator-agent/conversations-v2.sqlite3') });
  repository.createConversation({ id: 'issue-session', projectId, canvasId, title: 'Isolated issue follow-up' });
  repository.appendUserMessage('issue-session', { body: 'Fixture image result', clientRequestId: 'fixture-message' });
  const response = repository.startAssistantResponse('issue-session', { responseId: 'fixture-response' });
  repository.completeAssistantResponse('issue-session', response.responseId, { body: 'Fixture result, no generation performed.', suggestions: ['Adjust fixture', 'View fixture', 'Keep fixture'], action: {
    id: 'issue-action', type: 'image', prompt: 'Fixture only', parameters: { ratio: '3:2', count: 1 },
    modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-g2-t2i', catalogDigest: require('../backend/src/shared/creativeModelCatalog.json').sourceDigest },
  } });
  repository.updateAction('issue-action', 'issue-session', { status: 'completed', conversationPhase: 'candidates', resultAssets: [
    { assetId: 'issue-result', kind: 'image', contentHash: hash, title: 'issue-result.png', previewUrl: '/api/project-assets/issue-result/media' },
  ] });
  repository.close();
  const backend = require('../backend/src/server'); globalThis.ownedIssuesBackend = backend; globalThis.ownedIssuesDatabase = db;
  await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_ISSUES_FRONTEND).origin, 'http://127.0.0.1:' + process.env.PORT]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const url = new URL(details.url); done({ cancel: !allowed.has(url.origin) && !['data:', 'blob:', 'devtools:'].includes(url.protocol) }); });
  const win = new BrowserWindow({ show: false, width: 1520, height: 1050, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  globalThis.ownedIssuesWindow = win; await win.loadURL(process.env.T8_ISSUES_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1 -Mode IssuesCanvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-issues-canvas-')), canvasId = 'issues-' + crypto.randomUUID();
  const authority = path.join(root, '.t8-collaboration-management-authority.json'); assert.ok(fs.existsSync(authority));
  const authorityHash = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  const backendPort = await freePort(), collabPort = await freePort(), origin = 'http://127.0.0.1:' + backendPort;
  process.env.T8PC_DEV_BACKEND_ORIGIN = origin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  const report = { passed: false, cases: [], errors: [], diagnostics: [], budget, runnerReceipt: process.env.T8_ACCEPTANCE_RUNNER_RECEIPT,
    stats: { placements: 0, installs: 0, externalCalls: 0 }, boundary: 'Full development App and production backend/SQLite/Canvas, fixture local-engine boundary; no live Provider, real model installation, retained database, installed app or real Mac acceptance.' };
  fs.mkdirSync(evidence, { recursive: true });
  let vite, application, page, closed = false, readDelay = 0, failRead = false, runDelay = 0, installed = false;
  const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); console.log(phase); };
  const read = async () => { const response = await fetch(origin + '/api/canvas/' + canvasId); assert.equal(response.status, 200); return (await response.json()).data; };
  const until = async (check, message, timeout = 60000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(100); } throw Error(message); };
  const quit = async () => { if (!application || closed) return; const closing = application.waitForEvent('close', { timeout: 30000 }); void closing.catch(() => {});
    await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedIssuesWindow?.destroy(); await globalThis.ownedIssuesBackend.gracefulShutdown('issues-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned issues shutdown'); await closing; closed = true; };
  try {
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin(), {
      name: 'owned-issues-boundaries',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/components/Canvas.tsx')) return null;
        return source.replace(/throw new Error\((['"])创建 Run 期间画布或执行输入发生变化，已停止调用 Provider\1\);/, "console.log('[issues-snapshot]', JSON.stringify({expected:persistenceSnapshot,current:captureExecutionSnapshot()})); throw new Error('创建 Run 期间画布或执行输入发生变化，已停止调用 Provider');")
          .replace('const next = advanceCanvasPatchMutation({ value: nodesRef.current, epoch: graphMutationEpochRef.current }, action);',
            "const previousIssueNodes = nodesRef.current; const next = advanceCanvasPatchMutation({ value: nodesRef.current, epoch: graphMutationEpochRef.current }, action); if(window.__issuesTrackMutations && next.epoch !== graphMutationEpochRef.current) console.log('[issues-mutation]',JSON.stringify(next.value.filter(n=>previousIssueNodes.find(p=>p.id===n.id)!==n).map(n=>({id:n.id,fields:[...new Set([...Object.keys(previousIssueNodes.find(p=>p.id===n.id)||{}),...Object.keys(n)])].filter(k=>JSON.stringify(previousIssueNodes.find(p=>p.id===n.id)?.[k])!==JSON.stringify(n[k]))}))));");
      },
      configureServer(server) { server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (/\/send-to-canvas$/.test(url) && req.method === 'POST') report.stats.placements++;
        if (url === '/api/canvas/' + canvasId && req.method === 'GET') {
          if (failRead) { failRead = false; res.statusCode = 503; res.end(JSON.stringify({ success: false, error: 'Fixture read interrupted' })); return; }
          if (readDelay) { const delay = readDelay; readDelay = 0; setTimeout(next, delay); return; }
        }
        if (url === '/api/project-runs' && req.method === 'POST' && runDelay) { setTimeout(next, runDelay); return; }
        if (url.startsWith('/api/localization-master/runtime')) {
          if (url.endsWith('/install')) { installed = true; report.stats.installs++; }
          const receipt = { schema: 't8-indextts25-runtime-receipt-v2', checkedAt: Date.now(), ready: installed, licenseAccepted: true, online: true,
            engineReady: installed, dependenciesReady: installed, modelReady: installed, device: 'cpu', requiresComfyUI: false,
            install: { running: false, stage: installed ? 'complete' : 'not-installed', progress: installed ? 100 : 0, message: 'Fixture only', error: '', startedAt: 0, finishedAt: 0 }, message: 'Fixture only' };
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, data: url.endsWith('/install') ? receipt.install : receipt })); return;
        }
        if (/^\/api\/(?:proxy|runninghub|image-generation|llm)(?:\/|$)/.test(url)) { report.stats.externalCalls++; res.statusCode = 500; res.end('External generation is forbidden in this fixture'); return; }
        next();
      }); },
    }], server: { host: '127.0.0.1', port: 0, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming full App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial issues App warmup');
    const env = { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_ISSUES_ROOT: scratch, T8_ISSUES_CANVAS: canvasId,
      T8_ISSUES_FRONTEND: 'http://127.0.0.1:' + vite.httpServer.address().port, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'),
      T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token,
      ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' };
    delete env.ELECTRON_RUN_AS_NODE; delete env.SEEDANCE_NZ_API_KEY;
    application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 });
    application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (/^\[issues-(?:snapshot|mutation)\]/.test(message.text())) report.diagnostics.push(message.text()); });
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    const node = id => page.locator('.react-flow__node[data-id="' + id + '"]');
    await node('draft').waitFor({ timeout: 120000 }); await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN'));
    if (process.env.T8_ISSUES_LOCALIZATION_ONLY !== '1') {
    await page.getByRole('button', { name: '打开创作助手', exact: true }).click();
    const panel = page.locator('[data-canvas-floating-ui="creator-agent-panel"]');
    await panel.getByRole('button', { name: '采用并发送', exact: true }).waitFor();
    readDelay = 1500;
    await panel.getByRole('button', { name: '采用并发送', exact: true }).click();
    await until(async () => report.stats.placements === 1, 'Placement POST missing');
    await node('draft').getByRole('textbox').first().fill('Concurrent local text survives placement');
    await panel.getByRole('button', { name: '已发送 · 查看', exact: true }).waitFor();
    const placed = (await read()).nodes.find(item => item.data?.sourceAssetId === 'issue-result'); assert.ok(placed);
    await node(placed.id).waitFor();
    assert.equal(await node('draft').getByRole('textbox').first().innerText(), 'Concurrent local text survives placement');
    report.cases.push('Production placement, delayed canonical read, existing local text merge, visible selected node');
    failRead = true; await panel.getByRole('button', { name: '已发送 · 查看', exact: true }).click();
    await until(() => panel.getByRole('alert').filter({ hasText: /画布操作没有完成|网络连接中断/ }).isVisible().catch(() => false), 'Read failure did not reach the panel');
    await panel.getByRole('button', { name: '已发送 · 查看', exact: true }).click();
    await until(async () => await panel.getByRole('button', { name: '已发送 · 查看', exact: true }).isEnabled() && await panel.getByRole('alert').count() === 0, 'View retry did not finish');
    await until(async () => await node(placed.id).getAttribute('class').then(value => value.includes('selected')), 'View did not select the committed node');
    assert.equal(report.stats.placements, 1); report.cases.push('Failed GET and explicit View recover without another placement POST');
    await until(async () => (await read()).nodes.find(item => item.id === 'draft')?.data.text === 'Concurrent local text survives placement', 'Merged local text not persisted');
    await page.reload(); await node(placed.id).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: '打开创作助手', exact: true }).click();
    await panel.getByRole('button', { name: '已发送 · 查看', exact: true }).click(); assert.equal(report.stats.placements, 1);
    report.cases.push('Fresh page restores the durable placement receipt and View remains GET-only');
    await panel.getByRole('button', { name: '关闭', exact: true }).click();
    }
    const localization = node('localization'); await localization.getByRole('tab', { name: '3 配音', exact: true }).click();
    const install = localization.getByRole('button', { name: '一键安装本地引擎与模型', exact: true }); await until(() => install.isEnabled(), 'Fixture local engine button unavailable');
    await page.evaluate(() => {
      window.__issuesRuns = []; window.__issuesHeights = [];
      window.addEventListener('t8:canvas-node-run-request', event => {
        const detail = event.detail, row = { nodeId: detail.nodeId }; window.__issuesRuns.push(row);
        const previous = detail.onSettled; detail.onSettled = outcome => { row.outcome = outcome; previous?.(outcome); };
      }, { capture: true });
      const element = document.querySelector('.react-flow__node[data-id="localization"]');
      window.__issuesObserver = new ResizeObserver(() => window.__issuesHeights.push({ height: element.offsetHeight, at: Date.now() }));
      window.__issuesObserver.observe(element);
    });
    await pause(2500); runDelay = 900;
    await page.evaluate(() => { window.__issuesTrackMutations = true; });
    await install.click();
    await until(async () => {
      const changed = report.diagnostics.find(value => value.startsWith('[issues-snapshot]'));
      if (changed) throw Error(changed);
      const outcome = await page.evaluate(() => window.__issuesRuns.at(-1)?.outcome);
      if (outcome?.accepted === false) throw Error(outcome.error || 'Fixture Run rejected');
      const modal = page.getByTestId('run-preflight-modal');
      if (await modal.isVisible()) { const confirm = modal.getByRole('button', { name: '确认并继续', exact: true }); if (await confirm.isEnabled()) await confirm.click(); }
      return report.stats.installs === 1 && (await read()).nodes.find(item => item.id === 'localization')?.data.status === 'success';
    }, 'Local engine Run did not finish', 90000);
    report.runDiagnostics = await page.evaluate(() => ({ runs: window.__issuesRuns, heights: window.__issuesHeights }));
    report.cases.push('Normal install click with a delayed durable Run reaches fixture engine and releases button');
    await until(async () => {
      report.ledger = await application.evaluate(({ }, targetCanvasId) => {
        const db = globalThis.ownedIssuesDatabase;
        return db.listRuns({ canvasId: targetCanvasId }).map(run => ({
          status: run.status,
          nodes: db.listNodeRuns(run.id).map(node => ({ status: node.status })),
          attempts: db.listRunAttempts(run.id).map(attempt => ({ status: attempt.status, provider: attempt.provider, model: attempt.model })),
          events: db.getRunEvents(run.id).map(event => ({ type: event.type, phase: event.payload?.phase })),
        }));
      }, canvasId);
      return report.ledger.length === 1 && report.ledger[0].status === 'succeeded';
    }, 'Authoritative maintenance Run did not reach a durable terminal status');
    const ledger = report.ledger[0];
    assert.deepEqual(ledger.nodes.map(node => node.status), ['succeeded']);
    assert.deepEqual(ledger.attempts.map(attempt => attempt.status), ['succeeded']);
    assert.ok(ledger.attempts.every(attempt => !attempt.provider && !attempt.model));
    assert.ok(ledger.events.some(event => event.type === 'node.progress' && event.phase === 'completed-without-output'));
    assert.ok(ledger.events.every(event => event.type !== 'node.output' && !event.type.startsWith('provider.')));
    report.cases.push('Authoritative Run, NodeRun and Attempt succeed with no fabricated output or Provider events');
    assert.equal(report.stats.externalCalls, 0); await page.screenshot({ path: path.join(evidence, 'canvas-ui.png') });
    await quit(); await vite.close(); vite = null;
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), authorityHash); report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) { report.runDiagnostics = await page.evaluate(() => ({ runs: window.__issuesRuns, heights: window.__issuesHeights })).catch(() => null); report.visibleText = (await page.locator('body').innerText().catch(() => '')).slice(-6000); await page.screenshot({ path: path.join(evidence, 'canvas-failure.png') }).catch(() => {}); } checkpoint('failed'); throw error; }
  finally { try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = error.message; }
    await vite?.close(); require('esbuild').stop(); await pause(1000); fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2));
    const attempts = path.join(evidence, 'canvas-attempts'); fs.mkdirSync(attempts, { recursive: true });
    const attempt = path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || 'unknown.json');
    fs.writeFileSync(path.join(attempts, attempt), JSON.stringify(report, null, 2));
    if (!report.passed && fs.existsSync(path.join(evidence, 'canvas-failure.png'))) fs.copyFileSync(path.join(evidence, 'canvas-failure.png'), path.join(attempts, attempt.replace(/\.json$/, '.png')));
    if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-issues-canvas-')) fs.rmSync(scratch, { recursive: true, force: true });
    else console.error('Owned fixture retained: ' + scratch); if (!report.passed) process.exitCode = 1;
  }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { console.error(error.stack); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
