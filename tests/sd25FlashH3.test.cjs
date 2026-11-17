const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const c=require('../backend/src/shared/h3TurboContract.json'),flash=require('../backend/src/shared/seedance25FlashContract.json'),p=require('../backend/src/providers/seedanceNz');
const api=import('../backend/src/shared/h3TurboContract.mjs').then(m=>m.createH3TurboContract(c));
const specs=[c.charswap,c.wuxi,c.wf,c.selflift];
const base=spec=>({model:spec.model,prompt:'test',images:['image'],...(spec.minVideos?{videos:['video']}:{})});
test('four H3 contracts: every documented resolution/ratio and duration, model-specific limits',async()=>{
 const a=await api;
 for(const spec of specs){
  for(const resolution of spec.resolutions)for(const ratio of a.ratios(spec,resolution))for(let n=spec.minSeconds;n<=15;n++)assert.doesNotThrow(()=>a.build({...base(spec),resolution,ratio,seconds:String(n)}));
  for(const seconds of [String(spec.minSeconds-1),'16',5,'05','5.0'])assert.throws(()=>a.build({...base(spec),seconds}));
  assert.doesNotThrow(()=>a.build({...base(spec),images:Array(spec.maxImages).fill('repeat')}));
  assert.throws(()=>a.build({...base(spec),images:Array(spec.maxImages+1).fill('repeat')}));
  assert.throws(()=>a.build({...base(spec),audios:Array(spec.maxAudios+1).fill('repeat')}));
  assert.throws(()=>a.build({...base(spec),videos:Array(spec.maxVideos+1).fill('repeat')}));
 }
 assert.throws(()=>a.build({...base(c.charswap),images:[]}));assert.throws(()=>a.build({...base(c.charswap),videos:[]}));
 assert.throws(()=>a.build({...base(c.selflift),images:[],audios:['a']}));assert.throws(()=>a.build({...base(c.wuxi),images:[],videos:['v']}));
 assert.doesNotThrow(()=>a.build({...base(c.wf),images:[],audios:['a']}));
});
test('H3 charswap frame mode is exclusive and exactly 22+17n; ratio and seed dependencies',async()=>{
 const a=await api;
 for(const frames of a.frames){const v=a.build({...base(c.charswap),frames,seed:0});assert.equal(v.seconds,undefined);assert.equal(v.metadata.frames,frames);assert.equal(v.metadata.seed,0);}
 for(const frames of [21,23,363,'124',124.5])assert.throws(()=>a.build({...base(c.charswap),frames}));
 assert.throws(()=>a.build({...base(c.charswap),frames:124,seconds:'5'}));
 assert.throws(()=>a.build({...base(c.wuxi),frames:124}));
 for(const resolution of ['480p','1088p','auto'])assert.throws(()=>a.build({...base(c.charswap),resolution,ratio:'1:1'}));
 for(const spec of specs)for(const seed of [-1,0,2147483647]){const f=()=>a.build({...base(spec),seed});if(spec.nativeSeed)assert.doesNotThrow(f);else assert.throws(f);}
 for(const seed of [-2,0.5,2147483648])assert.throws(()=>a.build({...base(c.wuxi),seed}));
});
test('H3 ordered reference tags and duplicate slots remain exact',async()=>{
 const a=await api;const input={...base(c.wf),images:['x','x'],audios:['a','a'],prompt:'<Picture 2> follows <Audio 2>'};
 const v=a.build(input);assert.deepEqual(v.images,input.images);assert.deepEqual(v.metadata.audio_urls,input.audios);
 for(const prompt of ['<Picture 0>','<Picture 3>','<Audio 3>'])assert.throws(()=>a.build({...input,prompt}));
 assert.throws(()=>a.build({...base(c.wuxi),audios:['a'],prompt:'<Audio 1>'}));
});
test('new H3 TaskDto paths preserve exact identity, missing and mismatched identities fail safely',async()=>{
 for(const spec of specs){let submits=0;const options={fetchImpl:async(url,init={})=>{assert.match(url,/\/v1\/video\/generations/);if(init.method==='POST')submits++;return Response.json({data:{id:'fixture',model:spec.model,status:'SUCCESS',result_url:'https://example.com/result.mp4'}});}};
  const r=await p.queryH3TurboVideoTask('fixture','test',{...options,model:spec.model});assert.equal(r.model,spec.model);assert.equal(r.status,'succeeded');
  await assert.rejects(p.queryH3TurboVideoTask('fixture','test',{...options,model:c.video.model}),/mismatch/);assert.equal(submits,0);
 }
});
test('Flash all six model identities, limits, I2V ratio, no draft and exact wire fields',async()=>{
 const {createSeedance25FlashContract}=await import('../backend/src/shared/seedance25FlashContract.mjs'),a=createSeedance25FlashContract(flash);
 for(const model of flash.models){assert.equal(a.isFlash(model),true);const b={model,prompt:'test',duration:4,resolution:'480p',ratio:'adaptive',...(model.endsWith('-i2v')?{firstFrame:'x'}:model.endsWith('-multi')?{refImages:['x']}:{})};
  for(const patch of [{draft:true},{resolution:'1080p'}])assert.throws(()=>a.validate({...b,...patch}));
  if(model.endsWith('-t2v')){const built=await p.buildSeedance25Payload(b,'test');assert.equal(built.payload.seconds,'4');assert.equal(built.payload.model,model);assert.equal(built.payload.metadata.draft,undefined);}
  if(model.endsWith('-i2v'))assert.throws(()=>a.validate({...b,ratio:'16:9'}));
  if(model.endsWith('-multi'))for(const [key,cap]of [['refImages',10],['videos',5],['audios',5]])assert.throws(()=>a.validate({...b,[key]:Array(cap+1).fill('x')}));
 }
 const b={model:flash.models[0],videos:['video'],ratio:'adaptive',duration:-1,omni_reference_task_type:'edit'};
 assert.deepEqual(a.validate(b),{omni_reference_task_type:'edit'});assert.deepEqual(a.validate({...b,omni_reference_task_type:'auto'}),{});
 for(const patch of [{videos:[]},{ratio:'16:9'},{duration:4},{omni_reference_task_type:'other'}])assert.throws(()=>a.validate({...b,...patch}));
});
test('WF/SelfLift real TaskDto wire aliases normalize only the two observed exact identities',async()=>{
 for(const [model,alias]of [[c.wf.model,'minimax-h3-comfyui-max/10020'],[c.selflift.model,'minimax-h3-comfyui-max/10021']]){
  const options={model,fetchImpl:async()=>Response.json({data:{status:'SUCCESS',data:{status:'succeeded',model:alias},result_url:'https://example.com/video.mp4'}})};
  assert.equal((await p.queryH3TurboVideoTask('fixture','test',options)).model,model);
  await assert.rejects(p.queryH3TurboVideoTask('fixture','test',{...options,model:c.wuxi.model}),/mismatch/);
 }
 await assert.rejects(p.queryH3TurboVideoTask('fixture','test',{fetchImpl:async()=>Response.json({data:{model:'minimax-h3-comfyui-max/10022',status:'SUCCESS'}})}),/mismatch/);
});
test('CharSwap rejects a decoded source video without an audio stream before any upload',async()=>{
 const {execFileSync}=require('node:child_process'),media=require('../backend/src/providers/llmMedia');
 const buffer=execFileSync(media.resolveBundledFfmpeg(),['-v','error','-f','lavfi','-i','color=s=16x16:r=24:d=0.25','-c:v','libx264','-threads','1','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{windowsHide:true,timeout:30000});
 const image='data:image/png;base64,'+(await require('sharp')({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer()).toString('base64');let uploads=0;
 await assert.rejects(p.buildH3TurboPayload({...base(c.charswap),images:[image],videos:['data:video/mp4;base64,'+buffer.toString('base64')]},'test',{fetchImpl:async()=>{uploads++;throw Error('No upload expected');}}),error=>error.code==='h3_source_audio_required');assert.equal(uploads,0);
});
test('backend validates final Flash / H3 reference before uploading earlier valid slots',async()=>{
 const image='data:image/png;base64,'+(await require('sharp')({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer()).toString('base64');let calls=0;
 const options={fetchImpl:async()=>{calls++;throw Error('unexpected upload');}};
 for(const model of [c.wf.model,c.selflift.model,c.wuxi.model])await assert.rejects(p.buildH3TurboPayload({model,prompt:'test',images:[image],audios:['data:audio/wav;base64,YmFk']},'test',options));
 await assert.rejects(p.buildH3TurboPayload({...base(c.charswap),images:[image],videos:['data:video/mp4;base64,YmFk']},'test',options));
 await assert.rejects(p.buildSeedance25Payload({model:flash.models[0],prompt:'test',refImages:[image],videos:['data:video/mp4;base64,YmFk']},'test',options));
 assert.equal(calls,0);
});
test('schemas, catalog, authority and key-free workflows expose all ten without changing old defaults',()=>{
 const schema=require('../backend/src/shared/canvasNodeSchema.json'),catalog=require('../backend/src/shared/creativeModelCatalog.json'),authority=require('../backend/src/collaboration/runIntentAuthority');
 const sd=schema.types.find(t=>t.type==='seedance25');assert.equal(sd.generation.defaults.model,'seedance-2.5-global-standard-i2v');
 for(const model of [...flash.models,...specs.map(s=>s.model)]){const rows=catalog.video.filter(row=>row.provider==='seedance-nz'&&row.model===model);assert.equal(rows.length,1,model);assert.deepEqual(authority.providerDeclarationForNode({type:'video',data:{mainId:model.startsWith('seedance-')?'seedance-2.5':c.video.model,model,apiModel:model,videoBuiltinSource:'seedance-nz',providerSource:'zhenzhen'}}),{provider:'seedance-nz',model});}
 for(const item of require('../scripts/generate-sd25-flash-h3-workflows.cjs').CASES){const workflow=JSON.parse(fs.readFileSync('docs/workflows/'+item.name+'.json','utf8'));assert.equal(workflow.nodes.find(n=>n.id==='generate').data.model,item.model);assert.doesNotMatch(JSON.stringify(workflow),/sk-|task_|https?:|apiKey|binding_token/);}
});
