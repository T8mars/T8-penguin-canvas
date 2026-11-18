'use strict';
// Explicit, isolated verification. Journal accepted tasks and never replay POSTs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {submitOnce,safeError}=require('./verify-seedream-flash-live.cjs');
const ROOT=path.resolve(__dirname,'..'),DIR=path.join(ROOT,'local-private/kling-mai-qwen-20261119');
const save=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
async function main(){
 if(!process.argv.includes('--confirm-live'))throw Error('Explicit --confirm-live is required');
 let key=process.env.SEEDANCE_NZ_API_KEY;delete process.env.SEEDANCE_NZ_API_KEY;if(!key)throw Error('Process-only API key required');
 assert.equal(require('./worktree-role.cjs').inspectCurrentWorktree(ROOT,'development').ok,true);
 const {app,session}=require('electron'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'t8-nov19-live-'));
 app.setPath('userData',scratch);app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');process.env.T8PC_DEV_DATA_ROOT=path.join(scratch,'data');process.env.T8PC_DEV_PROJECT_DB_STORAGE_PROFILE='acceptance-small-v1';process.env.T8_ENABLE_LOCAL_PRIVATE='0';
 fs.mkdirSync(path.join(DIR,'outputs'),{recursive:true});const reportFile=path.join(DIR,'live-report.json'),report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):{schema:'t8-nov19-live-v1',results:{},startedAt:new Date().toISOString()};
 const persist=()=>save(reportFile,report),log=(id,phase,data={})=>process.stdout.write(JSON.stringify({id,phase,...data})+'\n');
 try{
  await app.whenReady();const network=session.fromPartition('t8-nov19-live'),bridge=require('../electron/systemFetchBridge.cjs');bridge.installChromiumResponseHeaderBridge(network);bridge.installGlobalSystemFetchBridge({chromiumFetch:network.fetch.bind(network),resolveHost:network.resolveHost.bind(network),refreshNetwork:async()=>{await network.forceReloadProxyConfig();await network.clearHostResolverCache();}});
  const config=require('../backend/src/config');config.OUTPUT_DIR=path.join(DIR,'outputs');config.SETTINGS_FILE=path.join(scratch,'unused-settings.json');
  const provider=require('../backend/src/providers/seedanceNz'),media=require('../backend/src/routes/proxy')._test,sharp=require('sharp'),contract=require('../backend/src/shared/nov19ModelsContract.json'),voices=require('../backend/src/shared/qwenAudio31Voices.json');
  const walletResponse=await network.fetch('https://api.seedance.nz/api/usage/wallet/',{headers:{Authorization:'Bearer '+key}}),wallet=await walletResponse.json();assert.equal(walletResponse.status,200);assert.ok(wallet.data?.amount>0,'No usable wallet balance');report.walletChecked=true;persist();log('account','usable');
  const png=await sharp(Buffer.from('<svg width="512" height="512"><rect width="512" height="512" fill="#f7eddb"/><ellipse cx="240" cy="330" rx="150" ry="35" fill="#d1c0a9"/><path d="M130 200h210v90q0 65-100 65t-100-65z" fill="#28a5a1"/><ellipse cx="235" cy="200" rx="110" ry="25" fill="#0c5d62"/><path d="M340 225q110-25 35 80" fill="none" stroke="#28a5a1" stroke-width="30"/><path d="M155 215L85 165v115l65 25" fill="#28a5a1"/><rect x="204" y="158" width="60" height="27" rx="10" fill="#28a5a1"/></svg>')).png().toBuffer();const ref='data:image/png;base64,'+png.toString('base64');
  const cases=[
   {id:'qwen-flash',kind:'audio',request:{model:contract.audio.models[0],prompt:'欢迎使用无限画布。',qwenAudio31:{voice:voices.flash[0].id,format:'wav',sample_rate:'22050',seed:0}}},
   {id:'qwen-plus',kind:'audio',request:{model:contract.audio.models[2],prompt:'今天的画布语音测试顺利完成。',qwenAudio31:{voice:voices.plus[0].id,format:'mp3',sample_rate:'22050',seed:0}}},
   {id:'qwen-next-reference-pcm',kind:'audio',request:()=>{const f=report.results['qwen-flash']?.outputs?.[0]?.file;assert.ok(f&&fs.existsSync(path.join(ROOT,f)),'Verified Flash WAV is required');return {model:contract.audio.models[1],prompt:'@voice1 平静自然地说：画布语音测试完成。',audioUrls:['data:audio/wav;base64,'+fs.readFileSync(path.join(ROOT,f)).toString('base64')],qwenAudio31:{format:'pcm',sample_rate:'48000',channels:'2',seed:0}};}},
   {id:'mai27-text',kind:'image',request:{model:contract.mai.models[0],prompt:'A turquoise ceramic teapot on a beige table, studio product photography, no text',size:'1:1',resolution:'1k',background:'opaque',n:1}},
   {id:'mai27-flash-reference',kind:'image',request:{model:contract.mai.models[1],prompt:'Turn the teapot glaze cobalt blue, keep the same simple composition and beige background.',images:[ref],background:'opaque',n:1}},
   {id:'kling-reference-batch',kind:'image',request:{model:contract.kling.model,prompt:'Two polished product photographs of the teapot in @Image1 on a cream table, different camera views, no text.',images:[ref],n:2,resolution:'2k',size:'1:1'}},
   {id:'kling-sequential',kind:'image',request:{model:contract.kling.model,prompt:'Two connected images of the same turquoise ceramic teapot: first on a cream table, then beside a small blue cup. Studio product photography, no text.',size:'1:1',resolution:'2k',sequential_image_generation:'auto',sequential_image_generation_options:{max_images:2}}},
  ];
  for(const item of cases){
   if(report.results[item.id]?.passed&&report.results[item.id].outputs.every(o=>fs.existsSync(path.join(ROOT,o.file))&&crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,o.file))).digest('hex')===o.sha256)){log(item.id,'already-verified');continue;}
   const request=typeof item.request==='function'?item.request():item.request,model=request.model;log(item.id,'prepare');
   try{
    const built=await(item.kind==='image'?provider.buildImagePayload(request,key):provider.buildAudioPayload(request,key));
    const estimate=await network.fetch('https://api.seedance.nz/v1/'+item.kind+'/generations/estimate',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(built.payload)});report.results[item.id]={model,estimateHttpStatus:estimate.status,passed:false};persist();assert.ok(estimate.ok,'Estimate failed; no generation submitted');
    const taskId=await submitOnce(path.join(DIR,item.id+'.state.private.json'),model,request,input=>item.kind==='image'?provider.submitImageTask(input,key):provider.submitAudioTask(input,key));log(item.id,'poll');
    let result,polls=0,previous='',start=Date.now();const recipe={model,outputFormat:built.payload.metadata?.format,sampleRate:built.payload.metadata?.sample_rate,channels:built.payload.metadata?.channels};
    while(Date.now()-start<60*60_000){result=await(item.kind==='image'?provider.queryImageTask(taskId,key):provider.queryAudioTask(taskId,key,recipe));polls++;if(result.status!==previous)log(item.id,result.status);previous=result.status;if(result.status==='failed')throw Error(result.failReason||'Original task failed');if(result.status==='succeeded')break;await new Promise(r=>setTimeout(r,5000));}
    assert.equal(result?.status,'succeeded','Original task nonterminal; resume GET only');const urls=item.kind==='image'?result.imageUrls:result.audioUrls;assert.ok(urls?.length);if(item.id.startsWith('kling-'))assert.equal(urls.length,2);else assert.equal(urls.length,1);
    const outputs=[];
    for(let index=0;index<urls.length;index++){
     const remote=await media.fetchProxyRemoteMedia(urls[index],{trustedProviderOutput:true,allowedKinds:[item.kind],maxBytes:128*1024*1024}),raw=remote.buffer;
     let buffer=raw,ext=item.kind==='image'?'png':media.verifiedProxyMediaExtension(remote),info={};
     if(item.kind==='image'){const meta=await sharp(buffer,{failOn:'error'}).metadata(),decoded=await sharp(buffer,{failOn:'error'}).raw().toBuffer(),stats=await sharp(buffer).stats();assert.equal(meta.format,'png');assert.ok(decoded.length&&stats.channels.some(s=>s.stdev>1));info={width:meta.width,height:meta.height,fullDecode:true,nonBlank:true};}
     else if(result.pcmSampleRate&&!require('../backend/src/utils/pcmAudio').hasAudioContainerHeader(buffer)){buffer=require('../backend/src/utils/pcmAudio').wrapPcm16Wav(buffer,result.pcmSampleRate,result.pcmChannels||1,128*1024*1024);ext='wav';info.rawPcmWrapped=true;}
     const file=path.join(DIR,'outputs',item.id+'-'+index+'.'+ext);fs.writeFileSync(file,buffer);
     if(item.kind==='audio'){
      const audioTools=require('../backend/src/providers/llmMedia'),probe=JSON.parse(execFileSync(audioTools.resolveBundledFfprobe(),['-v','error','-show_entries','format=duration:stream=codec_name,channels,sample_rate','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:60000}));
      const decoded=execFileSync(audioTools.resolveBundledFfmpeg(),['-v','error','-threads','1','-i',file,'-f','s16le','-acodec','pcm_s16le','pipe:1'],{windowsHide:true,timeout:60000,maxBuffer:128*1024*1024});assert.ok(Number(probe.format.duration)>0&&decoded.some(b=>b!==0));if(item.id==='qwen-next-reference-pcm')assert.equal(probe.streams[0].channels,2);info={...info,duration:Number(probe.format.duration),...probe.streams[0],fullDecode:true,nonSilent:true};
     }
     outputs.push({file:path.relative(ROOT,file).replaceAll('\\','/'),bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),...info});
    }
    report.results[item.id]={...report.results[item.id],passed:true,model,providerTerminalStatus:result.status,upstreamHttpStatus:result.upstreamHttpStatus,polls,outputs};log(item.id,'verified',{outputs:outputs.length});
   }catch(error){report.results[item.id]={...report.results[item.id],passed:false,model,error:safeError(error,key)};log(item.id,'failed',{error:safeError(error,key)});}
   persist();
  }
  report.passed=cases.every(c=>report.results[c.id]?.passed);report.completedAt=new Date().toISOString();report.ownedScratch=scratch;delete report.error;persist();key=null;
  app.exit(report.passed?0:1);
 }catch(error){report.passed=false;report.error=safeError(error,key);persist();process.stderr.write(safeError(error,key)+'\n');key=null;app.exit(1);}
}
async function launch(){
 if(!process.argv.includes('--confirm-live'))throw Error('Explicit --confirm-live is required');
 const input=require('node:readline').createInterface({input:process.stdin,terminal:false});let key=process.env.SEEDANCE_NZ_API_KEY||await new Promise(r=>input.once('line',v=>r(v.trim())));input.close();if(!key)throw Error('Process-only API key required');
 const env={...process.env,SEEDANCE_NZ_API_KEY:key};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require('electron'),[__filename,'--confirm-live'],{cwd:ROOT,env,windowsHide:true,stdio:['ignore','inherit','inherit']});delete env.SEEDANCE_NZ_API_KEY;key=null;
 child.once('exit',code=>{let cleanup='not-passed';if(code===0){try{const report=JSON.parse(fs.readFileSync(path.join(DIR,'live-report.json'),'utf8')),scratch=report.ownedScratch;if(!report.passed||path.dirname(path.resolve(scratch))!==path.resolve(os.tmpdir())||!path.basename(scratch).startsWith('t8-nov19-live-'))throw Error('Invalid owned scratch');fs.rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:200});cleanup='clean';}catch(error){cleanup=safeError(error);code=1;}}save(path.join(DIR,'live-exit.json'),{exitCode:code,cleanup});process.exitCode=code||0;});child.once('error',()=>{process.exitCode=1;});
}
if(require.main===module||path.resolve(process.argv[1]||'')===__filename)(process.argv.includes('--launch')?launch():main()).catch(e=>{process.stderr.write(safeError(e)+'\n');process.exitCode=1;});
