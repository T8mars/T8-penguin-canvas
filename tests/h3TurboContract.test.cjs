const {test}=require('node:test'),assert=require('node:assert/strict');
const c=require('../backend/src/shared/h3TurboContract.json'),provider=require('../backend/src/providers/seedanceNz');
const api=import('../backend/src/shared/h3TurboContract.mjs').then(m=>m.createH3TurboContract(c));
test('exact defaults, image-only native seed and format',async()=>{
 const a=await api;
 assert.deepEqual(a.build({model:c.video.model,prompt:'test'}),{model:c.video.model,prompt:'test',seconds:'5',metadata:{resolution:'480p',ratio:'16:9'}});
 assert.deepEqual(a.build({model:c.minimax.model,prompt:'test',seed:0}).metadata,{resolution:'2k',ratio:'1:1',seed:0,output_format:'jpeg'});
 assert.deepEqual(a.build({model:c.qwen.model,prompt:'test'}).metadata,{resolution:'1k',ratio:'1:1'});
});
test('Qwen UTF-8 boundary, 720p only editing, no inherited output/size/count',async()=>{
 const a=await api,b={model:c.qwen.model,prompt:'测'.repeat(2730)+'ab'};
 assert.doesNotThrow(()=>a.build(b));assert.throws(()=>a.build({...b,prompt:b.prompt+'a'}));
 assert.throws(()=>a.build({...b,resolution:'720p'}));assert.doesNotThrow(()=>a.build({...b,resolution:'720p',images:['x']}));
 for(const field of ['output_format','n','size','width','height','megapixels'])assert.throws(()=>a.build({...b,[field]:1}));
});
test('all resolutions, ratios, seconds and seed boundaries',async()=>{
 const a=await api;
 for(const spec of Object.values(c))for(const resolution of spec.resolutions)for(const ratio of spec.ratios)assert.doesNotThrow(()=>a.build({model:spec.model,prompt:'test',images:['x'],resolution,ratio}));
 for(let n=3;n<=15;n++)assert.equal(a.build({model:c.video.model,prompt:'x',seconds:String(n)}).seconds,String(n));
 for(const seconds of [3,'03','2','16','5.0'])assert.throws(()=>a.build({model:c.video.model,prompt:'x',seconds}));
 for(const seed of [-2,0.1,2147483648])assert.throws(()=>a.build({model:c.minimax.model,prompt:'x',seed}));
 assert.throws(()=>a.build({model:c.video.model,prompt:'x',seed:0}));
});
test('ordered duplicate references remain; caps reject rather than truncate',async()=>{
 const a=await api;
 for(const spec of Object.values(c)){
  const images=Array(spec.maxImages).fill('same');assert.deepEqual(a.build({model:spec.model,prompt:'x',images}).images,images);
  assert.throws(()=>a.build({model:spec.model,prompt:'x',images:[...images,'x']}));
 }
 assert.deepEqual(a.build({model:c.video.model,prompt:'x',audios:['a','b','a']}).metadata.audio_urls,['a','b','a']);
 assert.throws(()=>a.build({model:c.video.model,prompt:'x',audios:Array(4).fill('x')}));
 assert.throws(()=>a.build({model:c.video.model,prompt:'x',videos:['x']}));
});
test('backend rejects corrupt/over-limit final media before ANY upload',async()=>{
 const sharp=require('sharp'),image='data:image/png;base64,'+(await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
 let calls=0;const options={fetchImpl:async()=>{calls++;throw Error('must not upload');}};
 await assert.rejects(provider.buildH3TurboPayload({model:c.video.model,prompt:'x',images:[image,'data:image/png;base64,YmFk']},'test',options));
 await assert.rejects(provider.buildH3TurboPayload({model:c.video.model,prompt:'x',images:[image],audios:['data:audio/wav;base64,YmFk']},'test',options));
 assert.equal(calls,0);
});
test('legacy video endpoint and TaskDto success, wrong model rejected',async()=>{
 let requests=[];const options={fetchImpl:async(url,init)=>{requests.push([url,init]);return new Response(JSON.stringify(init.method==='POST'?{data:{id:'unit-task'}}:{data:{model:c.video.model,status:'SUCCESS',result_url:'https://example.com/video.mp4'}}),{status:200});}};
 const task=await provider.submitH3TurboVideoTask({model:c.video.model,prompt:'test',seconds:'3'},'test',options);
 assert.equal(task.taskId,'unit-task');assert.match(requests[0][0],/\/v1\/video\/generations$/);assert.equal(JSON.parse(requests[0][1].body).seconds,'3');
 const result=await provider.queryH3TurboVideoTask(task.taskId,'test',options);assert.equal(result.status,'succeeded');assert.equal(result.model,c.video.model);
 await assert.rejects(provider.submitH3TurboVideoTask({model:'hailuo-h3-t2v',prompt:'x'},'test',options));
});
test('authority, published capability metadata and recovery keep the exact provider/model',()=>{
 const authority=require('../backend/src/collaboration/runIntentAuthority');
 const catalog=require('../backend/src/shared/creativeModelCatalog.json');
 const recovery=require('../backend/src/services/runRecovery');
 for(const spec of Object.values(c)){
  const video=spec===c.video,node={id:'fixture',type:video?'video':'image',data:{model:spec.model,apiModel:spec.model,mainId:spec.model,providerSource:'zhenzhen',...(video?{videoBuiltinSource:'seedance-nz'}:{imageBuiltinSource:'seedance-nz'})}};
  assert.deepEqual(authority.providerDeclarationForNode(node),{provider:'seedance-nz',model:spec.model});
  const entries=catalog[video?'video':'image'].filter(row=>row.provider==='seedance-nz'&&row.model===spec.model);assert.equal(entries.length,1);
  assert.equal(entries[0].parameters[video?'maxReferenceImages':'maxReferenceImages'],spec.maxImages);
 }
 assert.ok(recovery.RECOVERY_KINDS.has('h3-lowprice'));
 const descriptor=recovery.normalizeRunRecoveryDescriptor({kind:'h3-lowprice',model:c.video.model,taskId:'fixture/id'});
 assert.deepEqual(recovery.recoveryRequest('http://127.0.0.1:18766',descriptor),{url:'http://127.0.0.1:18766/api/proxy/video/h3-lowprice/status/fixture%2Fid',options:{method:'GET'}});
});
