'use strict';
// Full development App/Canvas + production routes/ledger/storage. Only the
// external Provider HTTP/media boundary is a deterministic fixture. No paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/kling-v4-20261027');
const { withDeadline } = require('./history-acceptance-safety.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_KLING_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-kling-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile'));
  app.on('window-all-closed', () => {}); app.disableHardwareAcceleration();
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const directory of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'motion-ui-fixture-key' }));
  const fixtureFile = path.join(scratch, 'fixture.mp4');
  require('node:child_process').execFileSync(require('../backend/src/providers/llmMedia').resolveBundledFfmpeg(),
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:r=12:d=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', fixtureFile], { windowsHide: true });
  const bytes = fs.readFileSync(fixtureFile), tasks = new Map();
  const voiceFile=path.join(scratch,'voice.wav');
  require('node:child_process').execFileSync(require('../backend/src/providers/llmMedia').resolveBundledFfmpeg(),['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1',voiceFile],{windowsHide:true});
  const voice=fs.readFileSync(voiceFile);
  const sharp=require('sharp');for(const [i,color] of ['red','blue'].entries())await sharp({create:{width:400,height:400,channels:3,background:color}}).png().toFile(path.join(config.INPUT_DIR,'view'+i+'.png'));
  fs.copyFileSync(voiceFile,path.join(config.INPUT_DIR,'voice.wav'));
  globalThis.motionFixture = { posts: [], gets: [], hold: false, fail: false, downloads: 0 };
  const persistFixture = () => fs.writeFileSync(path.join(scratch, 'fixture-stats.json'), JSON.stringify(globalThis.motionFixture));persistFixture();
  const transport = async (url, init = {}) => {
    if(String(url).endsWith('/v1/files/upload')) return new Response(JSON.stringify({data:{url:'https://kling.example/input-'+crypto.randomUUID()}}),{headers:{'content-type':'application/json'}});
    assert.ok(String(url).startsWith('https://api.seedance.nz/v1/video/generations'));
    if (init.method === 'POST') { const body = JSON.parse(init.body); globalThis.motionFixture.posts.push(body);const taskId='kling-fixture-'+(tasks.size+1);tasks.set(taskId,body);persistFixture();return new Response(JSON.stringify({data:{task_id:taskId}}),{headers:{'content-type':'application/json'}}); }
    const id=String(url).split('/').at(-1),body=tasks.get(id);assert.ok(body,'Only original accepted tasks may be queried');globalThis.motionFixture.gets.push(id);
    const controlFile=path.join(scratch,'fixture-control.json');if(fs.existsSync(controlFile))Object.assign(globalThis.motionFixture,JSON.parse(fs.readFileSync(controlFile,'utf8')));persistFixture();
    const status=globalThis.motionFixture.hold?'IN_PROGRESS':globalThis.motionFixture.fail?'FAILURE':'SUCCESS';
    const rows=body.model.endsWith('element')?[{name:'element_id',text:'element-'+id}]:[{name:'voice_id',text:'voice-'+id},{name:'trial_url',text:'https://kling.example/preview.wav'}];
    return new Response(JSON.stringify({data:{status,data:{status:status==='SUCCESS'?'succeeded':status.toLowerCase(),model:body.model,...(body.model.includes('custom-')?{result_text:JSON.stringify({results:rows})}:{content:{video_urls:['https://kling.example/result.mp4','https://kling.example/result.mp4']}})}}}),{headers:{'content-type':'application/json'}});
  };
  const provider=require('../backend/src/providers/seedanceNz');
  {const original=provider.submitKlingTask;provider.submitKlingTask=(request,key,options)=>original(request,key,{...options,fetchImpl:transport,uploadIntervalMs:0});}
  {const original=provider.queryKlingV4Task;provider.queryKlingV4Task=(id,model,key,options)=>original(id,model,key,{...options,fetchImpl:transport});}
  const remote=require('../backend/src/utils/safeRemoteMediaFetch');remote.safeRemoteMediaFetch=async url=>{assert.ok(['https://kling.example/result.mp4','https://kling.example/preview.wav'].includes(String(url)));globalThis.motionFixture.downloads++;const audio=String(url).endsWith('.wav');return{buffer:audio?voice:bytes,contentType:audio?'audio/wav':'video/mp4',finalUrl:String(url),status:200};};
  const db=require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const node=(id,model,x,data={})=>({id,entityUid:crypto.randomUUID(),type:'video',position:{x,y:30},data:{mainId:'kling-v3.0',model,videoBuiltinSource:'seedance-nz',providerSource:'zhenzhen',prompt:'A robot waves',klingV4Duration:3,klingV4Resolution:'720p',status:'idle',...data}});
  db.ensureCanvas(process.env.T8_KLING_CANVAS_ID,{nodes:[node('video','kling-v4-t2v',0),node('voice','kling-v4-custom-voice',430,{prompt:'',klingV4VoiceName:'RobotVoice',localRefAudios:['/files/input/voice.wav']}),node('element','kling-v4-custom-element',860,{prompt:'Red cube robot',klingV4ElementName:'Robot',localRefImages:['/files/input/view0.png','/files/input/view1.png']}),node('omni','kling-v4-omni',1290)],edges:[{id:'voice-omni',source:'voice',target:'omni'},{id:'element-omni',source:'element',target:'omni'}]},require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedMotionBackend = backend; globalThis.ownedMotionDatabase = db;
  await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_KLING_FRONTEND).origin, `http://127.0.0.1:${process.env.PORT}`]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const u = new URL(details.url); done({ cancel: !allowed.has(u.origin) && !['data:', 'blob:', 'devtools:'].includes(u.protocol) }); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  globalThis.ownedMotionWindow = win; await win.loadURL(process.env.T8_KLING_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1 -Mode KlingCanvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-kling-canvas-')), canvasId = 'motion-' + crypto.randomUUID();
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
    const env = { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_KLING_CANVAS_ROOT: scratch, T8_KLING_CANVAS_ID: canvasId,
      T8_KLING_FRONTEND: `http://127.0.0.1:${vite.httpServer.address().port}`, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'),
      T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token,
      ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
    checkpoint('launching isolated full App'); application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 });
    application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    await page.evaluate(async()=>{await(await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN');});
    const video=page.locator('.react-flow__node[data-id="video"]');await video.waitFor({timeout:120000});
    const stats=()=>JSON.parse(fs.readFileSync(path.join(scratch,'fixture-stats.json'),'utf8'));
    const saved=async id=>(await read('/api/canvas/'+canvasId)).nodes.find(n=>n.id===id).data;
    const run=async(id,name)=>{const n=page.locator('.react-flow__node[data-id="'+id+'"]');await n.getByRole('button',{name,exact:true}).click();await until(async()=>{const preflight=page.getByTestId('run-preflight-modal');if(await preflight.isVisible()){await preflight.getByRole('button',{name:'确认并继续',exact:true}).click();return true;}return(await saved(id)).status==='success'||stats().posts.length>0;},'No preflight/run');};
    checkpoint('video fields and submission in existing Kling node');
    const models=video.locator('select').filter({has:page.locator('option[value="kling-v4-i2v"]')});await models.selectOption('kling-v4-i2v');assert.equal(await video.locator('[data-kling-v4-controls]').getByLabel('比例',{exact:true}).count(),0);await models.selectOption('kling-v4-t2v');
    const controls=video.locator('[data-kling-v4-controls]');await controls.getByLabel('时长（3–30秒）',{exact:true}).fill('4');await controls.getByLabel('清晰度',{exact:true}).selectOption('1080p');await controls.getByLabel('水印',{exact:true}).selectOption('disabled');
    await run('video','生成视频');await until(async()=>(await saved('video')).status==='success','Video not completed');
    assert.equal(stats().posts[0].seconds,'4');assert.equal(stats().posts[0].metadata.resolution,'1080p');assert.equal(stats().posts[0].metadata.watermark,false);assert.equal((await saved('video')).videoUrls.length,2);
    report.cases.push('Existing VideoNode Kling selection and actual control edits produce exact v4 payload; all result slots saved');
    checkpoint('auxiliary results and chained Omni');
    await run('voice','创建并保存ID');await until(async()=>Boolean((await saved('voice')).klingV4Result?.voiceId),'Voice ID missing');assert.ok((await saved('voice')).klingV4Result.audioUrl.startsWith('/files/output/'));assert.equal((await saved('voice')).videoUrl,'');
    await run('element','创建并保存ID');await until(async()=>Boolean((await saved('element')).klingV4Result?.elementId),'Element ID missing');assert.equal((await saved('element')).videoUrl,'');
    const before=stats().posts.length;await run('omni','生成视频');await until(async()=>(await saved('omni')).status==='success','Omni not completed');
    const omni=stats().posts[before];assert.equal(omni.model,'kling-v4-omni');assert.equal(omni.metadata.elementIds.length,1);assert.equal(omni.metadata.voiceIds.length,1);assert.equal(omni.prompt,'A robot waves');
    report.cases.push('Real local uploads, text ID assets and preview audio materialization; ID connections reach Omni without description/JSON prompt leakage');
    checkpoint('stop and reload resume');
    fs.writeFileSync(path.join(scratch,'fixture-control.json'),JSON.stringify({hold:true}));await run('video','生成视频');await until(async()=>Boolean((await saved('video')).klingV4Pending),'Pending not persisted');
    await video.getByRole('button',{name:/停止/}).click();await until(async()=>!(await video.getByRole('button',{name:/停止/}).count()),'Stop failed');const posts=stats().posts.length;
    await page.reload();await video.waitFor({timeout:120000});await until(async()=>await video.getByRole('button',{name:'继续查询原任务',exact:true}).count()>0,'Resume action missing after reload');
    fs.writeFileSync(path.join(scratch,'fixture-control.json'),JSON.stringify({hold:false}));await run('video','继续查询原任务');await until(async()=>(await saved('video')).status==='success'&&!(await saved('video')).klingV4Pending,'Resume did not complete');assert.equal(stats().posts.length,posts);
    report.cases.push('Stop/save/reload retains original task; resume uses GET only with no additional POST');
    checkpoint('themes and locale');let combinations=0;
    for(const mode of ['light','dark'])for(const locale of ['zh-CN','en-US']){await page.evaluate(async({mode,locale})=>{(await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(mode);await(await import('/src/i18n/index.ts')).default.changeLanguage(locale);},{mode,locale});const inspected=await controls.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,filter:getComputedStyle(el).filter,text:el.textContent}));assert.notEqual(inspected.bg,'rgba(0, 0, 0, 0)');assert.notEqual(inspected.bg,inspected.color);assert.equal(inspected.filter,'none');assert.doesNotMatch(inspected.text,/klingV4:/);combinations++;}
    report.cases.push(combinations+' actual theme/language combinations');await page.screenshot({path:path.join(evidence,'canvas-complete.png')});
    await quit(); await vite.close(); vite = null;
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), authorityBefore);
    report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'failure.png') }); } catch {} checkpoint('failed: ' + report.phase); throw error; }
  finally {
    try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = String(error.message); }
    await vite?.close(); require('esbuild').stop(); await pause(1000);
    fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2));
    fs.mkdirSync(path.join(evidence, 'attempts'), { recursive: true }); fs.writeFileSync(path.join(evidence, 'attempts', path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || 'unknown.json')), JSON.stringify(report, null, 2));
    if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-kling-canvas-')) fs.rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write('Owned fixture retained: ' + scratch + '\n');
    if (!report.passed) process.exitCode = 1;
  }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { process.stderr.write(error.stack + '\n'); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
