'use strict';
// Explicit paid-test entry. No accepted/ambiguous creation is replayed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,execFileSync,execFile}=require('node:child_process'),execute=require('node:util').promisify(execFile);
const {submitOnce}=require('./verify-seedream-flash-live.cjs');
const ROOT=path.resolve(__dirname,'..'),DIR=path.join(ROOT,'local-private/sd25-flash-h3-20261117');
const save=(name,value)=>{fs.writeFileSync(path.join(DIR,name+'.tmp'),JSON.stringify(value,null,2));fs.renameSync(path.join(DIR,name+'.tmp'),path.join(DIR,name));};
async function main(){
 let key=process.env.SEEDANCE_NZ_API_KEY;delete process.env.SEEDANCE_NZ_API_KEY;
 if(!key||!process.argv.includes('--confirm-live'))throw Error('Process-only key and explicit live confirmation required');
 const scratch=process.env.T8_SD25_H3_PROFILE;
 if(!scratch||path.dirname(scratch)!==os.tmpdir()||!path.basename(scratch).startsWith('t8-sd25-h3-live-'))throw Error('Isolated profile required');
 const {app,session}=require('electron');app.setPath('userData',scratch);app.setPath('sessionData',scratch);app.disableHardwareAcceleration();await app.whenReady();
 const network=session.fromPartition('t8-sd25-h3-live'),bridge=require('../electron/systemFetchBridge.cjs');bridge.installChromiumResponseHeaderBridge(network);bridge.installGlobalSystemFetchBridge({chromiumFetch:network.fetch.bind(network),resolveHost:network.resolveHost.bind(network),refreshNetwork:async()=>{await network.forceReloadProxyConfig();await network.clearHostResolverCache();}});
 const config=require('../backend/src/config');config.OUTPUT_DIR=path.join(DIR,'outputs');config.SETTINGS_FILE=path.join(scratch,'unused-settings.json');fs.mkdirSync(config.OUTPUT_DIR,{recursive:true});
 const provider=require('../backend/src/providers/seedanceNz'),media=require('../backend/src/providers/llmMedia'),download=require('../backend/src/routes/proxy')._test.saveRemoteFalToolboxFile;
 const correction=process.argv.includes('--charswap-audio-retest'),reportName=correction?'charswap-audio-report.json':'live-report.json';
 const reportPath=path.join(DIR,reportName),report=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')):{schema:'t8-sd25-flash-h3-live-v1',maximumCreationPosts:correction?1:10,results:[]};
 const persist=()=>save(reportName,report);
 const log=row=>console.log(JSON.stringify(row));
 const safeError=e=>({name:e.name,code:e.code,status:e.status,upstreamHttpStatus:e.upstreamHttpStatus,message:String(e.message||'').split(key).join('[redacted]').replace(/https?:\/\/[^\s"']+|task_[A-Za-z0-9_-]+/g,'[redacted]').slice(0,500)});
 try{
  if(process.argv.includes('--inspect-only')){
   for(const model of ['minimax-h3-comfyui-max-10020','minimax-h3-comfyui-max-10021']){
    const journal=JSON.parse(fs.readFileSync(path.join(DIR,model+'-private-task.json'),'utf8'));
    const r=await network.fetch('https://api.seedance.nz/v1/video/generations/'+encodeURIComponent(journal.taskId),{headers:{Authorization:'Bearer '+key}}),data=await r.json(),record=data.data||data;
    log({phase:'read-only-identity',expected:model,httpStatus:r.status,keys:Object.keys(record),model:record.model,status:record.status,nestedModel:record.data?.model,nestedStatus:record.data?.status});
   }
   key=null;app.exit(0);return;
  }
  const response=await network.fetch('https://api.seedance.nz/api/usage/wallet/',{headers:{Authorization:'Bearer '+key}}),wallet=await response.json();
  report.wallet={httpStatus:response.status,amount:wallet.data?.amount,currency:wallet.data?.display_type};persist();log({phase:'wallet',...report.wallet});if(!response.ok||!(wallet.data?.amount>0))throw Error('No usable wallet balance');
  const sharp=require('sharp');
  const image='data:image/png;base64,'+(await sharp(Buffer.from('<svg width="512" height="288"><rect width="512" height="288" fill="#f1e6ce"/><rect x="190" y="95" width="105" height="145" rx="20" fill="#36b896"/><circle cx="243" cy="62" r="38" fill="#36b896"/><circle cx="228" cy="57" r="6" fill="black"/><circle cx="258" cy="57" r="6" fill="black"/></svg>')).png().toBuffer()).toString('base64');
  const refPath=path.join(DIR,'source-fixture.mp4');
  if(!fs.existsSync(refPath))await execute(media.resolveBundledFfmpeg(),['-v','error','-f','lavfi','-i','color=c=beige:s=512x288:r=24:d=5','-vf','drawbox=x=190+10*t:y=75:w=105:h=170:color=green:t=fill','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',refPath],{windowsHide:true,timeout:60000});
  let video='data:video/mp4;base64,'+fs.readFileSync(refPath).toString('base64');
  const audioVideoPath=path.join(DIR,'source-with-audio.mp4');
  if(!fs.existsSync(audioVideoPath))await execute(media.resolveBundledFfmpeg(),['-v','error','-i',refPath,'-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=5','-c:v','copy','-c:a','aac','-shortest','-movflags','+faststart',audioVideoPath],{windowsHide:true,timeout:60000});
  const charSwapVideo='data:video/mp4;base64,'+fs.readFileSync(audioVideoPath).toString('base64');
  if(correction){
   const prior=JSON.parse(fs.readFileSync(path.join(DIR,'minimax-h3-comfyui-charswap-private-final.json'),'utf8'));if(prior.status!=='failed')throw Error('Correction requires a definitely failed original task');
   video=charSwapVideo;
  }
  const samples=24000*3,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(1600*Math.sin(i*2*Math.PI*440/24000)),44+i*2);
  const audio='data:audio/wav;base64,'+wav.toString('base64');
  const flash=require('../backend/src/shared/seedance25FlashContract.json'),c=provider.H3_TURBO_CONTRACT;
  const cases=[...flash.models.map(model=>({model,prompt:model.endsWith('-multi')?'@Image 1 is a green toy robot. Follow the gentle motion of @Video 1, soft studio lighting.':'A green toy robot gently waves in a beige studio, static camera.',duration:4,resolution:'480p',ratio:model.endsWith('-i2v')?'adaptive':'16:9',generate_audio:true,seed:0,...(model.endsWith('-i2v')?{firstFrame:image,lastFrame:image}:model.endsWith('-multi')?{refImages:[image],videos:[video],audios:[audio],omni_reference_task_type:'reference'}:{})})),
   {model:c.charswap.model,prompt:'Replace the subject in the video with the green robot in <Picture 1>, preserve camera and motion.',images:[image],videos:[charSwapVideo],frames:124,resolution:'480p',ratio:'auto',seed:0},
   {model:c.wuxi.model,prompt:'The robot in <Picture 1> gently waves, follow the video motion and background sound.',images:[image],videos:[video],audios:[audio],seconds:'5',resolution:'480p',ratio:'16:9',seed:0},
   {model:c.wf.model,prompt:'The robot in <Picture 1> gently waves to the rhythm of <Audio 1>, static camera.',images:[image],audios:[audio],seconds:'3',resolution:'480p',ratio:'16:9'},
   {model:c.selflift.model,prompt:'The robot in <Picture 1> gently waves to the rhythm of <Audio 1>, static camera.',images:[image],audios:[audio],seconds:'3',resolution:'480p',ratio:'16:9'}];
  for(const request of cases){const model=request.model,label=model+(correction?'-audio-corrected':''),started=Date.now(),h3=model.startsWith('minimax-');
   if(correction&&model!==c.charswap.model)continue;
   if(process.env.T8_LIVE_MODELS&&!process.env.T8_LIVE_MODELS.split(',').includes(model))continue;
   if(report.results.find(row=>row.model===model&&row.passed))continue;
   const correctedPath=path.join(DIR,'charswap-audio-report.json');
   if(!correction&&model===c.charswap.model&&fs.existsSync(correctedPath)&&JSON.parse(fs.readFileSync(correctedPath,'utf8')).results?.some(row=>row.model===model&&row.passed))continue;
   try{
    log({model,phase:'start'});const journal=path.join(DIR,label+(correction?'-private-correction.json':'-private-task.json'));
    if(!correction&&!fs.existsSync(journal)&&fs.readdirSync(DIR).filter(n=>n.endsWith('-private-task.json')).length>=10)throw Error('Creation cap reached');
    // Free price check before creation. Token-priced /v1/videos may have no estimate.
    if(!fs.existsSync(journal)){
     const built=await(h3?provider.buildH3TurboPayload(request,key):provider.buildSeedance25Payload(request,key));
     const estimate=await network.fetch('https://api.seedance.nz/v1/video/generations/estimate',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(built.payload)});
     let data={};try{data=await estimate.json();}catch{}
     report.estimates??={};report.estimates[model]={httpStatus:estimate.status,available:data.estimate_available,amount:data.amount,currency:data.currency};persist();log({model,phase:'estimate',...report.estimates[model]});
    }
    const id=await submitOnce(journal,model,request,input=>h3?provider.submitH3TurboVideoTask(input,key):provider.submitTask(input,key));
    let result;const final=path.join(DIR,label+'-private-final.json');if(fs.existsSync(final))result=JSON.parse(fs.readFileSync(final,'utf8'));
    for(let poll=0;!result||!['succeeded','failed'].includes(result.status);poll++){
     if(poll>=540)throw Error('Original task polling timed out; never replay');
     result=await(h3?provider.queryH3TurboVideoTask(id,key,{model}):provider.queryTask(id,key));
     log({model,phase:'poll',status:result.status});if(['succeeded','failed'].includes(result.status))save(label+'-private-final.json',result);else await new Promise(r=>setTimeout(r,5000));
    }
    if(result.status!=='succeeded')throw Object.assign(Error(result.failReason||'Original upstream task failed'),{code:'UPSTREAM_TASK_FAILED'});
    const saved=await download(result.videoUrl,'video','sd25-h3-live:'+id);if(!saved.url)throw Error('Original output download failed; GET-only resume');
    const file=path.join(config.OUTPUT_DIR,path.basename(saved.url)),bytes=fs.readFileSync(file);
    const {stdout}=await execute(media.resolveBundledFfprobe(),['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,timeout:120000,maxBuffer:1024*1024}),probe=JSON.parse(stdout),stream=probe.streams.find(s=>s.codec_type==='video');if(!stream)throw Error('No video stream');
    await execute(media.resolveBundledFfmpeg(),['-v','error','-threads','1','-i',file,'-map','0:v:0','-f','null','-'],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
    const row={model,passed:true,upstreamHttpStatus:result.upstreamHttpStatus,elapsedSeconds:(Date.now()-started)/1000,output:{bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),localFile:path.basename(saved.url),width:stream.width,height:stream.height,codec:stream.codec_name,frames:Number(stream.nb_frames),duration:Number(probe.format.duration),fullDecode:true}};
    report.results=report.results.filter(row=>row.model!==model);report.results.push(row);persist();log({model,phase:'passed',output:row.output});
   }catch(error){report.results=report.results.filter(row=>row.model!==model);report.results.push({model,passed:false,error:safeError(error)});persist();log({model,phase:'failed',...safeError(error)});}
  }
  const correctedPath=path.join(DIR,'charswap-audio-report.json'),fixed=!correction&&fs.existsSync(correctedPath)?JSON.parse(fs.readFileSync(correctedPath,'utf8')).results||[]:[];
  report.verifiedResults=report.results.map(row=>fixed.find(item=>item.model===row.model&&item.passed)||row);
  report.passed=report.verifiedResults.length===(correction?1:10)&&report.verifiedResults.every(r=>r.passed);persist();key=null;app.exit(report.passed?0:1);
 }catch(error){report.passed=false;report.error=safeError(error);persist();log({phase:'fatal',...report.error});key=null;app.exit(1);}
}
function launch(){
 execFileSync(process.execPath,['scripts/worktree-role.cjs','development'],{cwd:ROOT,stdio:'inherit'});
 if(!process.argv.includes('--confirm-live')||!process.env.SEEDANCE_NZ_API_KEY)throw Error('Explicit confirmation and process-only key required');
 fs.mkdirSync(DIR,{recursive:true});const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-sd25-h3-live-'));
 const env={...process.env,T8_SD25_H3_PROFILE:scratch,T8PC_DEV_DATA_ROOT:scratch,NODE_OPTIONS:'--max-old-space-size=768'};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[__filename,'--confirm-live',...['--charswap-audio-retest','--inspect-only'].filter(flag=>process.argv.includes(flag))],{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});delete process.env.SEEDANCE_NZ_API_KEY;delete env.SEEDANCE_NZ_API_KEY;
 const log=fs.createWriteStream(path.join(DIR,'live.log'),{flags:'a'});child.stdout.on('data',b=>{log.write(b);process.stdout.write(b);});child.stderr.on('data',b=>log.write(b));
 child.once('exit',code=>{log.end();if(path.dirname(path.resolve(scratch))===os.tmpdir()&&path.basename(scratch).startsWith('t8-sd25-h3-live-'))fs.rmSync(scratch,{recursive:true,force:true});process.exitCode=code??1;});
}
if(require.main===module||process.argv[1]&&path.resolve(process.argv[1])===__filename)(process.argv.includes('--launch')?Promise.resolve().then(launch):main()).catch(e=>{console.error(JSON.stringify({phase:'launcher-failed',name:e.name}));if(process.type==='browser')require('electron').app.exit(1);else process.exitCode=1;});
