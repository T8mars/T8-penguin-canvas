'use strict';
// Actual App/Canvas/CAS backend and fresh SQLite. A controlled close bridge
// invokes the production Canvas close callback; native IPC is tested separately.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{withDeadline}=require('./history-acceptance-safety.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dependency=name=>{try{return require.resolve(name);}catch{return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES||'',name));}};
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function childMain(){
 const {app,BrowserWindow,session}=require('electron'),scratch=process.env.T8_SAVE_FIXTURE_ROOT;
 assert.ok(path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('t8-canvas-save-'));
 fs.mkdirSync(path.join(scratch,'profile'),{recursive:true});
 app.setPath('userData',path.join(scratch,'profile'));app.setPath('sessionData',path.join(scratch,'profile'));app.on('window-all-closed',()=>{});app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');
 require('./history-acceptance-safety.cjs').installRendererExitRecorder(app,record=>fs.appendFileSync(path.join(scratch,'renderer-exits.jsonl'),JSON.stringify(record)+'\n'));
 const config=require('../backend/src/config');assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch)+path.sep));
 fs.mkdirSync(path.dirname(config.SETTINGS_FILE),{recursive:true});fs.writeFileSync(config.SETTINGS_FILE,JSON.stringify({canvasAutoSavePath:path.join(scratch,'mirrors'),autoSavePath:path.join(scratch,'outputs'),resourceLibraryPath:path.join(scratch,'resources')}));
 const db=require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
 for(const id of JSON.parse(process.env.T8_SAVE_FIXTURE_IDS))db.ensureCanvas(id,{name:'Synthetic save '+id,nodes:[{id:'text-1',entityUid:crypto.randomUUID(),type:'text',position:{x:80,y:80},data:{prompt:'BASE'}}],edges:[]},require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
 const allowed=new Set([process.env.T8_SAVE_FIXTURE_FRONTEND,`http://127.0.0.1:${process.env.PORT}`]);
 const nativeFetch=globalThis.fetch;globalThis.ownedSaveExternalRequests=0;
 globalThis.fetch=(url,init)=>{if(!allowed.has(new URL(String(url)).origin)){globalThis.ownedSaveExternalRequests++;throw Error('External request forbidden in save verifier');}return nativeFetch(url,init);};
 const backend=require('../backend/src/server');globalThis.ownedSaveBackend=backend;await backend.serverStartPromise;await app.whenReady();
 session.defaultSession.webRequest.onBeforeRequest((details,done)=>{const url=new URL(details.url);done({cancel:!allowed.has(url.origin)&&!['data:','blob:','devtools:'].includes(url.protocol)});});
 globalThis.ownedSaveDownloads=[];fs.mkdirSync(path.join(scratch,'downloads'),{recursive:true});
 session.defaultSession.on('will-download',(_event,item)=>{const file=path.join(scratch,'downloads',crypto.randomUUID()+'.json');item.setSavePath(file);item.once('done',(_event,state)=>globalThis.ownedSaveDownloads.push({file,state}));});
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});globalThis.ownedSaveWindow=win;await win.loadURL(process.env.T8_SAVE_FIXTURE_FRONTEND);globalThis.ownedSaveInitialLoad=true;
}
async function main(){
 assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD,'1','Use run-history-low-load.ps1 -Mode CanvasSave');
 const budget=require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
 const cp=require('node:child_process'),originalSpawn=cp.spawn,helpers=[],helperClosed=[];
 cp.spawn=function(...args){const child=originalSpawn.apply(this,args),item={name:path.basename(String(args[0])),pid:child.pid,closed:false};helpers.push(item);helperClosed.push(new Promise(r=>child.once('close',(code,signal)=>{Object.assign(item,{closed:true,code,signal});r();})));return child;};
 const playwright=require(dependency('playwright')),loader=path.join(path.dirname(dependency('playwright-core')),'lib/server/electron/loader.js');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-canvas-save-')),ids=['sync','conflict','offscreen','other'].map(x=>'save-'+x+'-'+crypto.randomUUID());
 const evidence=path.join(root,'local-private/canvas-save-conflict-20261019',path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT||'unknown','.json'));fs.mkdirSync(evidence,{recursive:true});
 const authority=path.join(root,'.t8-collaboration-management-authority.json'),authorityBefore=crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
 const port=await freePort(),collabPort=await freePort(),origin=`http://127.0.0.1:${port}`;
 process.env.T8PC_DEV_BACKEND_ORIGIN=origin;process.env.T8_ENABLE_LOCAL_PRIVATE='0';
 let vite,application,page,closed=false,releasePut,releaseRead;
 const report={passed:false,cases:[],errors:[],budget,runnerReceipt:process.env.T8_ACCEPTANCE_RUNNER_RECEIPT,boundary:'Full development App/Canvas, real HTTP CAS and fresh temporary SQLite; controlled close bridge, not native installed-client IPC or the affected user database.'};
 const checkpoint=phase=>{report.phase=phase;fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));process.stdout.write(phase+'\n');};
 const until=async(check,label,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;if(report.errors.length)throw Error(report.errors.join('\n'));await pause(100);}throw Error(label);};
 const read=async id=>{const r=await fetch(origin+'/api/canvas/'+id),body=await r.json();assert.equal(body.success,true);return body.data;};
 const remoteEdit=async(id,change)=>{const doc=await read(id);change(doc);const r=await fetch(origin+'/api/canvas/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...doc,baseRevision:doc.revision})});assert.equal(r.status,200);};
 const select=async id=>{await page.evaluate(async id=>(await import('/src/stores/canvas.ts')).useCanvasStore.getState().setActive(id),id);await until(()=>page.locator('.react-flow__node[data-id=text-1] [contenteditable=true]').count(),'Text input not rendered');await until(()=>page.locator('.t8-sidebar-node[data-canvas-node-ready=true]').count().then(n=>n>0),'Canvas not ready');await pause(1200);};
 const input=()=>page.locator('.react-flow__node[data-id=text-1] [contenteditable=true]').first();
 const edit=async text=>{await input().fill(text);await input().press('Tab');};
 const notice=()=>page.locator('[data-canvas-save-conflict=true]');
 const race=async(id,text,remoteChange,beforeRelease)=>{
  let held=false;releasePut=null;
  const route=async route=>{if(route.request().method()==='PUT'&&!held){held=true;await new Promise(r=>{releasePut=r;});await route.continue();}else await route.fallback();};
  await page.route('**/api/canvas/'+id,route);await edit(text);await until(()=>!!releasePut,'CAS request not intercepted');await remoteEdit(id,remoteChange);await beforeRelease?.();releasePut();releasePut=null;
  await until(()=>page.locator('[data-canvas-save-conflict=true]').count().then(Boolean).catch(()=>false),'Temporary conflict never observed',10000).catch(()=>{});
  await page.unroute('**/api/canvas/'+id,route);
 };
 const closeReceipt=async()=>{const result=await page.evaluate(async()=>window.ownedSaveClose());await page.evaluate(()=>window.ownedSaveCancel());await until(()=>page.locator('#root').evaluate(root=>!root.inert),'Close hold not released');return result;};
 const quit=async()=>{if(!application||closed)return;const done=application.waitForEvent('close',{timeout:30000});void done.catch(()=>{});await withDeadline(()=>application.evaluate(async({app})=>{globalThis.ownedSaveWindow?.destroy();await globalThis.ownedSaveBackend.gracefulShutdown('save-verifier');setTimeout(()=>app.quit(),0);}),20000,'owned save shutdown');await done;closed=true;};
 try{
  const {createServer}=await import('vite'),{coldHistoryFileWatcherPlugin,prepareSerialHistoryWarmup}=require('./history-serial-warmup.cjs');
  vite=await createServer({root,configFile:path.join(root,'vite.config.ts'),cacheDir:path.join(scratch,'node_modules/.vite'),plugins:[coldHistoryFileWatcherPlugin()],server:{host:'127.0.0.1',port:0,strictPort:false,preTransformRequests:false,hmr:false,watch:null}});
  const warmup=prepareSerialHistoryWarmup(vite);await vite.listen();checkpoint('warming actual App');await withDeadline(()=>warmup.run(checkpoint),180000,'save UI warmup');
  const frontend=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const env={...process.env,PORT:String(port),HOST:'127.0.0.1',T8_COLLAB_PORT:String(collabPort),T8_SAVE_FIXTURE_ROOT:scratch,T8_SAVE_FIXTURE_IDS:JSON.stringify(ids),T8_SAVE_FIXTURE_FRONTEND:frontend,T8PC_PACKAGED:'0',T8PC_DEV_DATA_ROOT:path.join(scratch,'data'),T8PC_DEV_PROJECT_DB_STORAGE_PROFILE:'acceptance-small-v1',T8_COLLAB_MANAGEMENT_TOKEN:JSON.parse(fs.readFileSync(authority,'utf8')).token,ZCANVAS_INSTANCE_DIR:path.join(scratch,'registry'),T8_FIGMA_BRIDGE_AUTOSTART:'0',T8_ENABLE_LOCAL_PRIVATE:'0'};delete env.ELECTRON_RUN_AS_NODE;
  report.sourceHashes=Object.fromEntries(['src/components/Canvas.tsx','src/utils/canvasSaveRecovery.ts','src/utils/canvasPatchMerge.ts','src/components/CanvasSaveConflictNotice.tsx','src/components/CanvasCloseGuard.tsx'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
  checkpoint('launch isolated full canvas');application=await playwright._electron.launch({executablePath:require('electron'),args:['--js-flags=--max-old-space-size=768','-r',loader,__filename,'--electron-child'],env,timeout:60000});application.on('close',()=>{closed=true;});page=await application.firstWindow();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Owned renderer crashed'));
  await until(()=>application.evaluate(()=>globalThis.ownedSaveInitialLoad===true),'Initial navigation incomplete',60000);
  await page.addInitScript(()=>{let callback,cancelled=false;window.t8pc={onCanvasCloseRequest:cb=>{callback=cb;return()=>{callback=null;};}};window.ownedSaveClose=async()=>{cancelled=false;if(!callback)throw Error('Actual Canvas close handler missing');return callback(()=>cancelled);};window.ownedSaveCancel=()=>{cancelled=true;};});await page.reload();
  await page.addLocatorHandler(page.locator('.t8-startup-poster__close'),async button=>button.click());
  await until(()=>page.locator('.t8-sidebar-node[data-canvas-node-ready=true]').count().then(n=>n>0),'App not ready',120000);
  await select(ids[0]);checkpoint('disjoint remote write and local edit use real CAS 409');
  await race(ids[0],'LOCAL_DISJOINT',doc=>{doc.nodes[0].data.remoteMarker='REMOTE_RESULT';});
  await until(async()=>{const doc=await read(ids[0]);return doc.nodes[0].data.prompt==='LOCAL_DISJOINT'&&doc.nodes[0].data.remoteMarker==='REMOTE_RESULT';},'Disjoint changes not persisted');assert.equal(await notice().count(),0);assert.equal((await closeReceipt()).ok,true);report.cases.push('real CAS 409 automatically merges local text and remote result','close waits for confirmed save without a false permanent conflict');
  await select(ids[1]);checkpoint('real same-field conflict, export and explicit confirmation');
  await race(ids[1],'LOCAL_CONFLICT',doc=>{doc.nodes[0].data.prompt='REMOTE_CONFLICT';doc.nodes[0].data.remoteMarker='KEEP_REMOTE';});await notice().waitFor();
  assert.equal((await read(ids[1])).nodes[0].data.prompt,'REMOTE_CONFLICT');assert.equal(await input().innerText(),'LOCAL_CONFLICT');assert.equal((await closeReceipt()).reason,'conflict');
  await notice().getByRole('button',{name:'下载本地副本',exact:true}).click();await until(()=>application.evaluate(()=>globalThis.ownedSaveDownloads.length>0),'Native Electron download not completed');const download=await application.evaluate(()=>globalThis.ownedSaveDownloads[0]);assert.equal(download.state,'completed');assert.ok(path.resolve(download.file).startsWith(path.resolve(scratch)+path.sep));const copy=JSON.parse(fs.readFileSync(download.file,'utf8'));assert.equal(copy.nodes[0].data.prompt,'LOCAL_CONFLICT');
  await notice().getByRole('button',{name:'采用服务端版本',exact:true}).click();await notice().getByRole('button',{name:'取消',exact:true}).click();assert.equal(await input().innerText(),'LOCAL_CONFLICT');
  await notice().getByRole('button',{name:'保留本地修改并合并保存',exact:true}).click();
  let heldRead=false;const holdRead=async route=>{if(route.request().method()==='GET'&&!heldRead){heldRead=true;await new Promise(r=>{releaseRead=r;});}await route.continue();};
  await page.route('**/api/canvas/'+ids[1],holdRead);await notice().getByRole('button',{name:'确认处理',exact:true}).click();await until(()=>!!releaseRead,'Resolution GET not held');await edit('LOCAL_AFTER_CONFIRM');releaseRead();releaseRead=null;
  await until(async()=>{const doc=await read(ids[1]);return doc.nodes[0].data.prompt==='LOCAL_AFTER_CONFIRM'&&doc.nodes[0].data.remoteMarker==='KEEP_REMOTE';},'Explicit merge lost edits made during its authority GET');await page.unroute('**/api/canvas/'+ids[1],holdRead);await notice().waitFor({state:'hidden'});assert.equal((await closeReceipt()).ok,true);report.cases.push('same-field remote value never silently overwritten','close blocks true conflict','local copy contains unsaved edits','server choice requires confirmation and cancellation keeps local','explicit local resolution preserves disjoint remote fields','edits during resolution GET are preserved and subsequently CAS-saved');
  checkpoint('recovery GET failure and explicit safe retry');
  let failedReads=0;const failRead=async route=>{if(route.request().method()==='GET'){failedReads++;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'Synthetic offline read'})});}else await route.continue();};
  await page.route('**/api/canvas/'+ids[1],failRead);await race(ids[1],'LOCAL_OFFLINE',doc=>{doc.nodes[0].data.remoteMarker='REMOTE_OFFLINE';});await until(()=>failedReads>0,'Failed GET not reached');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await notice().waitFor();assert.equal((await read(ids[1])).nodes[0].data.prompt,'LOCAL_AFTER_CONFIRM');await page.unroute('**/api/canvas/'+ids[1],failRead);
  await notice().getByRole('button',{name:'同步最新并重试',exact:true}).click();await until(async()=>{const doc=await read(ids[1]);return doc.nodes[0].data.prompt==='LOCAL_OFFLINE'&&doc.nodes[0].data.remoteMarker==='REMOTE_OFFLINE';},'Retry did not preserve both sides');await notice().waitFor({state:'hidden'});report.cases.push('failed recovery GET retains unsaved content','explicit retry safely reconciles after connection returns');
  await select(ids[2]);checkpoint('off-screen conflict remains reachable from close');
  await race(ids[2],'OFFSCREEN_LOCAL',doc=>{doc.nodes[0].data.prompt='OFFSCREEN_REMOTE';},()=>select(ids[3]));
  assert.equal((await closeReceipt()).reason,'conflict');await until(()=>input().innerText().then(t=>t==='OFFSCREEN_LOCAL'),'Close did not return to the conflicted canvas');await notice().waitFor();
  await notice().getByRole('button',{name:'采用服务端版本',exact:true}).click();await notice().getByRole('button',{name:'确认处理',exact:true}).click();await notice().waitFor({state:'hidden'});assert.equal(await input().innerText(),'OFFSCREEN_REMOTE');assert.equal((await closeReceipt()).ok,true);report.cases.push('closing another canvas returns to the real off-screen conflict','explicit server resolution and close succeed');
  checkpoint('off-screen disjoint rebase resumes the ordinary activation and CAS queue before close');
  await race(ids[2],'OFFSCREEN_MERGE',doc=>{doc.nodes[0].data.remoteMarker='OFFSCREEN_RESULT';},()=>select(ids[3]));assert.equal((await closeReceipt()).ok,true);const offscreen=await read(ids[2]);assert.equal(offscreen.nodes[0].data.prompt,'OFFSCREEN_MERGE');assert.equal(offscreen.nodes[0].data.remoteMarker,'OFFSCREEN_RESULT');report.cases.push('close resumes and saves a dormant off-screen merged draft through the normal CAS path');
  await page.reload();await select(ids[1]);assert.equal(await input().innerText(),'LOCAL_OFFLINE');report.cases.push('merged content survives reload');
  await race(ids[1],'NARROW_LOCAL',doc=>{doc.nodes[0].data.prompt='NARROW_REMOTE';});await notice().waitFor();await page.evaluate(async()=>(await import('/src/i18n/index.ts')).default.changeLanguage('en-US'));
  for(const mode of ['light','dark']){await page.evaluate(async m=>(await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(m),mode);await page.setViewportSize({width:800,height:600});await notice().getByRole('button',{name:'Download local copy',exact:true}).click({trial:true});await notice().getByRole('button',{name:'Use server version',exact:true}).click({trial:true});await page.screenshot({path:path.join(evidence,'notice-'+mode+'.png')});}report.cases.push('English and light/dark 800x600 actions remain accessible');
  assert.equal(await application.evaluate(()=>globalThis.ownedSaveExternalRequests),0);assert.deepEqual(report.errors,[]);await quit();await vite.close();vite=null;assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'),authorityBefore);report.passed=true;checkpoint('passed');
 }catch(error){report.failure=String(error.stack).slice(0,2500);if(page&&!page.isClosed())await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});checkpoint('failed: '+report.phase);throw error;}
 finally{releasePut?.();releaseRead?.();try{await quit();}catch(e){report.passed=false;report.shutdownFailure=String(e.message);const child=application?.process();if(child&&child.exitCode===null)child.kill();}await vite?.close();try{require('esbuild').stop();await withDeadline(()=>Promise.all(helperClosed),10000,'save helper close');}catch(e){report.passed=false;report.helperFailure=String(e.message);}cp.spawn=originalSpawn;report.helpers=helpers;fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;if(report.passed&&closed&&path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('t8-canvas-save-'))fs.rmSync(scratch,{recursive:true,force:true});else process.stderr.write('Owned failed save fixture retained: '+scratch+'\n');}
}
if(process.argv.includes('--electron-child'))childMain().catch(e=>{process.stderr.write(e.stack+'\n');require('electron').app.exit(1);});else main().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
