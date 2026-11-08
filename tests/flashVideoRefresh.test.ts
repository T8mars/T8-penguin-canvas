import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {FLASH_VIDEO_CONTRACT,flashVideoProfile,validFlashVideoReferences,KLING_FLASH_MODEL,OMNI12_FLASH_MODEL} from '../src/utils/flashVideo';
import {VIDEO_MODELS,videoModelOptionsForSource,inferVideoBuiltinSource} from '../src/providers/models';
import {buildNewImageRequest} from '../src/utils/g26Krea';
import {workflowManifestToFragment} from '../src/utils/workflowResource';
import {isConnectionValid} from '../src/config/portTypes';
import {inferRunRecoveryDescriptor} from '../src/utils/runRecovery';
const require=createRequire(import.meta.url),provider=require('../backend/src/providers/seedanceNz'),image=require('../backend/src/providers/g26Krea3d');
test('new Flash profiles are selectable only in the existing budget Kling/Veo families; old defaults stay intact',()=>{
 for(const [model,family]of [[KLING_FLASH_MODEL,'kling-v3.0'],[OMNI12_FLASH_MODEL,'veo3.1']]){
  const definition=VIDEO_MODELS.find(item=>item.id===family)!;
  assert.ok(videoModelOptionsForSource(definition,'seedance-nz').some(option=>option.value===model));
  assert.ok(!videoModelOptionsForSource(definition,'zhenzhen').some(option=>option.value===model));
  assert.equal(inferVideoBuiltinSource(model),'seedance-nz');
 }
 assert.equal(VIDEO_MODELS.find(item=>item.id==='kling-v3.0')!.apiModelOptions[0].value,'kling-v3.0-std-t2v');
 assert.equal(flashVideoProfile('constructor'),undefined);
});
test('production Flash builder retains string seconds and exact ordered video arrays without old Omni fields',async()=>{
 for(const [model,profile]of Object.entries(FLASH_VIDEO_CONTRACT.models)){
  const videos=Array.from({length:profile.maxVideos},()=>`data:video/mp4;base64,${Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex').toString('base64')}`);
  const request={model,prompt:'A penguin waves',duration:profile.maxSeconds,ratio:profile.ratios.at(-1),resolution:profile.resolutions.at(-1),videos};
  let uploads=0;
  const built=await provider.buildPayload(request,'fixture-key',{uploadCacheTtlMs:0,uploadIntervalMs:0,fetchImpl:async()=>new Response(JSON.stringify({url:`https://media.example/${++uploads}.mp4`}),{headers:{'content-type':'application/json'}})});
  assert.deepEqual(built.payload,{model,prompt:request.prompt,seconds:String(request.duration),resolution:request.resolution,aspect_ratio:request.ratio,metadata:{video_url:Array.from({length:profile.maxVideos},(_,i)=>`https://media.example/${i+1}.mp4`)}});
  assert.equal(built.taskType,'v2v');
  assert.equal(validFlashVideoReferences(model,[],videos,[]),true);
 }
});
test('invalid Flash references, timing and unsupported legacy fields fail before uploads or POST',async()=>{
 let requests=0;const options={fetchImpl:async()=>{requests++;throw Error('Unexpected network');}};
 for(const [model,profile]of Object.entries(FLASH_VIDEO_CONTRACT.models)){
  const base={model,prompt:'test',duration:3,ratio:'16:9',resolution:'720p'};
  for(const patch of [{duration:2},{duration:profile.maxSeconds+1},{duration:3.1},{duration:true},{resolution:'invalid'},{ratio:'adaptive'},{refImages:Array(11).fill('https://media.example/a.png')},{videos:Array(profile.maxVideos+1).fill('https://media.example/a.mp4')},{refImages:['https://media.example/a.png'],videos:['https://media.example/a.mp4']},{audios:['https://media.example/a.wav']},{voiceIds:['id']},{imageElementIds:['id']}]){
   await assert.rejects(provider.buildPayload({...base,...patch},'fixture-key',options));
  }
  assert.equal(validFlashVideoReferences(model,['image'],['video'],[]),false);
 }
 assert.equal(requests,0);
});
test('LowPrice frontend and backend preserve 2K/4K quality/format; GIF omits all stale static and frame options',()=>{
 const model='zhenzhen-image-g-v2.6-lowprice';
 for(const resolution of ['1k','2k','4k']){
  const request=buildNewImageRequest(model,'Penguin',[],{g26Resolution:resolution,g26Quality:'high',g26Format:'webp'});
  assert.deepEqual(image.buildImage(request).payload,{model,prompt:'Penguin',n:1,resolution,size:'1:1',quality:'high',output_format:'webp'});
 }
 const request=buildNewImageRequest(model,'Penguin loop',[],{g26Mode:'gif',g26Resolution:'4k',g26FrameCount:16,g26Size:'21:9',g26Format:'webp'});
 assert.deepEqual(image.buildImage(request).payload,{model,prompt:'Penguin loop',n:1,size:'auto',output_format:'gif'});
 assert.throws(()=>image.buildImage({...request,images:['own.png']}));
});
test('nine refresh workflows import exact model identities and valid existing ports without credentials',()=>{
 const {CASES,workflow}=require('../scripts/generate-flash-refresh-workflows.cjs');
 assert.equal(CASES.length,9);
 for(const item of CASES){const w=workflow(item),fragment=workflowManifestToFragment(w);
  assert.equal(fragment.nodes.find(n=>n.id==='generation')!.data[item.kind==='image'?'apiModel':'model'],item.model);
  for(const edge of fragment.edges)assert.equal(isConnectionValid(fragment.nodes.find(n=>n.id===edge.source)!,fragment.nodes.find(n=>n.id===edge.target)!,edge),true);
  assert.doesNotMatch(JSON.stringify(w),/apiKey|taskId|https?:\/\/|klingV4Pending/);
 }
});
test('accepted Flash identities recover through GET on the original budget task, including older nodes without an explicit source',()=>{
 const recovery=require('../backend/src/services/runRecovery'),authority=require('../backend/src/collaboration/runIntentAuthority');
 for(const model of Object.keys(FLASH_VIDEO_CONTRACT.models)){
  const descriptor=inferRunRecoveryDescriptor({provider:'seedance-nz',model,taskId:'accepted-fixture'})!;
  assert.equal(descriptor.kind,'seedance');assert.equal(descriptor.taskProvider,'seedance-nz');
  const request=recovery.recoveryRequest('http://127.0.0.1',descriptor);assert.equal(request.options.method,'GET');assert.match(request.url,/seedance\/query\?taskId=accepted-fixture&taskProvider=seedance-nz/);
  const declaration=authority.providerDeclarationForNode({type:'video',data:{mainId:model===KLING_FLASH_MODEL?'kling-v3.0':'veo3.1',model}});
  assert.equal(declaration.provider,'seedance-nz');assert.equal(declaration.model,model);
 }
 for(const model of VIDEO_MODELS.find(entry=>entry.id==='kling-v3.0')!.apiModelOptions.map(option=>option.value)){
  const declaration=authority.providerDeclarationForNode({type:'video',data:{mainId:'kling-v3.0',model}});
  assert.deepEqual(declaration,{provider:'seedance-nz',model});
 }
});
