import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { IMAGE_MODELS, VIDEO_MODELS, isZhenzhenBudgetImageModel, inferVideoBuiltinSource } from '../src/providers/models';
import { PREVIEW_MUSE_FLUX as c, buildPreviewImageRequest, previewImageSettings, fluxVariantSettings } from '../src/utils/previewMuseFlux';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { readHistoryBudgetImageInput } from '../src/utils/historyBudgetImageInput';
import historyContract from '../backend/src/shared/generationHistoryInputContract.json';
const require = createRequire(import.meta.url), provider = require('../backend/src/providers/seedanceNz'), pure = require('../backend/src/providers/previewMuseFlux');
const sharp = require('sharp');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const image = async (color='blue') => `data:image/png;base64,${(await sharp({create:{width:300,height:300,channels:3,background:color}}).png().toBuffer()).toString('base64')}`;
test('existing defaults and three requested tabs; all models use budget-house identity',()=>{
 assert.equal(IMAGE_MODELS[0].id,'gpt-image-2');assert.equal(VIDEO_MODELS[0].id,'grok-video-3');
 assert.equal(IMAGE_MODELS.find(m=>m.id===c.hy.model)?.tabLabel,'Hunyuan Image');
 assert.equal(IMAGE_MODELS.find(m=>m.id===c.muse.imageModel)?.tabLabel,'Muse Image');
 assert.deepEqual(IMAGE_MODELS.find(m=>m.id==='flux-3-image')!.apiModelOptions.map(m=>m.value),['flux-3-image',...c.flux.models]);
 assert.equal(VIDEO_MODELS.find(m=>m.id===c.muse.videoModel)?.label,'Muse Video');
 for(const model of pure.imageModels){assert.ok(provider.IMAGE_MODELS.has(model));assert.ok(isZhenzhenBudgetImageModel(model));}
 assert.equal(inferVideoBuiltinSource(c.muse.videoModel),'seedance-nz');
});
for(const model of pure.imageModels) test(`${model}: frontend request and backend payload agree`,async()=>{
 const flux=c.flux.models.includes(model),hy=model===c.hy.model,refs=model.endsWith('-i2i')?[await image()]:[];
 const request=buildPreviewImageRequest(model,' Blue toy robot ',refs,'1:1',hy?'1K':flux?'768sq':'',{});
 let uploads=0;
 const built=await provider.buildImagePayload(request,'test-only-key',{uploadIntervalMs:0,uploadCacheTtlMs:0,fetchImpl:async()=>{uploads++;return json({url:'https://provider.example/reference.png'});}});
 assert.equal(built.model,model);assert.equal(built.payload.prompt,'Blue toy robot');assert.equal(uploads,refs.length);
 assert.deepEqual(built.payload,{...request,...(refs.length?{images:['https://provider.example/reference.png']}:{})});
 if(flux)assert.equal(Object.hasOwn(built.payload,'n'),false);
});
test('HY paired pixel controls preserve non-multiples of 16 and validate all supplied values',()=>{
 const model=c.hy.model;
 assert.deepEqual(pure.buildPreviewMuseFluxPayload({model,prompt:'x',width:2000,height:1104}).payload,{model,prompt:'x',n:1,size:'auto',resolution:'1K',seed:0,width:2000,height:1104});
 assert.equal(pure.buildPreviewMuseFluxPayload({model,prompt:'x',size:'1001x1001'}).payload.size,'1001x1001');
 for(const values of [{width:256},{width:9000,height:256},{width:8192,height:8192},{width:256.1,height:256},{size:'no',width:1024,height:1024},{seed:-1},{resolution:'8K'}]) assert.throws(()=>pure.buildPreviewMuseFluxPayload({model,prompt:'x',...values}));
});
test('Flux exact mode and parameter whitelists preserve zero and false',()=>{
 for(const model of c.flux.models){const klein=model.includes('-klein-'),images=model.endsWith('-i2i')?['fixture']:[];
  const built=pure.buildPreviewMuseFluxPayload({model,prompt:'x',images,seed:0,grounding:false,safety_tolerance:0,steps:4,output_format:'png',extra:'stale'}).payload;
  assert.equal(built.safety_tolerance,0);assert.equal(Object.hasOwn(built,'n'),false);assert.equal(Object.hasOwn(built,'extra'),false);
  assert.equal(Object.hasOwn(built,'seed'),klein);assert.equal(Object.hasOwn(built,'grounding'),!klein);assert.equal(Object.hasOwn(built,'metadata'),klein);
 }
 assert.throws(()=>pure.buildPreviewMuseFluxPayload({model:c.flux.models[0],prompt:'x',images:['x']}));
 assert.throws(()=>pure.buildPreviewMuseFluxPayload({model:c.flux.models[1],prompt:'x',images:[]}));
 assert.throws(()=>pure.buildPreviewMuseFluxPayload({model:c.flux.models[0],prompt:'x',n:1}));
});
test('Muse supports ordered image composition and omits unsupported generation fields',()=>{
 for(const model of [c.muse.imageModel,c.muse.videoModel]){
  const result=pure.buildPreviewMuseFluxPayload({model,prompt:'x',images:['a','b','a'],size:'auto',seed:4,output_format:'png',negative_prompt:'no'});
  assert.deepEqual(result.sources,['a','b','a']);assert.equal(result.payload.seed,undefined);assert.equal(result.payload.output_format,undefined);
  if(model===c.muse.videoModel)assert.deepEqual(result.payload,{model,prompt:'x',n:1,size:'auto',duration:10,resolution:'720p',audio:true});
 }
 for(const change of [{images:Array(10).fill('x')},{videos:['x']},{audios:['x']},{duration:5},{resolution:'1080p'},{audio:false},{size:'2048x2048'},{size:'bad',aspect_ratio:'16:9'}]) assert.throws(()=>pure.buildPreviewMuseFluxPayload({model:c.muse.videoModel,prompt:'x',...change}));
});
test('validate all images and aggregate encoded PNG budget before any upload',async()=>{
 let uploads=0;const options={uploadCacheTtlMs:0,uploadIntervalMs:0,fetchImpl:async()=>{uploads++;return json({url:'https://provider.example/input.png'});}};
 await assert.rejects(provider.buildImagePayload({model:c.hy.model,prompt:'x',images:[await image(),'data:image/png;base64,eA==']},'test-key',options));assert.equal(uploads,0);
 const crypto=require('node:crypto');const png=await sharp(crypto.randomBytes(1500*1500*3),{raw:{width:1500,height:1500,channels:3}}).png().toBuffer();
 const reference=`data:image/png;base64,${png.toString('base64')}`;
 await assert.rejects(provider.buildImagePayload({model:c.muse.imageModel,prompt:'x',images:[reference,reference]},'test-key',options),/total at most 11 MiB/);assert.equal(uploads,0);
});
test('Muse uses compatibility submit and query paths, never replays ambiguous POST',async()=>{
 let posts=0;await assert.rejects(provider.submitMuseVideoTask({model:c.muse.videoModel,prompt:'x'},'test-key',{fetchImpl:async(url:string)=>{assert.ok(url.endsWith('/v1/video/generations'));posts++;throw new Error('read reset');}}));assert.equal(posts,1);
 const result=await provider.queryMuseVideoTask('fixture-task','test-key',{fetchImpl:async(url:string,init:any)=>{assert.ok(url.endsWith('/v1/video/generations/fixture-task'));assert.equal(init.method,'GET');return json({data:{status:'SUCCESS',data:{model:c.muse.videoModel,content:{video_url:'https://provider.example/output.mp4'}}}});}});
 assert.equal(result.status,'succeeded');assert.equal(result.videoUrl,'https://provider.example/output.mp4');
 const conflict=await provider.queryMuseVideoTask('fixture-task','test-key',{fetchImpl:async()=>json({data:{status:'SUCCESS',data:{status:'FAILURE',model:c.muse.videoModel,content:{video_url:'https://provider.example/output.mp4'}}}})});
 assert.equal(conflict.status,'failed','a nested failure cannot become a completed video');
});
test('recovery preserves exact model and the original protocol',()=>{
 for(const model of pure.imageModels){const r=inferRunRecoveryDescriptor({provider:'seedance-nz',model,taskId:'fixture-task'})!;assert.equal(r.kind,'seedream-nz');assert.equal(r.model,model);}
 const r=inferRunRecoveryDescriptor({provider:'seedance-nz',model:c.muse.videoModel,taskId:'fixture-task'})!;assert.equal(r.kind,'muse');
 const recover=require('../backend/src/services/runRecovery');assert.ok(recover);
});
test('settings retain explicit zero/false defaults without runtime identities',()=>{
 assert.equal(previewImageSettings({hySeed:0}).hySeed,0);assert.equal(fluxVariantSettings({fluxImageGrounding:false,fluxImageSteps:0}).fluxImageGrounding,false);
});
test('all eleven workflows import and preserve exact Run authority and budget-house credential preflight',()=>{
 const {CASES,workflow}=require('../scripts/generate-preview-muse-flux-workflows.cjs');
 const authority=require('../backend/src/collaboration/runIntentAuthority');
 assert.equal(CASES.length,11);
 for(const item of CASES){
  const draft=workflow(item),fragment=workflowManifestToFragment(draft),node=fragment.nodes.find((n:any)=>n.id==='generation')!;
  assert.deepEqual(authority.providerDeclarationForNode(node,fragment),{provider:'seedance-nz',model:item.model});
  const checks=(key:string)=>buildRunPreflightDiagnostics({nodes:[node],edges:[],executionNodeIds:[node.id],projectId:'isolated',settings:{zhenzhenApiKey:'wrong-channel-key',zhenzhenSd2ApiKey:key,advancedProviders:[]} as any,assets:[],providersComplete:true,policy:null});
  assert.ok(checks('').capability.some((n:any)=>n.ruleId==='provider.seedance-nz-credential-missing'));
  assert.ok(!checks('fixture-key').capability.some((n:any)=>n.ruleId.includes('credential-missing')));
  assert.doesNotMatch(JSON.stringify(draft),/sk-[A-Za-z0-9]{12}|task_id|result_url|X-Tos-Signature/i);
 }
});
test('history round-trips custom HY and Klein zero values and rejects incomplete records',()=>{
 for(const model of [c.hy.model,...c.flux.models,c.muse.imageModel]){
  const flux=c.flux.models.includes(model),hy=model===c.hy.model;
  const settings={model:flux?'flux-3-image':model,apiModel:model,imageBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',
   aspectRatio:hy?'custom':'auto',sizeLevel:hy?'1K':flux?'768sq':'',...(hy?previewImageSettings({hySeed:42}):flux?fluxVariantSettings({fluxImageSeed:0,fluxImageSteps:0,fluxImageSafetyTolerance:0,fluxImageGrounding:false}):{})};
  const input={schema:historyContract.imageSettingsContextSchema,origin:'frontend-common-context',basicSettings:settings,prompt:'robot',referenceImages:model.endsWith('-i2i')?['/files/input/a.png']:[]};
  const restored=readHistoryBudgetImageInput({historyResolvedInput:input});assert.deepEqual(restored.settings,settings);
  assert.throws(()=>readHistoryBudgetImageInput({historyResolvedInput:{...input,basicSettings:{...settings,apiModel:'changed-model'}}}));
 }
});
