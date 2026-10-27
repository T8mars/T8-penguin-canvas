'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), sharp=require('sharp');
const {validate,build,normalize,contract}=require('../backend/src/providers/klingV4');
const provider=require('../backend/src/providers/seedanceNz');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const video=(model='kling-v4-t2v')=>({data:{status:'SUCCESS',data:{model,status:'succeeded',content:{video_urls:['https://media.example/a.mp4','https://media.example/a.mp4']}}}});
const auxiliary=(model,name,value)=>({data:{status:'SUCCESS',data:{model,status:'succeeded',result_text:JSON.stringify({results:[{name,text:value}]})}}});
test('Kling 4 exact per-model fields, integer seconds, omission of inactive fields',()=>{
  const p=validate({model:'kling-v4-i2v',images:['first','last'],ratio:'invalid',duration:30,negativePrompt:'stale',seed:99}).payload;
  assert.equal(p.seconds,'30');assert.deepEqual(p.metadata,{resolution:'720p'});assert.equal(p.prompt,undefined);assert.equal(p.seed,undefined);
  const voice=validate({model:'kling-v4-custom-voice',voiceName:'CanvasVoice',audioUrl:'audio',prompt:'ignored',duration:30}).payload;
  assert.deepEqual(voice,{model:'kling-v4-custom-voice',metadata:{voiceName:'CanvasVoice'}});
  assert.equal(validate({model:'kling-v4-t2v',prompt:'hello',watermark:'disabled'}).payload.metadata.watermark,false);
});
test('invalid input performs no upload or paid POST',async()=>{
  let calls=0;
  for(const input of [
    {model:'kling-v4-t2v',prompt:''},{model:'kling-v4-t2v',prompt:'hi',duration:2},{model:'kling-v4-t2v',prompt:'hi',duration:3.5},
    {model:'kling-v4-t2v',prompt:'中文'.repeat(5501)}, {model:'kling-v4-t2v',prompt:'a',images:['x']},
    {model:'kling-v4-custom-voice',voiceName:'x'.repeat(21),audioUrl:'audio'},
    {model:'kling-v4-custom-voice',voiceName:'x',audioUrl:'audio',videoId:'id'},
    {model:'kling-v4-custom-element',elementName:'robot',prompt:'robot',images:['only-one']},
    {model:'kling-v4-omni',prompt:'hi',images:Array(11).fill('x')},
    {model:'kling-v4-omni',prompt:'hi',videoElementIds:['1','2','3','4']},
    {model:'kling-v4-omni',prompt:'hi',imageElementIds:['same'],videoElementIds:['same']},
  ])await assert.rejects(provider.submitKlingTask(input,'fixture',{fetchImpl:async()=>{calls++;return json({id:'bad'});}}));
  assert.equal(calls,0);
});
test('images validated before uploads, preserve PNG order and reject duplicate element views',async()=>{
  const images={first:await sharp({create:{width:320,height:320,channels:3,background:'red'}}).png().toBuffer(),last:await sharp({create:{width:400,height:320,channels:3,background:'blue'}}).png().toBuffer()};
  const uploads=[],media={read:async source=>({buffer:images[source],mime:'image/png'}),upload:async source=>{uploads.push(source);return `https://input.example/${source}`;}};
  const built=await build({model:'kling-v4-i2v',images:['last','first']},'fixture',{},media);
  assert.deepEqual(built.payload.images,['https://input.example/last','https://input.example/first']);assert.deepEqual(uploads,['last','first']);uploads.length=0;
  await assert.rejects(build({model:'kling-v4-custom-element',elementName:'robot',prompt:'robot',images:['first','first']},'fixture',{},media),/不能重复/);assert.equal(uploads.length,0);
});
test('Omni combined limits, typed IDs and ordered media; video element restrictions before POST',async()=>{
  const request={model:'kling-v4-omni',prompt:'go',videos:['https://media.example/1.mp4','https://media.example/2.mp4'],imageElementIds:['image-a'],videoElementIds:['video-b'],voiceIds:['voice-c']};
  const media={read:async()=>({buffer:Buffer.from('fixture'),mime:'video/mp4'}),probe:async()=>({duration:15,width:1920,height:1080})};
  const built=await build(request,'fixture',{},media);assert.deepEqual(built.payload.metadata.video_url,request.videos);assert.deepEqual(built.payload.metadata.elementIds,['image-a','video-b']);
  await assert.rejects(build(request,'fixture',{}, {...media,probe:async()=>({duration:15.1})}),/30秒/);
  await assert.rejects(build({model:'kling-v4-custom-element',prompt:'robot',elementName:'robot',referenceType:'video_refer',videos:['https://media.example/1.mp4']},'fixture',{}, {...media,probe:async()=>({duration:3,width:1280,height:720})}),/1080p/);
});
test('all new models use the generations endpoint, and query is original-task GET',async()=>{
  const calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init});return init.method==='POST'?json({data:{task_id:'accepted-task'}}):json(video());};
  const accepted=await provider.submitKlingTask({model:'kling-v4-t2v',prompt:'robot'},'fixture',{fetchImpl});assert.equal(accepted.taskId,'accepted-task');
  assert.ok(calls[0].url.endsWith('/v1/video/generations'));assert.equal(JSON.parse(calls[0].init.body).seconds,'3');
  await provider.queryKlingV4Task('accepted-task','kling-v4-t2v','fixture',{fetchImpl});assert.ok(calls[1].url.endsWith('/v1/video/generations/accepted-task'));assert.notEqual(calls[1].init.method,'POST');
});
test('failed or ambiguous POST is not retried',async()=>{
  let count=0;await assert.rejects(provider.submitKlingTask({model:'kling-v4-t2v',prompt:'robot'},'fixture',{fetchImpl:async()=>{count++;throw Error('reset');}}));assert.equal(count,1);
});
test('terminal success requires correct model and complete media/auxiliary IDs; wrapper state wins',()=>{
  assert.deepEqual(normalize(video(),'kling-v4-t2v').videoUrls,['https://media.example/a.mp4','https://media.example/a.mp4']);
  const pending=video();pending.data.status='IN_PROGRESS';assert.equal(normalize(pending,'kling-v4-t2v').status,'pending');pending.data.status='FAILURE';assert.equal(normalize(pending,'kling-v4-t2v').status,'failed');
  assert.throws(()=>normalize(video('kling-v4-omni'),'kling-v4-t2v'),{code:'KLING_V4_MODEL_MISMATCH'});
  for(const model of contract.auxiliaryModels){const name=model.endsWith('element')?'element_id':'voice_id';const value=normalize(auxiliary(model,name,'reusable-id'),model);assert.equal(value[name==='element_id'?'elementId':'voiceId'],'reusable-id');assert.deepEqual(value.videoUrls,[]);assert.throws(()=>normalize(auxiliary(model,'other','no-id'),model));}
});
