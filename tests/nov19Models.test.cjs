const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const c=require('../backend/src/shared/nov19ModelsContract.json'),voices=require('../backend/src/shared/qwenAudio31Voices.json'),provider=require('../backend/src/providers/seedanceNz');
const api=import('../backend/src/shared/nov19ModelsContract.mjs').then(m=>m.createNov19ModelsContract(c,voices));
test('Kling image keeps exact counts, ordered duplicate slots, group exclusion and mixed prompt limits',async()=>{
 const a=await api;for(const size of c.kling.sizes)for(const resolution of c.kling.resolutions){const p=a.image({model:c.kling.model,prompt:'@Image2',images:['x','x'],size,resolution,n:9});assert.deepEqual(p.images,['x','x']);assert.equal(p.n,9);}
 const group=a.image({model:c.kling.model,prompt:'two scenes',sequential_image_generation:'auto',sequential_image_generation_options:{max_images:2}});assert.equal(group.n,undefined);assert.deepEqual(group.sequential_image_generation_options,{max_images:2});
 for(const patch of [{n:10},{n:1.5},{size:'2048x2048'},{resolution:'1k'},{prompt:'@Image1'},{nsfw_check:'false'},{sequential_image_generation:'auto'},{sequential_image_generation:'auto',n:2,sequential_image_generation_options:{max_images:2}},{prompt:'茶'.repeat(21001)}])assert.throws(()=>a.image({model:c.kling.model,prompt:'teapot',...patch}));
 assert.doesNotThrow(()=>a.image({model:c.kling.model,prompt:'a'.repeat(25000)+'茶'.repeat(10500)}));assert.throws(()=>a.image({model:c.kling.model,prompt:'a'.repeat(25000)+'茶'.repeat(10501)}));
});
test('MAI 2.7 supports exact 2048-square area and ignores all sizing on reference edits without old parameters',async()=>{
 const a=await api;for(const model of c.mai.models){const p=a.image({model,prompt:'teapot',width:2048,height:2048,web_grounding:true,auto_aspect_ratio:true,seed:1});assert.equal(p.width,2048);assert.equal(p.height,2048);for(const k of ['size','resolution','web_grounding','auto_aspect_ratio','seed'])assert.equal(p[k],undefined);
  assert.equal(a.image({model,prompt:'teapot',width:2049,height:1025}).width,2048);
  const edit=a.image({model,prompt:'blue',images:['x'],size:'invalid',width:-1,height:NaN,resolution:'4k'});assert.deepEqual(edit,{model,prompt:'blue',nsfw_check:false,n:1,background:'auto',images:['x']});
  for(const patch of [{size:'auto'},{size:'5:1'},{width:767,height:1024},{width:2049,height:2048},{n:2},{background:'transparent'},{resolution:'4k'},{prompt:'a'.repeat(20001)},{images:Array(6).fill('x')}])assert.throws(()=>a.image({model,prompt:'teapot',...patch}));
 }
});
test('Qwen 3.1 has exact model voice catalogs, native zero seeds and model-specific language/rate/format constraints',async()=>{
 const a=await api;assert.equal(voices.flash.length,69);assert.equal(voices.plus.length,4);
 for(const model of [c.audio.models[0],c.audio.models[2]]){const spec=a.audioProfile(model);for(const voice of spec.voices){const p=a.audio({model,prompt:'hello',metadata:{voice:voice.id,seed:0}});assert.equal(p.seed,0);assert.equal(p.metadata.voice,voice.id);}for(const metadata of [{voice:'Cherry'},{seed:65536},{pitch:0},{format:'opus',sample_rate:'22050'},{enable_ssml:true},{volume:.5},{language_hint:'xx'}])assert.throws(()=>a.audio({model,prompt:'hello',metadata}));
  assert.throws(()=>a.audio({model,prompt:'hello',audioUrls:['x']}));assert.equal(a.audio({model,prompt:'hello'}).seed,undefined);
 }
 const next=c.audio.models[1],r=a.audio({model:next,prompt:'@voice2 hello',audioUrls:['x','x'],metadata:{voice:'ignored',pitch:99,instruction:'ignored',seed:2147483647,channels:'2',format:'pcm'}});assert.deepEqual(r.metadata.audio_urls,['x','x']);assert.equal(r.metadata.channels,'2');assert.equal(r.seed,2147483647);for(const k of ['voice','pitch','instruction','enable_ssml','enable_cbr'])assert.equal(r.metadata[k],undefined);
 for(const patch of [{prompt:'@voice1 hi'},{audioUrls:Array(4).fill('x')},{prompt:'x'.repeat(3001)},{metadata:{channels:'3'}},{metadata:{format:'opus'}},{metadata:{sample_rate:'22050'}},{metadata:{seed:2147483648}}])assert.throws(()=>a.audio({model:next,prompt:'hi',...patch}));
});
test('production provider validates the last image and audio before uploading anything; old MAI/Qwen stay unchanged',async()=>{
 const png='data:image/png;base64,'+(await require('sharp')({create:{width:320,height:320,channels:3,background:'red'}}).png().toBuffer()).toString('base64');let calls=0;const options={fetchImpl:async()=>{calls++;throw Error('Unexpected upload');}};
 await assert.rejects(provider.buildImagePayload({model:c.kling.model,prompt:'hi',images:[png,'data:image/png;base64,YmFk']},'fixture',options));
 const tiny='data:image/png;base64,'+(await require('sharp')({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer()).toString('base64');await assert.rejects(provider.buildImagePayload({model:c.kling.model,prompt:'hi',images:[png,tiny]},'fixture',options));
 await assert.rejects(provider.buildAudioPayload({model:c.audio.models[1],prompt:'hi',audioUrls:['data:audio/wav;base64,YmFk']},'fixture',options));assert.equal(calls,0);
 const aac=require('node:child_process').execFileSync(require('../backend/src/providers/llmMedia').resolveBundledFfmpeg(),['-v','error','-threads','1','-f','lavfi','-i','sine=frequency=440:duration=0.2','-c:a','aac','-f','adts','pipe:1'],{windowsHide:true});
 await assert.rejects(provider.buildAudioPayload({model:c.audio.models[1],prompt:'hi',audioUrls:['data:audio/aac;base64,'+aac.toString('base64')]},'fixture',{...options,seedance25DurationProbe:()=>.2}),/WAV\/MP3\/OGG/);assert.equal(calls,0,'ADTS AAC shares MPEG sync bits but must not be uploaded as MP3');
 assert.deepEqual((await provider.buildAudioPayload({model:'qwen3-tts-flash',prompt:'hello',voice:'Cherry'},'fixture')).payload,{model:'qwen3-tts-flash',prompt:'hello',metadata:{voice:'Cherry',language_type:'Chinese'}});
 assert.equal((await provider.buildImagePayload({model:'mai-image-2-6',prompt:'hello',web_grounding:true,size:'auto'},'fixture')).payload.web_grounding,true);
});
test('Qwen PCM stereo wrapping preserves sample bytes and frame alignment; Doubao mono limits remain strict',()=>{
 const {wrapPcm16Wav,wrapPcm16MonoWav}=require('../backend/src/utils/pcmAudio'),b=Buffer.from([1,2,3,4,5,6,7,8]),wav=wrapPcm16Wav(b,48000,2);assert.equal(wav.readUInt16LE(22),2);assert.equal(wav.readUInt32LE(24),48000);assert.equal(wav.readUInt16LE(32),4);assert.deepEqual(wav.subarray(44),b);assert.throws(()=>wrapPcm16Wav(Buffer.from([1,2]),48000,2));assert.throws(()=>wrapPcm16MonoWav(b,12000));
});
test('all six identities are on the shared authority/schema/runtime path with old family IDs and defaults preserved',()=>{
 const authority=require('../backend/src/collaboration/runIntentAuthority'),schema=require('../backend/src/shared/canvasNodeSchema.json'),catalog=require('../tools/zcanvas-cli/scripts/creativeRuntimeCatalogArtifacts.cjs').buildRuntimeCatalog();
 for(const model of [c.kling.model,...c.mai.models]){assert.deepEqual(authority.providerDeclarationForNode({type:'image',data:{model:c.mai.models.includes(model)?'mai-image-2-6':model,apiModel:model,imageBuiltinSource:'seedance-nz'}}),{provider:'seedance-nz',model});assert.equal(catalog.image.filter(x=>x.provider==='seedance-nz'&&x.model===model).length,1);}
 for(const model of c.audio.models){assert.deepEqual(authority.providerDeclarationForNode({type:'audio',data:{audioProviderMode:'qwen3-tts',qwenTtsModel:model}}),{provider:'seedance-nz',model});assert.equal(catalog.audio.filter(x=>x.provider==='seedance-nz'&&x.model===model).length,1);assert.ok(schema.types.find(x=>x.type==='audio').generation.allowedDataFields.qwenTtsModel.enum.includes(model));}
 assert.equal(schema.types.find(x=>x.type==='image').generation.defaults.model,'gpt-image-2');
});

test('durable Qwen recovery emits only original-task GET with exact PCM stereo recipe',()=>{
 const {normalizeRunRecoveryDescriptor,recoveryRequest}=require('../backend/src/services/runRecovery');
 for(const model of c.audio.models){const descriptor=normalizeRunRecoveryDescriptor({kind:'seed-audio',model,taskId:'original/task',outputFormat:'pcm',sampleRate:'48000',channels:'2',apiKey:'never-copy'});const request=recoveryRequest("http://fixture",descriptor);assert.equal(request.options.method,'GET');const url=new URL(request.url,'http://fixture');assert.ok(url.pathname.endsWith('/original%2Ftask'));assert.equal(url.searchParams.get('model'),model);assert.equal(url.searchParams.get('sampleRate'),'48000');assert.equal(url.searchParams.get('channels'),model.endsWith('-next')?'2':'1');assert.doesNotMatch(JSON.stringify(request),/never-copy|POST/);}
});
