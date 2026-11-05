'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'local-private/models-g26-3d-20261105');
const {submitOnce,safeError}=require('./verify-seedream-flash-live.cjs');
const c=require('../backend/src/shared/g26Krea3dContract.json');
const CASES=[
 {id:'g26-low-static',model:c.g26.models[0],refs:2},
 {id:'g26-low-gif-reference',model:c.g26.models[0],refs:1,mode:'gif'},
 ...c.g26.models.slice(1).flatMap((model,index)=>[
  {id:`g26-${index}-static`,model,refs:2,n:index?1:2},
  {id:`g26-${index}-gif`,model,mode:'gif'},
  {id:`g26-${index}-svg`,model,mode:'svg'}]),
 {id:'krea-text',model:'krea-v3-t2i'}, {id:'krea-edit',model:'krea-v3-i2i',refs:1}, {id:'z-image-text',model:c.zimage.model}
];
function save(report){const file=directory+'/image-report.json';fs.writeFileSync(file+'.tmp',JSON.stringify(report,null,2));fs.renameSync(file+'.tmp',file);}
async function main(){
 let key=process.env.SEEDANCE_NZ_API_KEY||'';delete process.env.SEEDANCE_NZ_API_KEY;if(!key)throw Error('Key required in process environment');
 const {app,session}=require('electron'),scratch=process.env.T8_G26_LIVE_PROFILE;
 if(!scratch||path.dirname(scratch)!==os.tmpdir()||!path.basename(scratch).startsWith('t8-g26-live-'))throw Error('Isolated profile required');
 app.setPath('userData',scratch);app.setPath('sessionData',scratch);app.disableHardwareAcceleration();await app.whenReady();
 const net=session.fromPartition('t8-g26-images-live'),bridge=require('../electron/systemFetchBridge.cjs');
 bridge.installChromiumResponseHeaderBridge(net);bridge.installGlobalSystemFetchBridge({chromiumFetch:net.fetch.bind(net),resolveHost:net.resolveHost.bind(net),refreshNetwork:async()=>{await net.forceReloadProxyConfig();await net.clearHostResolverCache();}});
 fs.mkdirSync(directory+'/outputs',{recursive:true});const config=require('../backend/src/config');config.OUTPUT_DIR=directory+'/outputs';config.SETTINGS_FILE=path.join(scratch,'unused-settings.json');
 const provider=require('../backend/src/providers/seedanceNz'),media=require('../backend/src/routes/proxy')._test,sharp=require('sharp'),formats=require('../backend/src/providers/providerOutputFormats');
 const report=fs.existsSync(directory+'/image-report.json')?JSON.parse(fs.readFileSync(directory+'/image-report.json')):{schema:'t8-g26-krea-live-v1',results:{}};
 const reference=directory+'/front.png';if(!fs.existsSync(reference))await sharp({create:{width:768,height:768,channels:3,background:'#358acb'}}).png().toFile(reference);
 for(const item of CASES){
  if(report.results[item.id]?.passed)continue;
  const mode=item.mode||'image',input={model:item.model,prompt:mode==='gif'?'A blue toy robot waving one arm, fixed camera, seamless animated looping GIF.':mode==='svg'?'A simple clean blue robot icon, geometric vector shapes on a white background, no external resources.':'A simple blue toy robot on a plain cream background, clean studio illustration.',...(item.refs?{images:Array.from({length:item.refs},()=>reference)}:{}),
   ...(c.g26.models.includes(item.model)?{output_mode:mode,...(item.model===c.g26.models[0]?{size:'1:1',resolution:'1k'}:mode==='gif'?{size:'512x512',frame_count:2,frame_duration_ms:200}:mode==='svg'?{size:'auto'}:{size:'1:1',resolution:'1k',n:item.n||1,output_format:'png'})}:{}),
   ...(item.model.startsWith('krea')?{size:'256*256',model_variant:item.refs?'jam':'berry',reasoning_level:'low',output_format:item.refs?'jpeg':'png',seed:42}:{}),
   ...(item.model===c.zimage.model?{ratio:'1:1',seed:42}:{})};
  let last;try{
   console.log(JSON.stringify({id:item.id,phase:'submit-or-resume'}));const task=await submitOnce(directory+'/'+item.id+'.state.private.json',item.model,input,body=>provider.submitImageTask(body,key));
   const started=Date.now();let previous='',polls=0;
   while(Date.now()-started<30*60*1000){last=await provider.queryImageTask(task,key);polls++;if(previous!==last.status)console.log(JSON.stringify({id:item.id,phase:'poll',status:last.status}));previous=last.status;if(last.status==='failed')throw Error(last.failReason||'Original task failed');if(last.status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,5000));}
   if(last?.status!=='succeeded'||!last.imageUrls?.length)throw Error('Original task incomplete; GET resume only');
   if(last.imageUrls.length!==(item.n||1))throw Error('Output count mismatch');
   const outputs=[];
   for(const [index,url]of last.imageUrls.entries()){
    const remote=await media.fetchProxyRemoteMedia(url,{trustedProviderOutput:true,allowedKinds:['image'],maxBytes:50*1024*1024,deadlineMs:900000,idleTimeoutMs:900000});
    const ext=media.verifiedProxyMediaExtension(remote),target=directory+'/outputs/'+item.id+'-'+index+'.'+ext;
    fs.writeFileSync(target,remote.buffer);let details;
    if(mode==='svg'){if(ext!=='svg')throw Error('Requested SVG did not return SVG');await formats.validateSvgBuffer(remote.buffer);const meta=await sharp(remote.buffer).metadata();details={format:'svg',width:meta.width,height:meta.height,rendered:true};}
    else {const animated=mode==='gif';if(animated&&ext!=='gif')throw Error('Requested GIF did not return GIF');const meta=await sharp(remote.buffer,{animated,failOn:'error'}).metadata();const {data,info}=await sharp(remote.buffer,{animated,failOn:'error',limitInputPixels:64*1024*1024}).raw().toBuffer({resolveWithObject:true});if(!data.length)throw Error('Image decode failed');if(animated&&(!meta.pages||meta.pages<2))throw Error('GIF has no animation');let changing=false;if(animated){const size=info.width*(meta.pageHeight||meta.height/meta.pages)*info.channels;for(let offset=size;offset<data.length;offset+=size)if(!data.subarray(0,size).equals(data.subarray(offset,offset+size))){changing=true;break;}if(!changing)throw Error('GIF frames are identical');}details={format:meta.format,width:meta.width,height:meta.pageHeight||meta.height,frames:meta.pages||1,durations:meta.delay||[],changing,fullDecode:true};}
    outputs.push({bytes:remote.buffer.length,sha256:crypto.createHash('sha256').update(remote.buffer).digest('hex'),file:path.relative(root,target),...details});
   }
   report.results[item.id]={passed:true,model:item.model,mode,references:item.refs||0,polls,upstreamHttpStatus:last.upstreamHttpStatus,elapsedSeconds:(Date.now()-started)/1000,outputs};console.log(JSON.stringify({id:item.id,phase:'verified',formats:outputs.map(o=>o.format)}));
  }catch(error){report.results[item.id]={passed:false,model:item.model,mode,status:last?.status,error:safeError(error,key)};console.log(JSON.stringify({id:item.id,phase:'failed',error:report.results[item.id].error}));}save(report);
 }
 report.passed=CASES.every(item=>report.results[item.id]?.passed);report.completedAt=new Date().toISOString();save(report);key=null;app.exit(report.passed?0:1);
}
async function launch(){
 fs.mkdirSync(directory,{recursive:true});const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-g26-live-'));
 let key=process.env.SEEDANCE_NZ_API_KEY||'';
 if(!key){const {Writable}=require('node:stream');console.log('Waiting for key on hidden stdin; not saved.');const input=require('node:readline').createInterface({input:process.stdin,output:new Writable({write(_c,_e,done){done();}}),terminal:!!process.stdin.isTTY});key=await new Promise(resolve=>input.once('line',line=>{input.close();resolve(line.trim());}));}
 if(!key)throw Error('Missing test key');const env={...process.env,SEEDANCE_NZ_API_KEY:key,T8_G26_LIVE_PROFILE:scratch,NODE_OPTIONS:'--max-old-space-size=768'};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[__filename],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});delete env.SEEDANCE_NZ_API_KEY;key=null;
 const log=fs.createWriteStream(directory+'/image-live.log',{flags:'a'});for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{log.write(bytes);process.stdout.write(bytes);});
 child.once('exit',code=>{log.end();fs.rmSync(scratch,{recursive:true,force:true});process.exitCode=code??1;});
}
if(require.main===module||(process.argv[1]&&path.resolve(process.argv[1])===__filename))(process.argv.includes('--launch')?launch():main()).catch(error=>{console.error(safeError(error));process.exit(1);});
module.exports={CASES};
