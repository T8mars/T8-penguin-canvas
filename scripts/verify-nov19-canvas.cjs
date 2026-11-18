'use strict';
// Real App/Canvas, fresh TEMP database, production routes and ledger. Only the
// external Provider boundary is replaced; this script never makes paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/kling-mai-qwen-20261119');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const { withDeadline } = require('./history-acceptance-safety.cjs');
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_NOV19_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-nov19-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const dir of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'h3-fixture-key' }));

  const picture=await require('sharp')({create:{width:512,height:512,channels:3,background:'blue'}}).png().toBuffer();fs.writeFileSync(path.join(scratch,'view.png'),picture);
  const {wrapPcm16Wav}=require('../backend/src/utils/pcmAudio'),pcm=Buffer.alloc(192000);for(let i=0;i<48000;i++){const v=Math.round(5000*Math.sin(i*Math.PI*880/48000));pcm.writeInt16LE(v,i*4);pcm.writeInt16LE(v,i*4+2);}const wav=wrapPcm16Wav(pcm,48000,2);fs.writeFileSync(path.join(scratch,'tone.wav'),wav);
  const tasks=new Map(),files=new Map(),stats={posts:[],uploads:0,gets:0,downloads:0};const persist=()=>fs.writeFileSync(path.join(scratch,'fixture-stats.json'),JSON.stringify(stats));persist();
  const transport=async(url,init={})=>{
    assert.ok(String(url).startsWith('https://api.seedance.nz/'));
    if(String(url).endsWith('/v1/files/upload')){stats.uploads++;persist();return Response.json({url:'https://nov19.example/input-'+stats.uploads});}
    if(init.method==='POST'){const body=JSON.parse(init.body),id='fixture-'+(tasks.size+1);tasks.set(id,body);stats.posts.push(body);persist();assert.ok(String(url).endsWith(body.model.startsWith('qwen-')?'/v1/audio/generations':'/v1/image/generations'));return Response.json({task_id:id});}
    const id=String(url).split('/').at(-1),body=tasks.get(id);assert.ok(body);stats.gets++;persist();const audio=body.model.startsWith('qwen-'),count=audio?1:body.sequential_image_generation==='auto'?body.sequential_image_generation_options.max_images:body.n||1;
    const urls=Array.from({length:count},(_,i)=>'https://nov19.example/'+id+'-'+i+(audio?body.metadata.format==='pcm'?'.pcm':'.wav':'.png'));
    for(const u of urls)files.set(u,{buffer:audio?body.metadata.format==='pcm'?pcm:wav:picture,contentType:audio?body.metadata.format==='pcm'?'application/octet-stream':'audio/wav':'image/png'});
    return Response.json({data:{model:body.model,status:'SUCCESS',data:{content:audio?{audio_urls:urls}:{image_urls:urls}}}});
  };
  const provider=require('../backend/src/providers/seedanceNz');for(const name of ['submitImageTask','queryImageTask','submitAudioTask','queryAudioTask']){const original=provider[name];assert.equal(typeof original,'function',name);provider[name]=(request,key,options)=>original(request,key,{...options,fetchImpl:transport,uploadIntervalMs:0});}
  require('../backend/src/utils/safeRemoteMediaFetch').safeRemoteMediaFetch=async(url,options)=>{assert.equal(options.trustedProviderOutput,true);const file=files.get(String(url));assert.ok(file);stats.downloads++;persist();return {...file,finalUrl:String(url),status:200};};
  const db=require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const node=(id,type,data,x,y=30)=>({id,entityUid:crypto.randomUUID(),type,position:{x,y},data});
  const {CASES,workflow}=require('./generate-nov19-workflows.cjs');
  const nodes=[node('image','upload',{uploadType:'image',lockedUploadType:'image'},-440),node('audio','upload',{uploadType:'audio',lockedUploadType:'audio'},-440,480)],edges=[];
  for(const [i,item]of CASES.entries()){const w=workflow(item);nodes.push(node('case'+i,item.audio?'audio':'image',w.nodes.find(n=>n.id==='generate').data,i*460));if(item.references)edges.push({id:'ref-'+i,source:item.audio?'audio':'image',target:'case'+i});}
  nodes.push(node('legacyMai','image',{model:'mai-image-2-6',apiModel:'mai-image-2-6',imageBuiltinSource:'seedance-nz',maiAutoAspectRatio:true,maiWebGrounding:true},0,1500));
  nodes.push(node('legacyQwen','audio',{audioProviderMode:'qwen3-tts',qwenTtsModel:'qwen3-tts-flash',qwenTtsVoice:'Cherry'},460,1500));
  db.ensureCanvas(process.env.T8_NOV19_CANVAS_ID,{nodes,edges},require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedNov19Backend = backend; await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_Nov19_FRONTEND).origin, 'http://127.0.0.1:' + process.env.PORT]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const u = new URL(details.url); done({ cancel: !allowed.has(u.origin) && !['data:', 'blob:', 'devtools:'].includes(u.protocol) }); });
  globalThis.ownedNov19Downloads = []; fs.mkdirSync(path.join(scratch, 'downloads'));
  session.defaultSession.on('will-download', (_event, item) => { const file = path.join(scratch, 'downloads', crypto.randomUUID()); item.setSavePath(file); item.once('done', (_event, state) => globalThis.ownedNov19Downloads.push({ file, state })); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); globalThis.ownedNov19Window = win; await win.loadURL(process.env.T8_Nov19_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use the low-load runner, Mode Nov19Canvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-nov19-canvas-')), canvasId = 'tripo-' + crypto.randomUUID();
  const port = await freePort(), collabPort = await freePort(), origin = 'http://127.0.0.1:' + port;
  process.env.T8PC_DEV_BACKEND_ORIGIN = origin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  const authority = path.join(root, '.t8-collaboration-management-authority.json'), before = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  let vite, application, page, closed = false;
  const report = { passed: false, cases: [], errors: [], budget, boundary: 'Actual App/Canvas with fresh TEMP SQLite and production routes/ledger; deterministic Provider fixture, no paid calls, no installed-client evidence.' };
  fs.mkdirSync(evidence, { recursive: true }); const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); console.log(phase); };
  const read = async url => { const r = await fetch(origin + url), body = await r.json(); assert.equal(body.success, true, url); return body.data; };
  const saved = async id => (await read('/api/canvas/' + canvasId)).nodes.find(n => n.id === id).data;
  const until = async (fn, label, timeout = 90000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(200); } throw Error(label); };
  const quit = async () => { if (!application || closed) return; const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {}); await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedNov19Window?.destroy(); await globalThis.ownedNov19Backend.gracefulShutdown('h3-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned Nov19 shutdown'); await close; closed = true; };
  try {
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin()], server: { host: '127.0.0.1', port: 0, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial Nov19 App warmup');
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_NOV19_CANVAS_ROOT: scratch, T8_NOV19_CANVAS_ID: canvasId, T8_Nov19_FRONTEND: 'http://127.0.0.1:' + vite.httpServer.address().port, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'), T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token, ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE; delete env.SEEDANCE_NZ_API_KEY;
    application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 }); application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    const n = id => page.locator('.react-flow__node[data-id="' + id + '"]'); await n('case0').waitFor({ timeout: 120000 }); await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN'));
    const stats = () => JSON.parse(fs.readFileSync(path.join(scratch, 'fixture-stats.json'), 'utf8'));

    await n('case0').getByRole('combobox',{name:'生成模式',exact:true}).waitFor();
    await n('image').locator('input[type=file]').first().setInputFiles(path.join(scratch,'view.png'));await until(async()=>Boolean((await saved('image')).imageUrl),'Image upload missing');
    await n('audio').locator('input[type=file]').first().setInputFiles(path.join(scratch,'tone.wav'));await until(async()=>Boolean((await saved('audio')).audioUrl),'Audio upload missing');
    await page.evaluate(()=>{window.__nov19Requests=[];window.addEventListener('t8:canvas-node-run-request',event=>{const d=event.detail,record={nodeId:d.nodeId};window.__nov19Requests.push(record);const prior=d.onSettled;d.onSettled=outcome=>{record.outcome=outcome;prior?.(outcome);};},{capture:true});});
    const run=async(id,name)=>{await page.evaluate(()=>document.activeElement?.blur());await page.locator('.react-flow__pane').first().click({position:{x:30,y:180}});await page.locator('.react-flow__controls-fitview').first().click();await pause(2000);const count=stats().posts.length,index=await page.evaluate(()=>window.__nov19Requests.length);await n(id).getByRole('button',{name,exact:true}).click();
      await until(async()=>{const modal=page.getByTestId('run-preflight-modal');if(await modal.isVisible()){await modal.getByRole('button',{name:'确认并继续',exact:true}).click();return false;}const r=await page.evaluate(i=>window.__nov19Requests[i],index);if(r?.outcome?.accepted===false)throw Error(r.outcome.error);return r?.outcome?.accepted===true;},'Run not accepted '+id,120000);
      await until(async()=>{const d=await saved(id);if(['error','failed'].includes(d.status))throw Error(d.error);return ['success','completed'].includes(d.status)&&stats().posts.length===count+1;},'Run incomplete '+id);await pause(500);};
    checkpoint('model selection and event handlers');
    const dropdown=(id,model)=>n(id).locator('select').filter({has:page.locator('option[value="'+model+'"]')}).first();
    await n('case0').getByRole('spinbutton',{name:'图片数量',exact:true}).fill('2');await n('case0').getByRole('combobox',{name:'分辨率',exact:true}).selectOption('4k');await n('case0').getByRole('combobox',{name:'分辨率',exact:true}).selectOption('2k');
    await until(async()=>(await saved('case0')).klingImageCount===2,'Kling count not saved');
    for(const model of ['mai-image-2-7-flash','mai-image-2-7']){await dropdown('case3',model).selectOption(model);await until(async()=>(await saved('case3')).apiModel===model,'Mai selection not saved');}
    assert.equal(await n('case3').locator('option[value="auto"]').count(),1); // background only, no auto size
    assert.equal(await n('case7').getByRole('combobox',{name:'系统音色',exact:true}).locator('option').count(),69);assert.equal(await n('case9').getByRole('combobox',{name:'系统音色',exact:true}).locator('option').count(),4);assert.equal(await n('case8').getByRole('combobox',{name:'系统音色',exact:true}).count(),0);
    await n('case7').getByRole('combobox',{name:'音频格式',exact:true}).selectOption('opus');await until(async()=>(await saved('case7')).qwenAudio31Params.sample_rate==='24000','Opus rate not repaired');await n('case7').getByRole('combobox',{name:'音频格式',exact:true}).selectOption('wav');
    await n('case1').getByRole('spinbutton',{name:'图片数量',exact:true}).fill('2');await until(async()=>(await saved('case1')).klingImageCount===2,'Reference batch count not saved');
    report.cases.push('Kling count/resolution changes, Mai 2.7 options, exact 69/4 voices, Next reference UI, Opus compatible rate');
    for(const i of [0,1,2,3,4,5,6,7,8,9,10]){checkpoint('running case'+i);await run('case'+i,i>=7?'生成音频':'生成');const b=stats().posts.at(-1),d=await saved('case'+i);assert.equal(b.model,i>=7?d.qwenTtsModel:d.apiModel);if(i<=2){assert.equal(d.imageUrls.length,2);if(i===2){assert.equal(b.n,undefined);assert.equal(b.sequential_image_generation_options.max_images,2);}}if(i===10){assert.equal(b.metadata.channels,'2');assert.equal(b.metadata.format,'pcm');assert.equal(b.metadata.audio_urls.length,1);assert.ok(d.audioUrl);}if(i===4||i===6){assert.equal(b.width,undefined);assert.equal(b.size,undefined);assert.equal(b.web_grounding,undefined);}}
    report.cases.push('Eleven workflow paths through actual nodes, routes, uploads, ledger, GET polling and shared materialization; Kling all outputs and Next stereo PCM');
    const pcmData=await saved('case10'),audioReply=await fetch(origin+pcmData.audioUrl),audioBytes=Buffer.from(await audioReply.arrayBuffer());assert.equal(audioBytes.toString('ascii',0,4),'RIFF');assert.equal(audioBytes.readUInt16LE(22),2);assert.equal(audioBytes.readUInt32LE(24),48000);
    await page.reload();await n('case0').getByRole('combobox',{name:'生成模式',exact:true}).waitFor({timeout:120000});assert.equal((await saved('case0')).klingImageCount,2);assert.equal((await saved('legacyMai')).maiWebGrounding,true);assert.equal((await saved('legacyMai')).maiAutoAspectRatio,true);assert.equal((await saved('legacyQwen')).qwenTtsModel,'qwen3-tts-flash');assert.equal((await saved('legacyQwen')).audioProviderMode,'qwen3-tts');
    for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){await page.evaluate(async({theme,language})=>{(await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(theme);await(await import('/src/i18n/index.ts')).default.changeLanguage(language);},{theme,language});for(const id of ['case0','case3','case7','case8','case9'])assert.doesNotMatch(await n(id).innerText(),/nov19:/);}
    report.cases.push('Save/reload preserves controls and legacy Qwen/Mai choices; Chinese/English, light/dark');
    report.stats={posts:stats().posts.length,uploads:stats().uploads,gets:stats().gets,downloads:stats().downloads};assert.equal(report.stats.posts,11);await page.screenshot({path:path.join(evidence,'canvas-ui.png')});await quit();await vite.close();vite=null;assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'),before);report.passed=true;checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'canvas-failure.png') }); } catch {} checkpoint('failed'); throw error; }
  finally { try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = error.message; } await vite?.close(); require('esbuild').stop(); await pause(1000); fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-nov19-canvas-')) fs.rmSync(scratch, { recursive: true, force: true }); else console.error('Owned fixture retained: ' + scratch); if (!report.passed) process.exitCode = 1; }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { console.error(error.stack); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
