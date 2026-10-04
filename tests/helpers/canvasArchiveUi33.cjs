// Manual browser acceptance harness. Only newly-created system-temp data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
if(spawnSync(process.execPath,['scripts/worktree-role.cjs','development'],{cwd:root,stdio:'inherit',windowsHide:true}).status!==0)process.exit(1);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'t8-archive33-ui-'));
process.env.T8PC_DEV_DATA_ROOT=temporary;
process.env.T8_DISABLE_LOCAL_EXTENSIONS='1';
const config=require('../../backend/src/config');
const {ProjectDatabase}=require('../../backend/src/services/projectDatabase');
const children=[];let stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!=null)return resolve();child.once('exit',resolve);child.kill();})));
  const relative=path.relative(os.tmpdir(),temporary);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Unsafe test cleanup');
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  console.log('test-only temporary directory removed');process.exit(0);
}
(async()=>{
  const database=new ProjectDatabase(config.PROJECT_DB_FILE,{autoBackup:false});
  const list=[];
  for(let index=0;index<100;index++){
    const id=`ui-${String(index).padStart(3,'0')}`;
    const doc=database.ensureCanvas(id,{name:index===99?'UI active canvas':`UI canvas ${index}`,nodes:index===99?[{id:'text-ui',type:'text',position:{x:200,y:120},data:{prompt:'Original UI content'}}]:[],edges:[]});
    list.push({id,name:doc.name,revision:doc.revision,nodeCount:doc.nodes.length,createdAt:Date.now(),updatedAt:Date.now()});
    if(index<90){const item=database.getCanvasDirectoryEntry(id);database.transitionCanvasArchive(id,'archive',{operationId:crypto.randomUUID(),catalogRevision:item.catalogRevision,baseRevision:item.revision});}
  }
  database.completeCanvasDirectoryHydration();await database.close();
  fs.writeFileSync(config.CANVAS_FILE,JSON.stringify(list));
  fs.writeFileSync(config.SETTINGS_FILE,JSON.stringify({fileSavePath:path.join(temporary,'exports'),canvasAutoSavePath:path.join(temporary,'canvas-autosave'),resourceLibraryPath:path.join(temporary,'library'),themeTemplatePath:path.join(temporary,'themes'),preferences:{mediaNodeDefaults:{version:1,imageSource:'seedance-nz',videoSource:'seedance-nz'}}}));
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--max-old-space-size=768',PORT:'18766',T8_COLLAB_PORT:'18767',T8_FIGMA_BRIDGE_AUTOSTART:'0',T8PC_DEV_BACKEND_ORIGIN:'http://127.0.0.1:18766'};
  for(const args of [['backend/src/server.js'],['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','21422']]){
    const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});children.push(child);
    try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
    child.stdout.on('data',bytes=>process.stdout.write(bytes));child.stderr.on('data',bytes=>process.stderr.write(bytes));
  }
  console.log(`UI isolation: ${temporary}; URL http://127.0.0.1:21422`);
  process.stdin.once('data',stop);process.on('SIGINT',stop);process.on('SIGTERM',stop);
})().catch(async error=>{console.error(error.message);await stop();});
