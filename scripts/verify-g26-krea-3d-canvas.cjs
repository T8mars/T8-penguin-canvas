'use strict';
// Full development App/Canvas + production routes/ledger/storage. Only the
// external Provider HTTP/media boundary is a deterministic fixture. No paid calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), evidence = path.resolve(root, 'local-private', process.env.T8_G26_EVIDENCE_SUBDIR || 'models-g26-3d-20261105');
assert.ok(evidence.startsWith(path.resolve(root,'local-private')+path.sep));
const { withDeadline } = require('./history-acceptance-safety.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const canvasCase=process.env.T8_G26_CANVAS_CASE||'all';assert.ok(['all','image','3d'].includes(canvasCase));
function readOnlyCanvasObserver(){return {name:'g26-readonly-test-observer',enforce:'pre',transform(code,id){
  if(!id.replace(/\\/g,'/').split('?')[0].endsWith('/src/components/Canvas.tsx'))return;
  const anchor='  const captureRunPreflightSnapshot = useCallback';assert.ok(code.includes(anchor));
  code=code.replace(anchor,String.raw`  (window as any).__g26ReadSnapshot=()=>({epoch:graphMutationEpochRef.current,revision:canvasRevisionsRef.current.get(loadedCanvasIdRef.current||''),trace:(window as any).__g26MutationTrace||[]});
`+anchor);
  const write='    nodesRef.current = identified;';assert.ok(code.includes(write));
  code=code.replace(write,String.raw`    if(next.epoch!==graphMutationEpochRef.current){const trace=(window as any).__g26MutationTrace||=[];trace.push({at:Date.now(),epoch:next.epoch,changed:identified.flatMap(n=>{const old=nodesRef.current.find(o=>o.id===n.id);return old?[{id:n.id,keys:Object.keys(n).filter(k=>k!=='data'&&JSON.stringify((n as any)[k])!==JSON.stringify((old as any)[k])),dataKeys:Object.keys(n.data||{}).filter(k=>JSON.stringify(n.data[k])!==JSON.stringify(old.data?.[k]))}]:[{id:n.id,added:true}];}).filter(n=>n.added||n.keys?.length||n.dataKeys?.length),stack:new Error().stack?.split('\n').slice(2,6)});if(trace.length>40)trace.shift();}
`+write);
  return code;
}};}
function dependency(name) { try { return require.resolve(name); } catch { return require.resolve(path.join(process.env.T8_ACCEPTANCE_NODE_MODULES || '', name)); } }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function childMain() {
 const {app,BrowserWindow,session}=require('electron'),scratch=process.env.T8_G26_CANVAS_ROOT;
 assert.ok(scratch&&path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('t8-g26-canvas-'));
 app.setPath('userData',path.join(scratch,'profile'));app.setPath('sessionData',path.join(scratch,'profile'));app.on('window-all-closed',()=>{});app.disableHardwareAcceleration();
 require('./history-acceptance-safety.cjs').installRendererExitRecorder(app,record=>fs.appendFileSync(path.join(scratch,'renderer-exits.jsonl'),JSON.stringify(record)+'\n'));
 const config=require('../backend/src/config');assert.ok(path.resolve(config.PROJECT_DB_FILE).startsWith(path.resolve(scratch)+path.sep));
 for(const dir of [config.INPUT_DIR,config.OUTPUT_DIR,config.THUMBNAILS_DIR,path.dirname(config.SETTINGS_FILE)])fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(config.SETTINGS_FILE,JSON.stringify({zhenzhenSd2ApiKey:'canvas-fixture-key',fileSavePath:path.join(scratch,'saved')}));fs.mkdirSync(path.join(scratch,'saved'));
 const sharp=require('sharp'),picture=await sharp({create:{width:256,height:256,channels:3,background:'blue'}}).png().toBuffer();
 fs.writeFileSync(path.join(config.INPUT_DIR,'front.png'),picture);fs.writeFileSync(path.join(config.INPUT_DIR,'back.png'),picture);fs.writeFileSync(path.join(scratch,'view.png'),picture);
 const raw=Buffer.alloc(64*128*3);raw.fill(40,0,64*64*3);raw.fill(210,64*64*3);const gif=await sharp(raw,{raw:{width:64,height:128,channels:3,pageHeight:64}}).gif({delay:[200,200],loop:0}).toBuffer();
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><circle cx="128" cy="128" r="80" fill="blue"/></svg>');
 const json=JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0}),padded=Buffer.from(json+' '.repeat((4-json.length%4)%4)),triangle=Buffer.alloc(12+8+padded.length+8+36);triangle.write('glTF');triangle.writeUInt32LE(2,4);triangle.writeUInt32LE(triangle.length,8);triangle.writeUInt32LE(padded.length,12);triangle.writeUInt32LE(0x4e4f534a,16);padded.copy(triangle,20);triangle.writeUInt32LE(36,20+padded.length);triangle.writeUInt32LE(0x004e4942,24+padded.length);[-1,-1,0,1,-1,0,0,1,0].forEach((v,i)=>triangle.writeFloatLE(v,28+padded.length+i*4));
 const actual=path.join(root,'local-private/models-g26-3d-20261105/outputs/meshy-6-global-image-to-3d.glb'),glb=fs.existsSync(actual)?fs.readFileSync(actual):triangle;
 const zip=new(require('yazl').ZipFile)();zip.addBuffer(glb,'nested/model.glb');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);const archive=Buffer.concat(chunks);
 const tasks=new Map();globalThis.motionFixture={posts:[],gets:[],downloads:0};const persist=()=>fs.writeFileSync(path.join(scratch,'fixture-stats.json'),JSON.stringify(globalThis.motionFixture));persist();
 const transport=async(url,init={})=>{
  if(String(url).endsWith('/v1/files/upload'))return new Response(JSON.stringify({url:'https://g26.example/input.png'}),{headers:{'content-type':'application/json'}});
  assert.match(String(url),/\/v1\/(image|3d)\/generations/);
  if(init.method==='POST'){const body=JSON.parse(init.body),id='fixture-'+(tasks.size+1);tasks.set(id,body);globalThis.motionFixture.posts.push(body);persist();return new Response(JSON.stringify({task_id:id}),{headers:{'content-type':'application/json'}});}
  const id=String(url).split('/').at(-1),body=tasks.get(id);assert.ok(body);globalThis.motionFixture.gets.push(id);persist();
  const three=body.model.includes('3d'),ext=three?(body.model.includes('multi')?'zip':'glb'):body.output_format==='svg'?'svg':body.output_format==='gif'||/looping GIF/.test(body.prompt)?'gif':'png',result='https://g26.example/result.'+ext;
  return new Response(JSON.stringify({data:{status:'SUCCESS',model:body.model,data:{content:three?{file_url:result}:{image_urls:Array.from({length:body.n||1},()=>result)}}}}),{headers:{'content-type':'application/json'}});
 };
 const provider=require('../backend/src/providers/seedanceNz');for(const name of ['submitImageTask','queryImageTask','submitHunyuan3dTask','queryHunyuan3dTask']){const original=provider[name];provider[name]=(request,key,options)=>original(request,key,{...options,fetchImpl:transport,uploadIntervalMs:0});}
 const remote=require('../backend/src/utils/safeRemoteMediaFetch');remote.safeRemoteMediaFetch=async(url,options)=>{assert.ok(String(url).startsWith('https://g26.example/result.'));assert.equal(options.trustedProviderOutput,true);globalThis.motionFixture.downloads++;const ext=String(url).split('.').at(-1);return{buffer:{png:picture,gif,svg,glb,zip:archive}[ext],contentType:{png:'image/png',gif:'image/gif',svg:'image/svg+xml',glb:'application/octet-stream',zip:'application/zip'}[ext],finalUrl:String(url),status:200};};
 const db=require('../backend/src/services/projectRuntime').getProjectStorageRuntime(config).database;
 const node=(id,type,data,x,y)=>({id,entityUid:crypto.randomUUID(),type,position:{x,y},data});
 const image=(model,apiModel)=>({model,apiModel,providerSource:'zhenzhen',providerId:'',providerModel:'',imageBuiltinSource:'seedance-nz',aspectRatio:'',sizeLevel:'',prompt:'A blue toy robot on cream',referenceImages:[],imageOnlyOutput:true,status:'idle',reuseResult:false});
 const nodes=[node('front','upload',{uploadType:'image',lockedUploadType:'image'},-430,30),node('back','upload',{uploadType:'image',lockedUploadType:'image'},-430,350),
  node('g26','image',{...image('gpt-image-2.6','zhenzhen-image-g-v2.6-flare'),g26Mode:'gif',g26FrameCount:2},0,30),node('lowref','image',{...image('gpt-image-2.6','zhenzhen-image-g-v2.6-lowprice'),g26Mode:'gif'},430,30),node('krea','image',{...image('krea','krea-v3-t2i'),kreaSize:'custom',kreaWidth:256,kreaHeight:256,kreaSeed:42},860,30),node('zimage','image',image('z-image','z-image-t2i'),1290,30),
  node('single3d','model-3d',{model:'hitem3d-v2-image-to-3d',threeDTab:'hitem3d',hitemFace:100000,hitemRequestType:'mesh',reuseResult:false},1720,30),node('multi3d','model-3d',{model:'hitem3d-v2-multi-image-to-3d',threeDTab:'hitem3d',hitemFace:100000,hitemRequestType:'both',reuseResult:false},2150,30),node('text3d','model-3d',{model:'meshy-6-global-text-to-3d',threeDTab:'meshy',prompt:'A blue robot',reuseResult:false},2580,30)];
 const chosen=nodes.filter(n=>canvasCase==='all'||['front','back'].includes(n.id)||(canvasCase==='3d'?n.type==='model-3d':n.type==='image')),ids=new Set(chosen.map(n=>n.id));
 const edges=[['front','lowref'],['front','single3d'],['front','multi3d'],['back','multi3d']].map(([source,target],index)=>({id:'ref-'+index,source,target})).filter(e=>ids.has(e.source)&&ids.has(e.target));db.ensureCanvas(process.env.T8_G26_CANVAS_ID,{nodes:chosen,edges},require('../backend/src/collaboration/protocol').DEFAULT_PROJECT_ID);
 const backend=require('../backend/src/server');globalThis.ownedMotionBackend=backend;globalThis.ownedMotionDatabase=db;await backend.serverStartPromise;await app.whenReady();
 globalThis.ownedG26Downloads=[];fs.mkdirSync(path.join(scratch,'downloads'));
 session.defaultSession.on('will-download',(_event,item)=>{const name=path.basename(item.getFilename()),file=path.join(scratch,'downloads',crypto.randomUUID()+'-'+name);item.setSavePath(file);item.once('done',(_event,state)=>globalThis.ownedG26Downloads.push({file,name,state}));});
 const allowed=new Set([new URL(process.env.T8_G26_FRONTEND).origin,'http://127.0.0.1:'+process.env.PORT]);session.defaultSession.webRequest.onBeforeRequest((details,done)=>{const u=new URL(details.url);done({cancel:!allowed.has(u.origin)&&!['data:','blob:','devtools:'].includes(u.protocol)});});
 const win=new BrowserWindow({show:false,width:1360,height:940,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});globalThis.ownedMotionWindow=win;await win.loadURL(process.env.T8_G26_FRONTEND);
}
async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1 -Mode G26Canvas');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  const playwright = require(dependency('playwright')), loader = path.join(path.dirname(dependency('playwright-core')), 'lib/server/electron/loader.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-g26-canvas-')), canvasId = 'motion-' + crypto.randomUUID();
  const authority = path.join(root, '.t8-collaboration-management-authority.json'), authorityBefore = crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex');
  const backendPort = await freePort(), collabPort = await freePort(), backendOrigin = `http://127.0.0.1:${backendPort}`;
  process.env.T8PC_DEV_BACKEND_ORIGIN = backendOrigin; process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  let vite, application, page, closed = false;
  const report = { passed: false, canvasCase, phase: 'initialize', errors: [], cases: [], budget, boundary: 'Full App/Canvas with real fresh SQLite/Run/assets; external HTTP is a deterministic fixture, not real model generation or installed-client acceptance.' };
  fs.mkdirSync(evidence, { recursive: true });
  const checkpoint = phase => { report.phase = phase; fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2)); process.stdout.write(phase + '\n'); };
  const read = async url => { const r = await fetch(backendOrigin + url), body = await r.json(); assert.equal(body.success, true, url); return body.data; };
  const until = async (fn, label, timeout = 60000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; if (report.errors.length) throw Error(report.errors.join('\n')); await pause(150); } throw Error(label); };
  const quit = async () => { if (!application || closed) return; const close = application.waitForEvent('close', { timeout: 30000 }); void close.catch(() => {});
    await withDeadline(() => application.evaluate(async ({ app }) => { globalThis.ownedMotionWindow?.destroy(); await globalThis.ownedMotionBackend.gracefulShutdown('motion-verifier'); setTimeout(() => app.quit(), 0); }), 20000, 'owned Motion shutdown'); await close; closed = true; };
  try {
    const { createServer } = await import('vite'), { coldHistoryFileWatcherPlugin, prepareSerialHistoryWarmup } = require('./history-serial-warmup.cjs');
    vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(scratch, 'node_modules/.vite'), plugins: [readOnlyCanvasObserver(),coldHistoryFileWatcherPlugin()],
      server: { host: '127.0.0.1', port: 0, strictPort: false, preTransformRequests: false, hmr: false, watch: null } });
    const warmup = prepareSerialHistoryWarmup(vite); await vite.listen(); checkpoint('warming full App'); await withDeadline(() => warmup.run(checkpoint), 180000, 'serial Motion App warmup');
    const env = { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', T8_COLLAB_PORT: String(collabPort), T8_G26_CANVAS_ROOT: scratch, T8_G26_CANVAS_ID: canvasId,
      T8_G26_FRONTEND: `http://127.0.0.1:${vite.httpServer.address().port}`, T8PC_PACKAGED: '0', T8PC_DEV_DATA_ROOT: path.join(scratch, 'data'),
      T8PC_DEV_PROJECT_DB_STORAGE_PROFILE: 'acceptance-small-v1', T8_COLLAB_MANAGEMENT_TOKEN: JSON.parse(fs.readFileSync(authority, 'utf8')).token,
      ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
    checkpoint('launching isolated full App'); application = await playwright._electron.launch({ executablePath: require('electron'), args: ['--js-flags=--max-old-space-size=768', '-r', loader, __filename, '--electron-child'], env, timeout: 60000 });
    application.on('close', () => { closed = true; }); page = await application.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('crash', () => report.errors.push('Owned renderer crashed'));
    await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), button => button.click());
    await page.evaluate(async()=>{await(await import('/src/i18n/index.ts')).default.changeLanguage('zh-CN');});
    const g26=page.locator('.react-flow__node[data-id="g26"]'),readyNode=canvasCase==='3d'?page.locator('.react-flow__node[data-id="single3d"]'):g26;await readyNode.waitFor({timeout:120000});
    const stats=()=>JSON.parse(fs.readFileSync(path.join(scratch,'fixture-stats.json'),'utf8'));
    const saved=async id=>(await read('/api/canvas/'+canvasId)).nodes.find(n=>n.id===id).data;
    await page.evaluate(()=>{window.__g26Requests=[];window.addEventListener('t8:canvas-node-run-request',event=>{const d=event.detail,record={nodeId:d.nodeId};window.__g26Requests.push(record);const prior=d.onSettled;d.onSettled=outcome=>{record.outcome=outcome;prior?.(outcome);};},{capture:true});});
    const settleCanvas=async()=>{let prior='',since=Date.now();await until(async()=>{const value=await read('/api/canvas/'+canvasId),local=await page.evaluate(()=>window.__g26ReadSnapshot()),signature=JSON.stringify({nodes:value.nodes,edges:value.edges,viewport:value.viewport,epoch:local.epoch,revision:local.revision});if(signature!==prior){prior=signature;since=Date.now();return false;}return Date.now()-since>=2000&&await page.locator('.t8-canvas-toolbar button[title^="停止批量运行"]').count()===0;},'Canvas edits did not settle',60000);};
    const run=async(id,name)=>{console.log('running '+id);await page.evaluate(()=>document.activeElement?.blur());await page.locator('.react-flow__pane').first().click({position:{x:30,y:180}});await page.keyboard.press('z');await pause(600);await settleCanvas();const n=page.locator('.react-flow__node[data-id="'+id+'"]'),count=stats().posts.length,previousTask=(await saved(id)).taskId,requestIndex=await page.evaluate(()=>window.__g26Requests.length);await n.getByRole('button',{name,exact:true}).click();await until(async()=>{const preflight=page.getByTestId('run-preflight-modal');if(await preflight.isVisible()){await preflight.getByRole('button',{name:'确认并继续',exact:true}).click();return false;}const r=await page.evaluate(index=>window.__g26Requests[index],requestIndex);if(r?.outcome?.accepted===false)throw Error('Canvas rejected '+id+': '+r.outcome.error);return r?.outcome?.accepted===true;},'Run request did not settle: '+id,120000);assert.ok(stats().posts.length>count,'No new provider submit: '+id);await until(async()=>{const value=await saved(id);if(value.taskId!==previousTask&&['error','failed'].includes(value.status))throw Error(value.error||'Node failed: '+id);return value.status==='success'&&value.taskId!==previousTask;},'Node did not complete: '+id,90000);await pause(150);console.log('completed '+id);};
    for(const id of ['front','back']){await page.locator('.react-flow__node[data-id="'+id+'"]').locator('input[type=file]').first().setInputFiles(path.join(scratch,'view.png'));await until(async()=>Boolean((await saved(id)).imageUrl),'Upload did not persist: '+id);}
    let p;
    if(canvasCase!=='3d'){
    checkpoint('new image tabs, GIF and SVG original downloads');
    for(const title of ['gpt-image-2.6','z-image','krea'])await g26.getByRole('button',{name:title,exact:true}).waitFor();
    const models=g26.locator('select').filter({has:page.locator('option[value="zhenzhen-image-g-v2.6-sunburst"]')});
    for(const model of ['zhenzhen-image-g-v2.6-flare','zhenzhen-image-g-v2.6-sunburst']){
      await models.selectOption(model);await g26.getByLabel('输出类型',{exact:true}).selectOption('gif');await g26.getByLabel('帧数',{exact:true}).fill('2');await run('g26','生成');assert.equal(stats().posts.at(-1).output_format,'gif');assert.match((await saved('g26')).imageUrl,/\.gif$/);
      await g26.getByLabel('输出类型',{exact:true}).selectOption('svg');await run('g26','生成');const v=stats().posts.at(-1);assert.equal(v.output_format,'svg');assert.equal(v.svg.model,'gpt-5.4-mini');assert.match((await saved('g26')).imageUrl,/\.svg$/);
    }
    const svgUrl=(await saved('g26')).imageUrl,svgResponse=await fetch(backendOrigin+'/api/files/vector/'+svgUrl.split('/').at(-1));assert.equal(svgResponse.status,200);assert.match(svgResponse.headers.get('content-security-policy'),/sandbox/);assert.equal((await fetch(backendOrigin+svgUrl)).status,404);
    await run('lowref','生成');assert.equal(stats().posts.at(-1).images.length,1);assert.equal(stats().posts.at(-1).output_format,undefined);const gifUrl=(await saved('lowref')).imageUrl;assert.match(gifUrl,/\.gif$/);
    const download=async id=>{const n=page.locator('.react-flow__node[data-id="'+id+'"]'),index=await application.evaluate(()=>globalThis.ownedG26Downloads.length);await n.getByRole('link',{name:'保存原文件',exact:true}).click();await until(async()=>await application.evaluate((_electron,index)=>globalThis.ownedG26Downloads.length>index,index),'Native download did not finish');const d=await application.evaluate((_electron,index)=>globalThis.ownedG26Downloads[index],index),data=await saved(id);assert.equal(d.state,'completed');const expected=fs.readFileSync(path.join(scratch,'data/output',data.imageUrl.split('/').at(-1)));assert.deepEqual(fs.readFileSync(d.file),expected);return d.name;};
    assert.match(await download('lowref'),/\.gif$/);assert.match(await download('g26'),/\.svg$/);
    report.cases.push('Three GIF models, two SVG modes, reference LowPrice and original-byte UI downloads');
    checkpoint('Krea text/edit, Z-image and persisted parameters');
    const krea=page.locator('.react-flow__node[data-id="krea"]');await run('krea','生成');p=stats().posts.at(-1);assert.equal(p.size,'256*256');assert.equal(p.metadata.model_variant,'berry');assert.equal(p.seed,42);
    await krea.locator('select').filter({has:page.locator('option[value="krea-v3-i2i"]')}).selectOption('krea-v3-i2i');await krea.getByLabel('模型变体',{exact:true}).selectOption('jam');await krea.locator('input[type=file]').first().setInputFiles(path.join(scratch,'view.png'));await until(async()=>(await saved('krea')).referenceImages?.length===1,'Krea reference not saved');await run('krea','生成');p=stats().posts.at(-1);assert.equal(p.metadata.model_variant,'jam');assert.equal(p.images.length,1);assert.equal(Object.hasOwn(p,'n'),false);await run('zimage','生成');assert.deepEqual(Object.keys(stats().posts.at(-1)).sort(),['metadata','model','prompt']);
    report.cases.push('Krea variants, native seed/size and genuine local upload; Z-image exact protocol');
    }
    if(canvasCase!=='image'){
    checkpoint('five 3D models and ZIP materialization');
    const single=page.locator('.react-flow__node[data-id="single3d"]'),multi=page.locator('.react-flow__node[data-id="multi3d"]');
    for(const model of ['hitem3d-v2-image-to-3d','hitem3d-portrait-v2.1-image-to-3d']){await single.getByLabel('3D model',{exact:true}).selectOption(model);await run('single3d','生成 3D');p=stats().posts.at(-1);assert.equal(p.images.length,1);assert.equal(p.face,100000);assert.equal(p.prompt,undefined);if(model.includes('portrait'))assert.equal(p.resolution,'1536pro');assert.match((await saved('single3d')).modelUrl,/\.glb$/);}
    for(const model of ['hitem3d-v2-multi-image-to-3d','hitem3d-portrait-v2.1-multi-image-to-3d']){await multi.getByLabel('3D model',{exact:true}).selectOption(model);await run('multi3d','生成 3D');assert.equal(stats().posts.at(-1).images.length,2);assert.match((await saved('multi3d')).modelUrl,/\.glb$/);}
    await single.getByRole('button',{name:'meshy',exact:true}).click();await single.getByLabel('生成纹理',{exact:true}).selectOption('false');await single.getByLabel('重新拓扑',{exact:true}).selectOption('true');await run('single3d','生成 3D');p=stats().posts.at(-1);assert.equal(p.should_texture,false);assert.equal(p.should_remesh,true);assert.equal(p.model,'meshy-6-global-image-to-3d');assert.equal(p.face_count,undefined);
    const text=page.locator('.react-flow__node[data-id="text3d"]');await text.getByLabel('Meshy 提示词（1–600 字符）',{exact:true}).fill('A rounded blue toy robot');await text.getByLabel('艺术风格',{exact:true}).selectOption('sculpture');await text.getByLabel('自动扩写提示词',{exact:true}).selectOption('false');await text.getByLabel('PBR材质',{exact:true}).selectOption('false');
    await text.getByLabel('3D model',{exact:true}).selectOption('meshy-6-global-image-to-3d');assert.equal(await text.locator('textarea').count(),0);await text.getByLabel('3D model',{exact:true}).selectOption('meshy-6-global-text-to-3d');assert.equal(await text.getByLabel('Meshy 提示词（1–600 字符）',{exact:true}).inputValue(),'A rounded blue toy robot');await run('text3d','生成 3D');p=stats().posts.at(-1);assert.equal(p.model,'meshy-6-global-text-to-3d');assert.equal(p.prompt,'A rounded blue toy robot');assert.equal(p.art_style,'sculpture');assert.equal(p.enable_prompt_expansion,false);assert.equal(p.enable_pbr,false);for(const key of ['images','should_texture','face_count','generate_type'])assert.equal(p[key],undefined);assert.match((await saved('text3d')).modelUrl,/\.glb$/);
    assert.ok(fs.readdirSync(path.join(scratch,'data/output')).some(name=>name.endsWith('.zip')));report.cases.push('Six 3D models, restored Meshy text controls and switching, ordered views, exact fields, GLB preview URLs and preserved ZIP archives');
    }
    checkpoint('save reload and bilingual themes');await page.reload();await readyNode.waitFor({timeout:120000});if(canvasCase!=='3d'){await until(async()=>(await saved('g26')).g26Mode==='svg','SVG setting not persisted');assert.equal((await saved('krea')).kreaVariant,'jam');}if(canvasCase!=='image')assert.equal((await saved('single3d')).meshy_should_texture,'false');
    if(canvasCase!=='image'){const value=await saved('text3d');assert.equal(value.prompt,'A rounded blue toy robot');assert.equal(value.meshyArtStyle,'sculpture');assert.equal(value.meshyPromptExpansion,'false');assert.match(value.modelUrl,/\.glb$/);}
    for(const mode of ['light','dark'])for(const locale of ['zh-CN','en-US']){await page.evaluate(async({mode,locale})=>{(await import('/src/stores/theme.ts')).useThemeStore.getState().setTheme(mode);await(await import('/src/i18n/index.ts')).default.changeLanguage(locale);},{mode,locale});const control=canvasCase==='3d'?readyNode:g26.getByTestId('g26-krea-controls');assert.doesNotMatch(await control.innerText(),/g26Krea3d:/);if(canvasCase!=='image')assert.doesNotMatch(await page.locator('.react-flow__node[data-id="text3d"]').innerText(),/g26Krea3d:|临时下架|temporarily withdrawn/);}
    report.cases.push('Persisted settings and four theme/language combinations');await page.screenshot({path:path.join(evidence,'canvas-complete-'+canvasCase+'.png')});
    await quit(); await vite.close(); vite = null;
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(authority)).digest('hex'), authorityBefore);
    report.passed = true; checkpoint('passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3000); try {report.graphObserver=await page.evaluate(()=>window.__g26ReadSnapshot());report.runBus=await page.evaluate(async()=>{const s=(await import('/src/stores/runBus.ts')).useRunBusStore.getState();return {activeRunId:s.activeRunId,runningIds:s.runningIds,lastDone:s.lastDone};});report.liveNodes=(await read('/api/canvas/'+canvasId)).nodes.map(n=>({id:n.id,status:n.data.status,error:n.data.error,model:n.data.model,apiModel:n.data.apiModel,g26Mode:n.data.g26Mode,reuseResult:n.data.reuseResult}));}catch{} if (page && !page.isClosed()) try { await page.screenshot({ path: path.join(evidence, 'failure.png') }); } catch {} checkpoint('failed: ' + report.phase); throw error; }
  finally {
    try { await quit(); } catch (error) { report.passed = false; report.shutdownFailure = String(error.message); }
    await vite?.close(); require('esbuild').stop(); await pause(1000);
    const exitsFile=path.join(scratch,'renderer-exits.jsonl');report.rendererExits=fs.existsSync(exitsFile)?fs.readFileSync(exitsFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
    fs.writeFileSync(path.join(evidence, 'canvas-ui.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(evidence,'canvas-ui-'+canvasCase+'.json'),JSON.stringify(report,null,2));
    fs.mkdirSync(path.join(evidence, 'attempts'), { recursive: true }); fs.writeFileSync(path.join(evidence, 'attempts', path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || 'unknown.json')), JSON.stringify(report, null, 2));
    if (report.passed && closed && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('t8-g26-canvas-')) fs.rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write('Owned fixture retained: ' + scratch + '\n');
    if (!report.passed) process.exitCode = 1;
  }
}
if (process.argv.includes('--electron-child')) childMain().catch(error => { process.stderr.write(error.stack + '\n'); require('electron').app.exit(1); });
else if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
