'use strict';
// Real App/Canvas, fresh TEMP database, production routes and ledger. Only the
// external Provider boundary is replaced; this script never makes paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'local-private/h3-turbo-20261111');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const { withDeadline } = require('./history-acceptance-safety.cjs');
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function childMain() {
  const { app, BrowserWindow, session } = require('electron'), scratch = process.env.T8_H3_CANVAS_ROOT;
  assert.ok(scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-h3-canvas-'));
  app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
  const config = require('../backend/src/config'); assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch) + path.sep));
  for (const dir of [config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR, path.dirname(config.SETTINGS_FILE)]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenSd2ApiKey: 'h3-fixture-key' }));
  const picture = await require('sharp')({ create: { width: 128, height: 128, channels: 3, background: 'blue' } }).png().toBuffer();
  fs.writeFileSync(path.join(scratch, 'view.png'), picture);
  const videoCase = JSON.parse(fs.readFileSync(path.join(evidence, 'h3-text-private-local.json'), 'utf8'));
  const video = fs.readFileSync(videoCase.files[0]);
  const wav=Buffer.alloc(48044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);fs.writeFileSync(path.join(scratch,'tone.wav'),wav);
  const tasks=new Map(),files=new Map(),stats={posts:[],uploads:0,gets:0,downloads:0};
  const persist=()=>fs.writeFileSync(path.join(scratch,'fixture-stats.json'),JSON.stringify(stats));persist();
  const transport=async(url,init={})=>{
    assert.ok(String(url).startsWith('https://api.seedance.nz/'));
    if(String(url).endsWith('/v1/files/upload')){stats.uploads++;persist();return Response.json({url:'https://h3.example/input-'+stats.uploads+'.png'});}
    if(init.method==='POST'){const body=JSON.parse(init.body),id='fixture-'+(tasks.size+1);tasks.set(id,body);stats.posts.push(body);persist();assert.ok(String(url).endsWith(body.model==='minimax-h3-comfyui-max'?'/v1/video/generations':'/v1/image/generations'));return Response.json({task_id:id});}
    const id=String(url).split('/').at(-1),body=tasks.get(id);assert.ok(body);stats.gets++;persist();
    const isVideo=body.model==='minimax-h3-comfyui-max',format=body.metadata.output_format||'png';
    const result='https://h3.example/'+id+(isVideo?'.mp4':'.'+format);
    const buffer=isVideo?video:await require('sharp')(picture).toFormat(format).toBuffer();files.set(result,{buffer,contentType:isVideo?'video/mp4':'image/'+format});
    return Response.json({data:{model:body.model,status:'SUCCESS',result_url:result}});
  };
  const provider=require('../backend/src/providers/seedanceNz');
  for(const name of ['submitImageTask','queryImageTask','submitH3TurboVideoTask','queryH3TurboVideoTask']){const original=provider[name];provider[name]=(request,key,options)=>original(request,key,{...options,fetchImpl:transport,uploadIntervalMs:0});}
  require('../backend/src/utils/safeRemoteMediaFetch').safeRemoteMediaFetch=async(url,options)=>{assert.equal(options.trustedProviderOutput,true);const file=files.get(String(url));assert.ok(file);stats.downloads++;persist();return {...file,finalUrl:String(url),status:200};};
  const db = require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
  const node = (id, type, data, x) => ({ id, entityUid: crypto.randomUUID(), type, position: { x, y: 30 }, data });
  const {CASES,workflow}=require('./generate-h3-turbo-workflows.cjs');
  const nodes=[node('image','upload',{uploadType:'image',lockedUploadType:'image'},-420),node('audio','upload',{uploadType:'audio',lockedUploadType:'audio'},-420)],edges=[];
  for(const [index,[label,model,refs]]of CASES.entries()){
    const generated=workflow(label).nodes.find(node=>node.id==='generate');nodes.push(node('case'+index,generated.type,generated.data,index*440));
    if(refs)edges.push({id:'image-'+index,source:'image',target:'case'+index});
    if(refs&&generated.type==='video')edges.push({id:'audio-'+index,source:'audio',target:'case'+index});
  }
  nodes.find(node=>node.id==='audio').position.y=360;
  db.ensureCanvas(process.env.T8_H3_CANVAS_ID,{nodes,edges},require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
  const backend = require('../backend/src/server'); globalThis.ownedH3Backend = backend; await backend.serverStartPromise; await app.whenReady();
  const allowed = new Set([new URL(process.env.T8_H3_FRONTEND).origin, 'http://127.0.0.1:' + process.env.PORT]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => { const u = new URL(details.url); done({ cancel: !allowed.has(u.origin) && !['data:', 'blob:', 'devtools:'].includes(u.protocol) }); });
  globalThis.ownedH3Downloads = []; fs.mkdirSync(path.join(scratch, 'downloads'));
  session.defaultSession.on('will-download', (_event, item) => { const file = path.join(scratch, 'downloads', crypto.randomUUID()); item.setSavePath(file); item.once('done', (_event, state) => globalThis.ownedH3Downloads.push({ file, state })); });
  const win = new BrowserWindow({ show: false, width: 1360, height: 940, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); globalThis.ownedH3Window = win; await win.loadURL(process.env.T8_H3_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use the low-load runner, Mode H3TurboCanvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-h3-canvas-')), canvasId = 'tripo-' + crypto.randomUUID();
  const port = await freePort(), collabPort = await freePort(), origin = 'http://127.0.0.1:' + port;
  process.env.T8PC_DEV_BACKEND_ORIGIN = origin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  const authority = path.join(root, '.t8-collaboration-management-authority.json'), before = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  let vite, application, page, closed = false;
  const report = { passed: false, cases: [], errors: [], budget, boundary: 'Actual App/Canvas with fresh TEMP SQLite and production routes/ledger; deterministic Provider fixture, no paid calls, no installed-client evidence.' };
  fs.mkdirSync(evidence, { recursive: true }); const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); console.log(phase); };
  const read = async url => { const r = await fetch(origin + url), body = await r.json(); assert.equal(body.success, true, url); return body.data; };
  const saved = async id => (await read('/api/canvas/' + canvasId)).nodes.find(n => n.id === id).data;
  const until = async (fn, label, timeout = 90000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(200); } throw Error(label); };
  const quit = async () => { if (!application || closed) return; const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {}); await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedH3Window?.destroy(); await globalThis.ownedH3Backend.gracefulShutdown('h3-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned H3 shutdown'); await close; closed = true; };
  try {
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [coldHistoryFileWatcherPlugin()], server: { host: '127.0.0.1', port: 0, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial H3 App warmup');
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_H3_CANVAS_ROOT: scratch, T8_H3_CANVAS_ID: canvasId, T8_H3_FRONTEND: 'http://127.0.0.1:' + vite.httpServer.address().port, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'), T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token, ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE; delete env.SEEDANCE_NZ_API_KEY;
    application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 }); application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    const n = id => page.locator('.react-flow__node[data-id="' + id + '"]'); await n('case0').waitFor({ timeout: 120000 }); await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN'));
    const stats = () => JSON.parse(fs.readFileSync(path.join(scratch, 'fixture-stats.json'), 'utf8'));
    await n('case0').getByRole('spinbutton',{name:'Seed（-1 不传，0 有效）',exact:true}).waitFor();
    await n('image').locator('input[type=file]').first().setInputFiles(path.join(scratch,'view.png'));await until(async()=>Boolean((await saved('image')).imageUrl),'Image upload missing');
    await n('audio').locator('input[type=file]').first().setInputFiles(path.join(scratch,'tone.wav'));await until(async()=>Boolean((await saved('audio')).audioUrl),'Audio upload missing');
    await page.evaluate(()=>{window.__tripoRequests=[];window.addEventListener('t8:canvas-node-run-request',event=>{const d=event.detail,record={nodeId:d.nodeId};window.__tripoRequests.push(record);const prior=d.onSettled;d.onSettled=outcome=>{record.outcome=outcome;prior?.(outcome);};},{capture:true});});
    const run = async (id, name) => {
      console.log('running ' + id); await page.evaluate(() => document.activeElement?.blur()); await page.locator('.react-flow__pane').first().click({ position: { x: 30, y: 180 } }); await page.locator('.react-flow__controls-fitview').first().click(); await pause(3000);
      const count = stats().posts.length, previous = (await saved(id)).taskId, index = await page.evaluate(() => window.__tripoRequests.length); await n(id).getByRole('button', { name, exact: true }).click();
      await until(async () => { const modal = page.getByTestId('run-preflight-modal'); if (await modal.isVisible()) { await modal.getByRole('button', { name: '确认并继续', exact: true }).click(); return false; } const r = await page.evaluate(i => window.__tripoRequests[i], index); if (r?.outcome?.accepted === false) throw Error(r.outcome.error); return r?.outcome?.accepted === true; }, 'Run not accepted: ' + id, 120000);
      await until(async () => { const data = await saved(id); if (data.taskId !== previous && ['error','failed'].includes(data.status)) throw Error(data.error); return ['success','completed'].includes(data.status) && data.taskId !== previous && stats().posts.length === count + 1; }, 'Run did not complete: ' + id);
      await pause(1000);
    };
    checkpoint('three tabs, defaults and native controls');
    const first=n('case0');await first.locator('select').filter({has:page.locator('option[value="qwen-image-2.1-turbo"]')}).first().selectOption('qwen-image-2.1-turbo');
    await until(async()=>(await saved('case0')).model==='qwen-image-2.1-turbo','Qwen selection did not persist');
    assert.equal(await first.getByRole('combobox',{name:'原文件格式',exact:true}).count(),0);
    assert.equal(await first.getByRole('combobox',{name:'分辨率',exact:true}).inputValue(),'1k');
    await until(async()=>await first.getByRole('combobox',{name:'分辨率',exact:true}).locator('option[value="720p"]').evaluate(option=>option.disabled),'Qwen 720p option did not become disabled');
    await first.locator('select').filter({has:page.locator('option[value="minimax-h3-image"]')}).first().selectOption('minimax-h3-image');
    await first.getByRole('combobox',{name:'分辨率',exact:true}).selectOption('1k');
    await first.getByRole('combobox',{name:'原文件格式',exact:true}).selectOption('png');
    for(const value of ['9:16','1:3','1:1'])await first.getByRole('combobox',{name:'画面比例',exact:true}).selectOption(value);
    assert.equal(await n('case4').locator('input[type=number]').count(),0);
    report.cases.push('Three new categories, native seed/format, Qwen conditional 720p, model switching and continuous selection');
    for(let i=0;i<6;i++){await run('case'+i,i<4?'生成':'生成视频');const body=stats().posts.at(-1);assert.equal(body.model,require('./generate-h3-turbo-workflows.cjs').CASES[i][1]);
      assert.equal(body.seed,undefined);assert.equal(body.metadata.seed,i<4?0:undefined);assert.equal(body.n,undefined);
      if(i===1)assert.equal(body.metadata.output_format,'webp');if(i===3){assert.equal(body.metadata.resolution,'720p');assert.equal(body.metadata.output_format,undefined);}
      if(i>=4){assert.equal(body.seconds,'3');assert.equal(body.metadata.resolution,'480p');assert.equal(body.metadata.seed,undefined);}
      if(i===5){assert.equal(body.images.length,1);assert.equal(body.metadata.audio_urls.length,1);}
    }
    report.cases.push('Six full App production route/ledger runs, references uploaded, exact TaskDto query, native image/video download materialization');
    const count=await application.evaluate(()=>globalThis.ownedH3Downloads.length);await n('case1').getByRole('link',{name:'保存原文件',exact:true}).click();await until(async()=>await application.evaluate(()=>globalThis.ownedH3Downloads.length)>count,'Original download missing');
    await page.reload();await n('case0').getByRole('combobox',{name:'原文件格式',exact:true}).waitFor({timeout:120000});
    assert.equal((await saved('case1')).h3TurboFormat,'webp');assert.equal((await saved('case3')).sizeLevel,'720p');assert.equal((await saved('case5')).model,'minimax-h3-comfyui-max');
    for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){await page.evaluate(async({theme,language})=>{(await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(theme);await(await import('/src/i18n/index.ts')).default.changeLanguage(language);},{theme,language});for(const id of ['case0','case3','case5'])assert.doesNotMatch(await n(id).innerText(),/h3Turbo:/);}
    report.cases.push('Native original file save, persistence after refresh, light/dark and Chinese/English controls');
    report.stats = { posts: stats().posts.length, uploads: stats().uploads, gets: stats().gets, downloads: stats().downloads }; assert.equal(report.stats.posts, 6); await page.screenshot({ path: path.join(evidence, 'canvas-ui.png') }); await quit(); await vite.close(); vite = null; assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), before); report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'canvas-failure.png') }); } catch {} checkpoint('failed'); throw error; }
  finally { try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = error.message; } await vite?.close(); require('esbuild').stop(); await pause(1000); fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-h3-canvas-')) fs.rmSync(scratch, { recursive: true, force: true }); else console.error('Owned fixture retained: ' + scratch); if (!report.passed) process.exitCode = 1; }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { console.error(error.stack); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
