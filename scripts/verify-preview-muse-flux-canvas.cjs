'use strict';
// Full development App/Canvas + production routes/ledger/storage. Only the
// external Provider HTTP/media boundary is a deterministic fixture. No paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/models-20261101');
const { withDeadline } = require('./history-acceptance-safety.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_PMF_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-pmf-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile'));
  app.on('window-all-closed', () => {}); app.disableHardwareAcceleration();
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const directory of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'motion-ui-fixture-key' }));
  const fixtureFile = path.join(scratch, 'fixture.mp4');
  require('node:child_process').execFileSync(require('../backend/src/providers/llmMedia').resolveBundledFfmpeg(),
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:r=12:d=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', fixtureFile], { windowsHide: true });
  const bytes=fs.readFileSync(fixtureFile),tasks=new Map(),sharp=require('sharp');
  const picture=await sharp({create:{width:400,height:400,channels:3,background:'blue'}}).png().toBuffer();fs.writeFileSync(path.join(config.INPUT_DIR,'view.png'),picture);fs.writeFileSync(path.join(scratch,'view.png'),picture);
  globalThis.motionFixture={posts:[],gets:[],downloads:0};
  const persistFixture=()=>fs.writeFileSync(path.join(scratch,'fixture-stats.json'),JSON.stringify(globalThis.motionFixture));persistFixture();
  const transport=async(url,init={})=>{
    if(String(url).endsWith('/v1/files/upload'))return new Response(JSON.stringify({url:'https://pmf.example/input.png'}),{headers:{'content-type':'application/json'}});
    assert.match(String(url),/\/v1\/(image|video)\/generations/);
    if(init.method==='POST'){const body=JSON.parse(init.body);globalThis.motionFixture.posts.push(body);const id='pmf-fixture-'+(tasks.size+1);tasks.set(id,body);persistFixture();return new Response(JSON.stringify({task_id:id}),{headers:{'content-type':'application/json'}});}
    const id=String(url).split('/').at(-1),body=tasks.get(id);assert.ok(body,'Only accepted tasks may be queried');globalThis.motionFixture.gets.push(id);persistFixture();
    return new Response(JSON.stringify({data:{status:'SUCCESS',data:{model:body.model,content:body.model==='zhenzhen-video-muse'?{video_url:'https://pmf.example/result.mp4'}:{image_url:'https://pmf.example/result.png'}}}}),{headers:{'content-type':'application/json'}});
  };
  const provider=require('../backend/src/providers/seedanceNz');
  for(const name of ['submitImageTask','queryImageTask','submitMuseVideoTask','queryMuseVideoTask']){const original=provider[name];provider[name]=(request,key,options)=>original(request,key,{...options,fetchImpl:transport,uploadIntervalMs:0});}
  const remote=require('../backend/src/utils/safeRemoteMediaFetch');remote.safeRemoteMediaFetch=async url=>{assert.ok(['https://pmf.example/result.mp4','https://pmf.example/result.png'].includes(String(url)));globalThis.motionFixture.downloads++;const video=String(url).endsWith('.mp4');return{buffer:video?bytes:picture,contentType:video?'video/mp4':'image/png',finalUrl:String(url),status:200};};
  const db=require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const node=(id,model,x)=>({id,entityUid:crypto.randomUUID(),type:id==='video'?'video':'image',position:{x,y:30},data:{model:id==='flux'?'flux-3-image':model,apiModel:model,mainId:model,videoBuiltinSource:'seedance-nz',imageBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',advancedProviderOpen:true,prompt:'A friendly toy robot beside a cup',aspectRatio:'auto',ratio:'16:9',sizeLevel:id==='hy'?'1K':id==='flux'?'768sq':'',duration:10,resolution:'720p',imageOnlyOutput:true,status:'idle',reuseResult:false}});
  db.ensureCanvas(process.env.T8_PMF_CANVAS_ID,{nodes:[node('hy','zhenzhen-image-hy-v3.5-preview',0),node('flux','flux-3-image-t2i',450),node('muse','zhenzhen-image-muse',900),node('video','zhenzhen-video-muse',1350)],edges:[]},require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedMotionBackend = backend; globalThis.ownedMotionDatabase = db;
  await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_PMF_FRONTEND).origin, `http://127.0.0.1:${process.env.PORT}`]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const u = new URL(details.url); done({ cancel: !allowed.has(u.origin) && !['data:', 'blob:', 'devtools:'].includes(u.protocol) }); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  globalThis.ownedMotionWindow = win; await win.loadURL(process.env.T8_PMF_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1 -Mode PmfCanvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-pmf-canvas-')), canvasId = 'motion-' + crypto.randomUUID();
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
    const env = { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_PMF_CANVAS_ROOT: scratch, T8_PMF_CANVAS_ID: canvasId,
      T8_PMF_FRONTEND: `http://127.0.0.1:${vite.httpServer.address().port}`, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'),
      T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token,
      ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
    checkpoint('launching isolated full App'); application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 });
    application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    await page.evaluate(async()=>{await(await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN');});
    const hy=page.locator('.react-flow__node[data-id="hy"]');await hy.waitFor({timeout:120000});
    const stats=()=>JSON.parse(fs.readFileSync(path.join(scratch,'fixture-stats.json'),'utf8'));
    const saved=async id=>(await read('/api/canvas/'+canvasId)).nodes.find(n=>n.id===id).data;
    const run=async(id,name)=>{await page.evaluate(()=>document.activeElement?.blur());await page.locator('.react-flow__pane').first().click({position:{x:30,y:180}});await page.keyboard.press('z');await pause(600);const n=page.locator('.react-flow__node[data-id="'+id+'"]');const count=stats().posts.length;await n.getByRole('button',{name,exact:true}).click();await until(async()=>{const preflight=page.getByTestId('run-preflight-modal');if(await preflight.isVisible()){await preflight.getByRole('button',{name:'确认并继续',exact:true}).click();return false;}return stats().posts.length>count;},'No submission');await until(async()=>(await saved(id)).status==='success','Node did not complete: '+id,90000);};
    checkpoint('three new tabs and original Flux default');
    for(const title of ['Hunyuan Image','Muse Image','Flux'])await hy.getByRole('button',{name:title,exact:true}).waitFor({timeout:60000});
    await hy.locator('select').filter({has:page.locator('option[value="custom"]')}).selectOption('custom');
    await hy.getByLabel('宽度',{exact:true}).fill('1280');await hy.getByLabel('高度',{exact:true}).fill('720');await hy.getByLabel('种子',{exact:true}).fill('42');
    await hy.getByLabel('负面提示词',{exact:true}).fill('watermark');await run('hy','生成');
    const h=stats().posts.at(-1);assert.equal(h.width,1280);assert.equal(h.height,720);assert.equal(h.seed,42);assert.equal(h.negative_prompt,'watermark');assert.equal(h.n,1);
    report.cases.push('HY custom controls and original image execution/materialization');
    checkpoint('all four Flux variants and ordered local references');
    const flux=page.locator('.react-flow__node[data-id="flux"]');
    const models=flux.locator('select').filter({has:page.locator('option[value="flux-3-image-klein-i2i"]')});
    for(const model of ['flux-3-image-t2i','flux-3-image-klein-t2i','flux-3-image-i2i','flux-3-image-klein-i2i']){
      await models.selectOption(model);
      if(model==='flux-3-image-i2i'){await flux.locator('input[type=file]').first().setInputFiles(path.join(scratch,'view.png'));await until(async()=>(await saved('flux')).referenceImages?.length===1,'Upload did not persist');}
      if(model.includes('-klein-')){await flux.getByLabel('种子',{exact:true}).fill('42');await flux.getByLabel('步数（0为平台默认）',{exact:true}).fill('4');await flux.getByLabel('输出格式',{exact:true}).selectOption('png');}
      await run('flux','生成');const p=stats().posts.at(-1);assert.equal(p.model,model);assert.equal(Object.hasOwn(p,'n'),false);assert.equal(Boolean(p.images?.length),model.endsWith('-i2i'));if(model.includes('-klein-')){assert.equal(p.metadata.steps,4);assert.equal(p.seed,42);assert.equal(p.output_format,'png');}
    }
    report.cases.push('Four Flux variants use exact model, no n and genuine local upload; Klein controls preserved');
    checkpoint('Muse image and Muse video');await run('muse','生成');await run('video','生成视频');
    const v=stats().posts.at(-1);assert.equal(v.model,'zhenzhen-video-muse');assert.equal(v.duration,10);assert.equal(v.resolution,'720p');assert.equal(v.audio,true);assert.equal(v.seed,undefined);
    assert.ok((await saved('video')).videoUrl.startsWith('/files/output/'));report.cases.push('Muse image/video use production routes, Run ledger and verified local results');
    checkpoint('save reload and bilingual themes');await page.reload();await hy.waitFor({timeout:120000});
    await until(async()=>(await saved('hy')).hyWidth===1280,'Custom settings not persisted');assert.equal((await saved('flux')).fluxImageSteps,4);
    for(const mode of ['light','dark'])for(const locale of ['zh-CN','en-US']){
      await page.evaluate(async({mode,locale})=>{(await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(mode);await(await import('/src/i18n/index.ts')).default.changeLanguage(locale);},{mode,locale});
      const control=hy.locator('[data-preview-image-controls]');assert.doesNotMatch(await control.innerText(),/previewMuseFlux:/);const filters=await control.evaluate(el=>{const all=[];for(let p=el;p;p=p.parentElement)all.push(getComputedStyle(p).filter);return all;});assert.ok(filters.every(v=>v==='none'));
    }
    report.cases.push('Save/reload retains settings and four language/theme combinations remain clear');await page.screenshot({path:path.join(evidence,'canvas-complete.png')});
    await quit(); await vite.close(); vite = null;
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), authorityBefore);
    report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'failure.png') }); } catch {} checkpoint('failed: ' + report.phase); throw error; }
  finally {
    try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = String(error.message); }
    await vite?.close(); require('esbuild').stop(); await pause(1000);
    fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2));
    fs.mkdirSync(path.join(evidence, 'attempts'), { recursive: true }); fs.writeFileSync(path.join(evidence, 'attempts', path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || 'unknown.json')), JSON.stringify(report, null, 2));
    if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-pmf-canvas-')) fs.rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write('Owned fixture retained: ' + scratch + '\n');
    if (!report.passed) process.exitCode = 1;
  }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { process.stderr.write(error.stack + '\n'); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
