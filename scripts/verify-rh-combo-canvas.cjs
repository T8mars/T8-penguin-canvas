'use strict';
// Real App/Canvas and fresh TEMP storage. No provider generation is permitted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {withDeadline}=require('./history-acceptance-safety.cjs');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'local-private/issues-20261117'),fixture=require('../tests/fixtures/rh-issue30-combo-20261117.json');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function dependency(name){try{return require.resolve(name);}catch{return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES||'',name));}}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function childMain(){
 const {app,BrowserWindow,session}=require('electron'),scratch=process.env.T8_RH_COMBO_ROOT;
 assert.ok(scratch&&path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('t8-rh-combo-'));
 app.setPath('userData',path.join(scratch,'profile'));app.setPath('sessionData',path.join(scratch,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
 const config=require('../backend/src/config');assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch)+path.sep));
 fs.mkdirSync(path.dirname(config.SETTINGS_FILE),{recursive:true});fs.writeFileSync(config.SETTINGS_FILE,JSON.stringify({rhApiKey:'isolated-fixture-not-a-real-key'}));
 const nativeFetch=global.fetch,stats={externalAttempts:0};const persist=()=>fs.writeFileSync(path.join(scratch,'fixture-stats.json'),JSON.stringify(stats));persist();
 global.fetch=async(input,init)=>{const url=new URL(String(input));if(!['127.0.0.1','localhost'].includes(url.hostname)){stats.externalAttempts++;persist();return Response.json({error:'External network forbidden in this fixture'},{status:418});}return nativeFetch(input,init);};
 const db=require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
 const nodes=['runninghub','runninghub-wallet','runninghub'].map((type,index)=>({id:'case'+index,entityUid:crypto.randomUUID(),type,position:{x:index*440,y:30},data:{webappId:fixture.webappId,rhSite:'cn',appInfo:{webappId:fixture.webappId,rhSite:'cn',nodeInfoList:[fixture.field]},...(index===2?{paramValues:{'291::aspect_ratio':{value:'21:9'}}}:{})}}));
 db.ensureCanvas(process.env.T8_RH_COMBO_CANVAS,{nodes,edges:[]},require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
 const backend=require('../backend/src/server');globalThis.ownedRhBackend=backend;await backend.serverStartPromise;await app.whenReady();
 const allowed=new Set([new URL(process.env.T8_RH_COMBO_FRONTEND).origin,'http://127.0.0.1:'+process.env.PORT]);session.defaultSession.webRequest.onBeforeRequest((details,done)=>{const url=new URL(details.url);done({cancel:!allowed.has(url.origin)&&!['data:','blob:','devtools:'].includes(url.protocol)});});
 const window=new BrowserWindow({show:false,width:1360,height:940,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});globalThis.ownedRhWindow=window;await window.loadURL(process.env.T8_RH_COMBO_FRONTEND);
}
async function main(){
 assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD,'1','Use the low-load runner, Mode RhComboCanvas');
 const budget=require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget(),playwright=require(dependency('playwright')),loader=path.join(path.dirname(dependency('playwright-core')),'lib/server/electron/loader.js');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-rh-combo-')),canvasId='rh-combo-'+crypto.randomUUID(),port=await freePort(),collabPort=await freePort(),origin='http://127.0.0.1:'+port;
 process.env.T8PC_DEV_BACKEND_ORIGIN=origin;process.env.T8_ENABLE_LOCAL_PRIVATE='0';
 const authority=path.join(root,'.t8-collaboration-management-authority.json'),before=crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
 let vite,application,page,closed=false;const report={passed:false,cases:[],errors:[],budget,boundary:'Actual App/Canvas with fresh TEMP SQLite, captured real RH metadata, production select/save/run validation; all external calls blocked, no paid task or installed-client evidence.'};
 fs.mkdirSync(evidence,{recursive:true});const checkpoint=phase=>{report.phase=phase;fs.writeFileSync(path.join(evidence,'rh-canvas-ui.json'),JSON.stringify(report,null,2));console.log(phase);};
 const saved=async id=>{const r=await fetch(origin+'/api/canvas/'+canvasId),b=await r.json();assert.equal(b.success,true);return b.data.nodes.find(n=>n.id===id).data;};
 const until=async(fn,label,timeout=90000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;if(report.errors.length)throw Error(report.errors.join('\n'));await pause(200);}throw Error(label);};
 const quit=async()=>{if(!application||closed)return;const close=application.waitForEvent('close',{timeout:30000});void close.catch(()=>{});await withDeadline(()=>application.evaluate(async({app})=>{globalThis.ownedRhWindow?.destroy();await globalThis.ownedRhBackend.gracefulShutdown('rh-combo-verifier');setTimeout(()=>app.quit(),0);}),20000,'owned RH shutdown');await close;closed=true;};
 try{
  const {createServer}=await import('vite'),{coldHistoryFileWatcherPlugin,prepareSerialHistoryWarmup}=require('./history-serial-warmup.cjs');
  vite=await createServer({root,configFile:path.join(root,'vite.config.ts'),cacheDir:path.join(scratch,'node_modules/.vite'),plugins:[coldHistoryFileWatcherPlugin()],server:{host:'127.0.0.1',port:0,preTransformRequests:false,hmr:false,watch:null}});const warm=prepareSerialHistoryWarmup(vite);await vite.listen();checkpoint('warming App');await withDeadline(()=>warm.run(checkpoint),180000,'serial RH App warmup');
  const env={...process.env,PORT:String(port),HOST:'127.0.0.1',T8_COLLAB_PORT:String(collabPort),T8_RH_COMBO_ROOT:scratch,T8_RH_COMBO_CANVAS:canvasId,T8_RH_COMBO_FRONTEND:'http://127.0.0.1:'+vite.httpServer.address().port,T8PC_PACKAGED:'0',T8PC_DEV_DATA_ROOT:path.join(scratch,'data'),T8PC_DEV_PROJECT_DB_STORAGE_PROFILE:'acceptance-small-v1',T8_COLLAB_MANAGEMENT_TOKEN:JSON.parse(fs.readFileSync(authority,'utf8')).token,ZCANVAS_INSTANCE_DIR:path.join(scratch,'registry'),T8_FIGMA_BRIDGE_AUTOSTART:'0',T8_ENABLE_LOCAL_PRIVATE:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.T8_RH_READONLY_KEY;delete env.SEEDANCE_NZ_API_KEY;
  application=await playwright._electron.launch({executablePath:require('electron'),args:['--js-flags=--max-old-space-size=768','-r',loader,__filename,'--electron-child'],env,timeout:60000});application.on('close',()=>{closed=true;});page=await application.firstWindow();page.setDefaultTimeout(25000);page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Owned renderer crashed'));
  let submits=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/proxy/runninghub/submit')submits++;});
  await page.addLocatorHandler(page.locator('.t8-startup-poster__close'),button=>button.click());const node=id=>page.locator('.react-flow__node[data-id="'+id+'"]');await node('case0').waitFor({timeout:120000});await page.evaluate(async()=>(await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN'));
  const choices=JSON.parse(fixture.field.fieldData)[1].options,select=id=>node(id).locator('select').filter({has:page.locator('option[value="21:9 (Ultrawide)"]')}).first();
  checkpoint('real COMBO controls and persisted exact values');
  for(const id of ['case0','case1']){await select(id).waitFor();assert.deepEqual(await select(id).locator('option').allTextContents(),choices);for(const value of [choices[1],choices[7]]){await select(id).selectOption(value);await until(async()=>(await saved(id)).paramValues?.['291::aspect_ratio']?.value===value,'Exact selection was not saved');}}
  report.cases.push('RunningHub and wallet show all eight actual choices; continuous selection preserves full values');
  assert.equal(await select('case2').inputValue(),'21:9');assert.equal((await saved('case2')).paramValues['291::aspect_ratio'].value,'21:9');
  const runName=await page.evaluate(async()=>(await import('/src/i18n/index.ts')).default.t('nodes:runningHub.run'));await page.locator('.react-flow__controls-fitview').first().click();await node('case2').getByRole('button',{name:runName,exact:true}).click();
  await until(async()=>{const modal=page.getByTestId('run-preflight-modal');if(await modal.isVisible()){await modal.getByRole('button',{name:'确认并继续',exact:true}).click();return false;}return (await saved('case2')).status==='error';},'Invalid old enum was not blocked');assert.match((await saved('case2')).error,/291|aspect_ratio/);assert.equal(submits,0);
  report.cases.push('Old bare ratio remains unchanged and its real Run is rejected before any RH submission');
  await select('case2').selectOption(choices[7]);await until(async()=>(await saved('case2')).paramValues['291::aspect_ratio'].value===choices[7],'Old enum reselection missing');await page.reload();await select('case0').waitFor({timeout:120000});for(const id of ['case0','case1','case2'])assert.equal(await select(id).inputValue(),choices[7]);
  for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']){await page.evaluate(async({language,theme})=>{await(await import('/src/i18n/index.ts')).default.changeLanguage(language);(await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(theme);},{language,theme});for(const id of ['case0','case1'])assert.deepEqual(await select(id).locator('option').allTextContents(),choices);}
  report.cases.push('Reselection and refresh preserve exact strings; theme and UI language do not translate provider enums');
  const stats=JSON.parse(fs.readFileSync(path.join(scratch,'fixture-stats.json'),'utf8'));assert.equal(stats.externalAttempts,0);report.stats={submissions:submits,...stats};await page.screenshot({path:path.join(evidence,'rh-canvas-ui.png')});await quit();await vite.close();vite=null;assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'),before);report.passed=true;checkpoint('passed');
 }catch(e){report.failure=String(e.stack).slice(0,3000);if(page&&!page.isClosed())try{await page.screenshot({path:path.join(evidence,'rh-canvas-failure.png')});}catch{}checkpoint('failed');throw e;}
 finally{try{await quit();}catch(e){report.passed=false;report.shutdownFailure=e.message;}await vite?.close();require('esbuild').stop();await pause(1000);fs.writeFileSync(path.join(evidence,'rh-canvas-ui.json'),JSON.stringify(report,null,2));if(report.passed&&closed&&path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('t8-rh-combo-'))fs.rmSync(scratch,{recursive:true,force:true});else console.error('Owned fixture retained: '+scratch);if(!report.passed)process.exitCode=1;}
}
if(process.argv.includes('--electron-child'))childMain().catch(e=>{console.error(e.stack);require('electron').app.exit(1);});else if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
