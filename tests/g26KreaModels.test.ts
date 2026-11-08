import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import {NEW_IMAGE_CONTRACT as c,NEW_IMAGE_MODELS,newImageSettings,buildNewImageRequest} from '../src/utils/g26Krea';
import G26KreaControls from '../src/components/nodes/G26KreaControls';
import New3dControls from '../src/components/nodes/New3dControls';
import {IMAGE_MODELS,isZhenzhenBudgetImageModel} from '../src/providers/models';
import {readHistoryBudgetImageInput} from '../src/utils/historyBudgetImageInput';
import {inferRunRecoveryDescriptor} from '../src/utils/runRecovery';
import {previewImageUrl,downloadOriginalImage} from '../src/utils/mediaPreview';
import {workflowManifestToFragment} from '../src/utils/workflowResource';
import {buildNew3dRequest} from '../src/utils/new3dModels';
import {collectRunOutputAssets} from '../src/utils/runProviderTrace';
import {minimumProviderMediaPollCount} from '../src/utils/providerTimeoutPolicy';
import i18n from '../src/i18n';
import historyContract from '../backend/src/shared/generationHistoryInputContract.json';
const require=createRequire(import.meta.url),provider=require('../backend/src/providers/seedanceNz'),pure=require('../backend/src/providers/g26Krea3d'),recovery=require('../backend/src/services/runRecovery'),sharp=require('sharp');
test('New image tabs and all available models retain budget-house identity and GET recovery',()=>{
 assert.equal(IMAGE_MODELS[0].id,'gpt-image-2');
 for(const family of [c.g26,c.krea,c.zimage])assert.equal(IMAGE_MODELS.find(m=>m.id===family.tab)?.tabLabel,family.tab);
 for(const model of NEW_IMAGE_MODELS){assert.ok(isZhenzhenBudgetImageModel(model));assert.ok(provider.IMAGE_MODELS.has(model));const d=inferRunRecoveryDescriptor({provider:'seedance-nz',model,taskId:'fixture-task'})!;assert.equal(d.kind,'seedream-nz');assert.equal(recovery.recoveryRequest('http://local',d).options.method,'GET');}
 for(const model of [...c.hitem.models,...c.meshy.models]){const d=inferRunRecoveryDescriptor({provider:'seedance-nz-3d',model,taskId:'fixture-task'})!;assert.equal(d.kind,'model3d');const req=recovery.recoveryRequest('http://local',d);assert.equal(req.options.method,'GET');assert.match(req.url,/\/3d\/seedance-nz\/status\/fixture-task$/);assert.ok(d.maxPolls!>=1350);}
 const catalog=require('../backend/src/shared/creativeModelCatalog.json');for(const model of ['krea-v3-t2i',c.zimage.model]){const entry=catalog.image.find((m:any)=>m.model===model);assert.deepEqual(entry.parameters.capabilities,['t2i']);assert.equal(entry.parameters.supportsReference,false);assert.equal(entry.parameters.maxReferenceImages,0);}
});
test('Frontend models agree with production payload builder; history restores exact mode and options',()=>{
 for(const model of NEW_IMAGE_MODELS){
  const family=c.g26.models.includes(model)?c.g26.tab:c.krea.models.includes(model)?c.krea.tab:c.zimage.tab,images=model.endsWith('-i2i')?['/files/input/view.png']:[];
  const values=newImageSettings(model,{g26Mode:model===c.g26.models[0]?'gif':'svg',kreaVariant:'jam',kreaSeed:0,zImageSeed:Number.MAX_SAFE_INTEGER});
  const settings={model:family,apiModel:model,imageBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',aspectRatio:'',sizeLevel:'',...values};
  const request=buildNewImageRequest(model,'Blue robot',images,settings),built=pure.buildImage(request);assert.equal(built.model,model);assert.deepEqual(built.sources,images);
  const input={schema:historyContract.imageSettingsContextSchema,origin:'frontend-common-context',basicSettings:settings,prompt:'Blue robot',referenceImages:images};
  assert.deepEqual(readHistoryBudgetImageInput({historyResolvedInput:input}).settings,settings);
  const missing={...settings};delete (missing as any)[Object.keys(values)[0]];assert.throws(()=>readHistoryBudgetImageInput({historyResolvedInput:{...input,basicSettings:missing}}));
 }
});
test('LowPrice sixteen-reference static limit and text-only GIF agree across UI, requests, uploads and Agent catalog',async()=>{
 const model=c.g26.models[0],refs=Array.from({length:16},(_,i)=>'view-'+i);
 for(const g26Mode of ['image']){
  const request=buildNewImageRequest(model,'Ten tokens',refs,{g26Mode}),built=pure.buildImage(request);assert.deepEqual(request.images,refs);assert.deepEqual(built.sources,refs);
  assert.throws(()=>buildNewImageRequest(model,'Ten tokens',[...refs,'eleventh'],{g26Mode}),/g26References/);
 }
 assert.throws(()=>buildNewImageRequest(model,'Animation',refs,{g26Mode:'gif'}),/g26References/);
 const source=ts.createSourceFile('ImageNode',fs.readFileSync(new URL('../src/components/nodes/ImageNode.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.Expression|undefined;
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='maxRefs')expression=n.initializer;ts.forEachChild(n,visit);};visit(source);assert.ok(expression);
 const evaluate=(apiModel:string,g26Mode:string)=>vm.runInNewContext(ts.transpileModule('('+expression.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{isExternalSelected:false,isNewImageTab:true,apiModel,NEW_IMAGE_CONTRACT:c,newImageSettings,d:{g26Mode}});
 assert.equal(evaluate(model,'image'),16);assert.equal(evaluate(model,'gif'),0);assert.equal(evaluate(c.g26.models[1],'image'),16);assert.equal(evaluate(c.g26.models[1],'gif'),0);
 const option=IMAGE_MODELS.find(m=>m.id===c.g26.tab)!.apiModelOptions!.find(m=>m.value===model)!;assert.equal(option.maxReferenceImages,16);
 const entry=require('../backend/src/shared/creativeModelCatalog.json').image.find((m:any)=>m.model===model);assert.equal(entry.parameters.maxReferenceImages,16);
 const refsData=await Promise.all(Array.from({length:16},(_,i)=>sharp({create:{width:16,height:16,channels:3,background:{r:i*15,g:100,b:200}}}).png().toBuffer().then((b:Buffer)=>'data:image/png;base64,'+b.toString('base64'))));let uploads=0;
 const options={uploadIntervalMs:0,uploadCacheTtlMs:0,fetchImpl:async()=>new Response(JSON.stringify({url:'https://provider.example/ten-'+(++uploads)+'.png'}),{headers:{'content-type':'application/json'}})};
 await assert.rejects(provider.buildImagePayload({model,prompt:'tokens',images:[...refsData,refsData[0]]},'fixture-key',options),/reference/);assert.equal(uploads,0);
 const built=await provider.buildImagePayload({model,prompt:'tokens',images:refsData},'fixture-key',options);assert.equal(uploads,16);assert.deepEqual(built.payload.images,Array.from({length:16},(_,i)=>'https://provider.example/ten-'+(i+1)+'.png'));
 for(const locale of ['zh-CN','en-US']){await i18n.changeLanguage(locale);const ui=renderToStaticMarkup(React.createElement(G26KreaControls,{model,data:{},update(){}}));assert.match(ui,/16/);assert.doesNotMatch(ui,/最多两张|up to two/);}await i18n.changeLanguage('zh-CN');
});
test('All reference images validate before first upload, and duplicate slots remain ordered',async()=>{
 const image=async(color:string)=>'data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:3,background:color}}).png().toBuffer()).toString('base64'),a=await image('red'),b=await image('blue');let uploads=0;
 const options={uploadIntervalMs:0,uploadCacheTtlMs:0,fetchImpl:async()=>new Response(JSON.stringify({url:'https://provider.example/ref-'+(++uploads)+'.png'}),{headers:{'content-type':'application/json'}})};
 await assert.rejects(provider.buildImagePayload({model:c.g26.models[0],prompt:'x',images:[a,'data:image/png;base64,invalid']},'test-fixture-key',options));assert.equal(uploads,0);
 const built=await provider.buildImagePayload({model:c.g26.models[0],prompt:'x',images:[a,b]},'test-fixture-key',options);assert.equal(built.payload.images.length,2);assert.deepEqual(built.payload.images,['https://provider.example/ref-1.png','https://provider.example/ref-2.png']);
});
test('Production control handlers capture consecutive events before React clears them',()=>{
 for(const file of ['G26KreaControls','New3dControls']){
  const source=ts.createSourceFile(file,fs.readFileSync(new URL('../src/components/nodes/'+file+'.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),handlers:ts.Expression[]=[];
  const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&n.name.getText(source)==='onChange'&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression)handlers.push(n.initializer.expression);ts.forEachChild(n,visit);};visit(source);assert.ok(handlers.length>=2);
  for(const expression of handlers){const patches:any[]=[],handler=vm.runInNewContext(ts.transpileModule('('+expression.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{key:'field',min:0,update:(p:any)=>patches.push(JSON.parse(JSON.stringify(p)))});
   for(const value of ['gif','svg']){const event:any={currentTarget:{value,valueAsNumber:value==='gif'?2:3}};handler(event);event.currentTarget=null;}
   assert.equal(patches.length,2);assert.notDeepEqual(patches[0],patches[1]);
  }
 }
});
test('GIF bypasses one-frame thumbnails; SVG uses isolated preview; bilingual controls match selected modes',async()=>{
 assert.equal(previewImageUrl('/files/output/test.gif'),'/files/output/test.gif');assert.equal(previewImageUrl('/files/output/img_task_a_b.svg'),'/api/files/vector/img_task_a_b.svg');
 for(const locale of ['zh-CN','en-US']){await i18n.changeLanguage(locale);
  const gif=renderToStaticMarkup(React.createElement(G26KreaControls,{model:c.g26.models[1],data:{g26Mode:'gif'},update(){}}));assert.match(gif,/frame_count|帧数|Frame count/);assert.doesNotMatch(gif,/g26Krea3d:/);assert.match(gif,/var\(--t8-bg-panel\)/);
  const svg=renderToStaticMarkup(React.createElement(G26KreaControls,{model:c.g26.models[1],data:{g26Mode:'svg'},update(){}}));assert.doesNotMatch(svg,/aria-label="(?:帧数|Frame count)"/);assert.match(svg,/gpt-5.4-mini/);
  const portrait=renderToStaticMarkup(React.createElement(New3dControls,{model:c.hitem.models[2],data:{},update(){}}));assert.match(portrait,/1536pro/);assert.doesNotMatch(portrait,/>1536<|g26Krea3d:/);
 }
 await i18n.changeLanguage('zh-CN');
});
test('3D recovery preserves model output kind and holds incomplete downloads pending',()=>{
 const descriptor={kind:'model3d',taskId:'fixture',model:c.hitem.models[0]};
 const done=recovery.normalizeRecoveryPayload({success:true,data:{status:'completed',modelUrls:['/files/output/model.glb']}},descriptor);assert.equal(done.state,'succeeded');assert.equal(done.outputs[0].kind,'model3d');
 assert.equal(recovery.normalizeRecoveryPayload({data:{status:'completed',modelUrls:[],recoverable:true}},descriptor).state,'pending');
});
test('Actual Generate handlers stop selection bubbling before starting the shared Run',()=>{
 for(const file of ['ImageNode','Model3DNode']){
  const source=ts.createSourceFile(file,fs.readFileSync(new URL('../src/components/nodes/'+file+'.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),handlers:ts.Expression[]=[];
  const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&n.name.getText(source)==='onClick'&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression?.getText(source).includes('requestCanvasNodeRun(id)'))handlers.push(n.initializer.expression);ts.forEachChild(n,visit);};visit(source);assert.equal(handlers.length,1);
  const order:string[]=[],handler=vm.runInNewContext(ts.transpileModule('('+handlers[0].getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{id:'unselected',requestCanvasNodeRun:(id:string)=>{assert.equal(id,'unselected');order.push('request');return true;}});
  handler({stopPropagation(){order.push('stop');}});assert.deepEqual(order,['stop','request']);
 }
});
test('Restored Meshy text request, controls, catalog and original-task recovery agree',async()=>{
 const model=c.meshy.textModel,data={prompt:'  A robot  ',meshyArtStyle:'sculpture',meshyPromptExpansion:'false',meshy_should_texture:'true',meshy_enable_pbr:'false'};
 const input=buildNew3dRequest(model,[],data);assert.deepEqual(input,{model,prompt:'A robot',art_style:'sculpture',enable_prompt_expansion:false,enable_pbr:false});
 let calls=0;const built=await provider.buildHunyuan3dPayload(input,'fixture-key',{fetchImpl:async()=>{calls++;throw Error('Unexpected network');}});assert.equal(calls,0);assert.deepEqual(built.payload,input);assert.equal(built.taskType,'t3d');
 assert.throws(()=>buildNew3dRequest(model,['image'],data));assert.throws(()=>buildNew3dRequest(model,[],{prompt:'x'.repeat(601)}));
 const image=buildNew3dRequest(c.meshy.models[0],['image'],data);assert.equal(image.prompt,undefined);assert.equal(image.art_style,undefined);assert.equal(image.enable_prompt_expansion,undefined);assert.equal(image.should_texture,true);
 const runtime=require('../tools/zcanvas-cli/scripts/generateCreativeRuntimeCatalog.cjs').buildRuntimeCatalog();const row=runtime.actions.find((v:any)=>v.model===model||v.action===model);assert.ok(row);assert.equal(row.parameters.minimumReferenceImages,0);assert.equal(row.parameters.orderedImageViews,0);assert.equal(row.parameters.optionalControls.includes('should_texture'),false);
 for(const locale of ['zh-CN','en-US']){await i18n.changeLanguage(locale);const text=renderToStaticMarkup(React.createElement(New3dControls,{model,data,update(){}}));assert.match(text,/A robot/);assert.doesNotMatch(text,/temporarily withdrawn|临时下架|g26Krea3d:/);assert.doesNotMatch(text,/aria-label="(?:生成纹理|Generate textures)"/);const imageUi=renderToStaticMarkup(React.createElement(New3dControls,{model:c.meshy.models[0],data,update(){}}));assert.doesNotMatch(imageUi,/<textarea/);}
 await i18n.changeLanguage('zh-CN');
});
test('Seventeen saved workflows import with exact model identities and no runtime credentials',()=>{
 const {CASES,workflow}=require('../scripts/generate-g26-krea-3d-workflows.cjs'),authority=require('../backend/src/collaboration/runIntentAuthority');assert.equal(CASES.length,17);
 for(const item of CASES){const draft=workflow(item),fragment=workflowManifestToFragment(draft),node=fragment.nodes.find((n:any)=>n.id==='generation')!;assert.equal(authority.providerDeclarationForNode(node,fragment).model,item.model);assert.doesNotMatch(JSON.stringify(draft),/sk-[a-z0-9]|taskId|apiKey|imageUrl|modelUrl/i);assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../docs/workflows/'+item.id+'.json',import.meta.url),'utf8')),draft);}
});
test('Original-file export uses unchanged GIF/SVG bytes and the real file extension',async()=>{
 const descriptors=new Map(['fetch','document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 try{
  for(const ext of ['gif','svg']){
   const bytes=Buffer.from(ext==='gif'?'GIF89a-original-animation':'<svg>original-vector</svg>'),url='/files/output/img_task_abc_def.'+ext,events:string[]=[];let received:Blob|undefined;
   globalThis.fetch=(async input=>{assert.equal(input,ext==='svg'?'/api/files/vector/img_task_abc_def.svg':url);return new Response(bytes);}) as typeof fetch;
   const anchor={href:'',download:'',click(){assert.equal(this.href,'blob:original');assert.equal(this.download,'img_task_abc_def.'+ext);events.push('click');},remove(){events.push('remove');}};
   Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(tag:string){assert.equal(tag,'a');return anchor;},body:{appendChild(value:unknown){assert.equal(value,anchor);events.push('append');}}}});
   Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout(fn:()=>void){fn();}}});
   URL.createObjectURL=blob=>{received=blob as Blob;return 'blob:original';};URL.revokeObjectURL=url=>{assert.equal(url,'blob:original');events.push('revoke');};
   await downloadOriginalImage(url);assert.deepEqual(Buffer.from(await received!.arrayBuffer()),bytes);assert.deepEqual(events,['append','click','remove','revoke']);
  }
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const [key,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
});
test('Production 3D callback sends all six model outputs through the asset transaction',async()=>{
 const source=ts.createSourceFile('Model3DNode',fs.readFileSync(new URL('../src/components/nodes/Model3DNode.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.Expression|undefined;
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='run')expression=n.initializer;ts.forEachChild(n,visit);};visit(source);assert.ok(expression);
 for(const model of [...c.hitem.models,...c.meshy.models]){
  let submissions=0,queries=0;const outputs:any[]=[],images=model===c.meshy.textModel?[]:model.includes('multi')?['front','back']:['front'];
  const run=vm.runInNewContext(ts.transpileModule('('+expression.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{isNewModel:true,model,images,d:{prompt:'A robot'},prompt:'A robot',setLocalError(){},update(){},t:(key:string)=>key,buildNew3dRequest,minimumProviderMediaPollCount,collectRunOutputAssets,submitHunyuan3D:async(request:any)=>{submissions++;assert.equal(request.model,model);return {taskId:'fixture'};},queryHunyuan3D:async()=>{queries++;return {status:'completed',modelUrls:['/files/output/fixture.glb']};}});
  await run({providerRequest:async()=>{},providerSubmitted:async()=>{},providerPolling:async()=>{},providerResponse:async()=>{},output:async(value:any)=>outputs.push(value)});
  assert.equal(submissions,1);assert.equal(queries,1);assert.equal(outputs.length,1);assert.equal(outputs[0].outputCount,1);assert.equal(outputs[0].assets[0].kind,'model3d');assert.equal(outputs[0].assets[0].sourceUrl,'/files/output/fixture.glb');
 }
});
