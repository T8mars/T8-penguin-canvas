import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import vm from 'node:vm';
import { H3_TURBO,buildH3ImageRequest } from '../src/utils/h3Turbo';
import Controls from '../src/components/nodes/H3TurboImageControls';
import {IMAGE_MODELS,VIDEO_MODELS,videoModelsForSource,inferVideoBuiltinSource} from '../src/providers/models';
import {inferRunRecoveryDescriptor} from '../src/utils/runRecovery';
import {workflowManifestToFragment} from '../src/utils/workflowResource';
import {isConnectionValid} from '../src/config/portTypes';
import i18n from '../src/i18n';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext';
const require=createRequire(import.meta.url),c=H3_TURBO.contract;
test('new categories are exact and old registry defaults and channel identities stay unchanged',()=>{
 assert.equal(IMAGE_MODELS[0].id,'gpt-image-2');assert.equal(VIDEO_MODELS[0].id,'grok-video-3');
 for(const spec of [c.minimax,c.qwen]){const definition=IMAGE_MODELS.find(row=>row.id===spec.model)!;assert.equal(definition.tabLabel,spec.tab);assert.equal(definition.maxReferenceImages,spec.maxImages);assert.deepEqual(definition.apiModelOptions.map(row=>row.value),[spec.model]);}
 assert.ok(videoModelsForSource('seedance-nz').some(row=>row.id===c.video.model));assert.ok(!videoModelsForSource('zhenzhen').some(row=>row.id===c.video.model));assert.equal(inferVideoBuiltinSource(c.video.model),'seedance-nz');
 const request=buildH3ImageRequest(c.qwen.model,'test',['x'],{sizeLevel:'720p',h3TurboSeed:0,h3TurboFormat:'webp',g26Count:10});
 assert.equal(request.seed,0);assert.equal(request.output_format,undefined);assert.equal(request.n,undefined);
});
test('actual control event handlers survive cleared events and consecutive replay',()=>{
 const source=ts.createSourceFile('controls',fs.readFileSync(new URL('../src/components/nodes/H3TurboImageControls.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),handlers:ts.Expression[]=[];
 const visit=(node:ts.Node)=>{if(ts.isJsxAttribute(node)&&node.name.getText(source)==='onChange'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression)handlers.push(node.initializer.expression);ts.forEachChild(node,visit);};visit(source);assert.equal(handlers.length,4);
 for(const expression of handlers){const updates:any[]=[];const handler=vm.runInNewContext(ts.transpileModule('('+expression.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{update:(patch:any)=>updates.push(JSON.parse(JSON.stringify(patch)))});for(const value of ['0','1']){const event:any={currentTarget:{value}};handler(event);event.currentTarget=null;}assert.equal(updates.length,2);assert.notDeepEqual(updates[0],updates[1]);}
});
test('actual production category filter shows H3/Turbo only for the budget house',()=>{
 const source=ts.createSourceFile('ImageNode',fs.readFileSync(new URL('../src/components/nodes/ImageNode.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(source)==='select'&&node.openingElement.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(source)==='data-image-model-family'))expression=node.children.find(child=>ts.isJsxExpression(child))&&((node.children.find(child=>ts.isJsxExpression(child)))as ts.JsxExpression).expression;ts.forEachChild(node,visit);};visit(source);assert.ok(expression);
 const models=require('../src/providers/models.ts'),g26=require('../src/utils/g26Krea.ts'),preview=require('../src/utils/previewMuseFlux.ts');
 for(const selected of [false,true]){const options=vm.runInNewContext(ts.transpileModule(expression!.getText(source),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText,{...models,...g26,...preview,React,isZhenzhenBudgetPlatformSelected:selected});const ids=options.map((option:any)=>option.props.value);for(const spec of [c.minimax,c.qwen])assert.equal(ids.includes(spec.model),selected);assert.ok(ids.includes('gpt-image-2'));}
});
test('native controls resolve both languages and Qwen format is absent',async()=>{
 for(const lang of ['zh-CN','en-US']){await i18n.changeLanguage(lang);for(const spec of [c.minimax,c.qwen]){const html=renderToStaticMarkup(React.createElement(Controls,{model:spec.model,data:{},referenceCount:0,update(){}}));assert.doesNotMatch(html,/h3Turbo:/);if(spec===c.qwen){assert.match(html,/<option value="720p" disabled="">/);assert.doesNotMatch(html,/value="webp"/);}}}await i18n.changeLanguage('zh-CN');
});
test('six credential-free saved workflows import with valid image/audio/video connections',()=>{
 const {CASES,workflow}=require('../scripts/generate-h3-turbo-workflows.cjs');assert.equal(CASES.length,6);
 for(const [name]of CASES){const stored=JSON.parse(fs.readFileSync(new URL('../docs/workflows/'+name+'.json',import.meta.url),'utf8'));assert.deepEqual(stored,workflow(name));assert.doesNotMatch(JSON.stringify(stored),/sk-|apiKey|task_[A-Za-z0-9]+|https?:\/\//);const fragment=workflowManifestToFragment(stored,{includeApiKeys:false})!;assert.ok(fragment);const nodes:any[]=fragment.nodes.map(node=>({...node,data:{...node.data,...(node.type==='upload'?node.data.uploadType==='audio'?{audioUrl:'/files/input/ref.wav'}:{imageUrl:'/files/input/ref.png'}:{})}}));for(const edge of fragment.edges)assert.ok(isConnectionValid(nodes.find(node=>node.id===edge.source),nodes.find(node=>node.id===edge.target),edge),name);}
});
test('original tasks use separate image/video recovery recipes with media timeout floors',()=>{
 for(const spec of Object.values(c) as any[]){const recovery=inferRunRecoveryDescriptor({provider:'seedance-nz',model:spec.model,taskId:'fixture'})!;assert.equal(recovery?.kind,spec===c.video?'h3-lowprice':'seedream-nz');assert.equal(recovery.taskId,'fixture');assert.ok(recovery.pollIntervalMs!*recovery.maxPolls!>=900000);}
});
test('preflight checks the budget-house credential for all three exact models',()=>{
 for(const spec of Object.values(c) as any[]){
  const video=spec===c.video,node:any={id:'fixture',type:video?'video':'image',position:{x:0,y:0},data:{model:spec.model,apiModel:spec.model,mainId:spec.model,providerSource:'zhenzhen',...(video?{videoBuiltinSource:'seedance-nz'}:{imageBuiltinSource:'seedance-nz'})}};
  const check=(key:string)=>buildRunPreflightDiagnostics({nodes:[node],edges:[],executionNodeIds:[node.id],scopeMode:'exact-plan',projectId:'fixture',settings:{zhenzhenApiKey:'workshop-only',zhenzhenSd2ApiKey:key,advancedProviders:[]} as any,providersComplete:true,assets:[],policy:null});
  assert.ok(check('').capability.some(item=>item.ruleId==='provider.seedance-nz-credential-missing'));
  assert.equal(check('fixture-budget-key').capability.filter(item=>item.ruleId.includes('credential-missing')).length,0);
 }
});
