import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as helpers from '../src/utils/nov19Models';
import * as mai from '../src/utils/maiImage';
import {readHistoryBudgetImageInput} from '../src/utils/historyBudgetImageInput';
import {inferRunRecoveryDescriptor} from '../src/utils/runRecovery';
import history from '../backend/src/shared/generationHistoryInputContract.json';
import KlingImageControls from '../src/components/nodes/KlingImageControls';
import QwenAudio31Controls from '../src/components/nodes/QwenAudio31Controls';
import MaiImageControls from '../src/components/nodes/MaiImageControls';
import i18n from '../src/i18n';
import {querySeedanceNzAudio} from '../src/services/generation';
import {workflowManifestToFragment} from '../src/utils/workflowResource';
import {buildRunPreflightDiagnostics} from '../src/utils/runPreflightContext';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const plain=(x:any)=>JSON.parse(JSON.stringify(x));
function component(name:string,props:any){
 const file=new URL('../src/components/nodes/'+name+'.tsx',import.meta.url),exports:any={};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:(id:string)=>id==='react/jsx-runtime'?jsx:id==='react-i18next'?{useTranslation:()=>({t:(k:string)=>k})}:id.includes('nov19Models')?helpers:mai});
 return exports.default(props);
}
function elements(tree:any):any[]{return !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(elements):[tree,...elements(tree.props?.children)];}
test('actual new controls capture cleared React events and retain synchronous patch values on replay',()=>{
 for(const name of ['KlingImageControls','QwenAudio31Controls','MaiImageControls']){
  const patches:any[]=[],model=name==='MaiImageControls'?'mai-image-2-7':'qwen-audio-3.1-tts-flash';
  const tree=component(name,{model,data:{},referenceCount:0,update:(p:any)=>patches.push(p)});
  for(const item of elements(tree).filter(x=>typeof x.props?.onChange==='function')){
   const options=elements(item.props.children).filter(x=>x.type==='option'),value=options.at(-1)?.props.value??(item.props.type==='number'?'1':'calm');
   const event:any={currentTarget:{value,checked:true}};item.props.onChange(event);event.currentTarget=null;
   const patch=patches.at(-1),snapshot=plain(patch);assert.deepEqual(plain({...patch}),snapshot);assert.deepEqual(plain({keep:1,...patch}),{keep:1,...snapshot});
  }
  assert.ok(patches.length>=(name==='MaiImageControls'?4:5),name);
 }
 const patches:any[]=[];const tree=component('QwenAudio31Controls',{model:'qwen-audio-3.1-tts-flash',data:{format:'mp3',sample_rate:'22050',seed:0},referenceCount:0,update:(p:any)=>patches.push(p)});
 elements(tree).find(x=>x.type==='select'&&x.props['aria-label']==='nov19:format').props.onChange({currentTarget:{value:'opus'}});
 assert.equal(patches[0].qwenAudio31Params.sample_rate,'24000');assert.equal(patches[0].qwenAudio31Params.seed,0);
});
test('new image histories require explicit recorded settings, preserve duplicate references and ignore live state',()=>{
 for(const model of [helpers.NOV19.contract.kling.model,...helpers.NOV19.contract.mai.models]){
  const kling=model===helpers.NOV19.contract.kling.model;
  const settings:any={model:kling?model:'mai-image-2-6',apiModel:model,aspectRatio:'',sizeLevel:'',imageBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',...(kling?helpers.klingImageSettings({}):mai.maiImageSettings({},model))};
  const doc:any={taskId:'never-copy',historyResolvedInput:{schema:history.imageSettingsContextSchema,origin:'frontend-common-context',prompt:'a teapot',referenceImages:['a','b','a'],basicSettings:settings}};
  const result=readHistoryBudgetImageInput(doc);assert.deepEqual(result.media.map(x=>x.url),['a','b','a']);assert.deepEqual(result.settings,settings);assert.equal(Object.hasOwn(result.settings,'taskId'),false);
  for(const key of Object.keys(settings)){const broken=structuredClone(doc);delete broken.historyResolvedInput.basicSettings[key];assert.throws(()=>readHistoryBudgetImageInput(broken),key);}
 }
});
test('all new recovery recipes retain only original task identity and exact PCM channel/rate metadata',()=>{
 for(const model of [helpers.NOV19.contract.kling.model,...helpers.NOV19.contract.mai.models,...helpers.NOV19.contract.audio.models]){
  const audio=helpers.NOV19.isAudio(model),recipe=inferRunRecoveryDescriptor({provider:'seedance-nz',model,taskId:'original',outputFormat:'pcm',sampleRate:'48000',channels:'2',apiKey:'never-copy'});
  assert.equal(recipe?.kind,audio?'seed-audio':'seedream-nz');assert.equal(recipe?.taskId,'original');assert.equal(Object.hasOwn(recipe||{},'apiKey'),false);
  if(audio){assert.equal(recipe?.outputFormat,'pcm');assert.equal(recipe?.sampleRate,'48000');assert.equal(recipe?.channels,model.endsWith('-next')?'2':'1');}
 }
});
test('eleven workflow files import with exact authority, correct key preflight and no task/output credentials',()=>{
 const {CASES}=require('../scripts/generate-nov19-workflows.cjs'),authority=require('../backend/src/collaboration/runIntentAuthority');assert.equal(CASES.length,11);
 for(const item of CASES){const text=fs.readFileSync(new URL('../docs/workflows/'+item.name+'.json',import.meta.url),'utf8');assert.doesNotMatch(text,/sk-|apiKey|taskId|https?:|audioUrl|imageUrls|signed/i);const fragment=workflowManifestToFragment(JSON.parse(text))!;assert.ok(fragment);const node=fragment.nodes.find(n=>n.id==='generate')!;assert.deepEqual(authority.providerDeclarationForNode(node,fragment),{provider:'seedance-nz',model:item.model});const check=(key:string)=>buildRunPreflightDiagnostics({nodes:[node],edges:[],executionNodeIds:[node.id],projectId:'fixture',settings:{zhenzhenApiKey:'wrong',zhenzhenSd2ApiKey:key,advancedProviders:[]} as any,assets:[],providersComplete:true,policy:null});assert.ok(check('').capability.some(x=>x.ruleId==='provider.seedance-nz-credential-missing'));assert.ok(!check('fixture').capability.some(x=>x.ruleId.includes('credential-missing')));}
});
test('actual audio service sends model identity with PCM recipe even after backend memory is gone',async()=>{
 const previous=globalThis.fetch,calls:any[]=[];
 try{globalThis.fetch=(async(url:any,init:any)=>{calls.push({url,init});return Response.json({success:true,data:{status:'succeeded',audioUrls:['/api/resources/file/fixture']}});}) as typeof fetch;
  for(const model of helpers.NOV19.contract.audio.models){await querySeedanceNzAudio('original/task',{}, {model,outputFormat:'pcm',channels:model.endsWith('-next')?'2':'1'});const {url,init}=calls.at(-1),parsed=new URL(url,'http://fixture');assert.equal(parsed.searchParams.get('model'),model);assert.equal(parsed.searchParams.get('sampleRate'),model.endsWith('-next')?'48000':'22050');assert.equal(init.method,undefined);assert.ok(parsed.pathname.endsWith('/original%2Ftask'));}
 }finally{globalThis.fetch=previous;}
});
test('new panels render translated labels, exact mode-specific controls and theme tokens in both languages',async()=>{
 for(const locale of ['zh-CN','en-US']){
  await i18n.changeLanguage(locale);
  const htmls=[renderToStaticMarkup(React.createElement(KlingImageControls,{data:{},update(){}})),renderToStaticMarkup(React.createElement(MaiImageControls,{model:'mai-image-2-7',data:{},referenceCount:0,update(){}})),...helpers.NOV19.contract.audio.models.map((model:string)=>renderToStaticMarkup(React.createElement(QwenAudio31Controls,{model,data:{},referenceCount:0,update(){}})))];
  for(const html of htmls){assert.doesNotMatch(html,/nov19:|nodes:generation/);assert.match(html,/nodrag nowheel/);assert.match(html,/var\(--t8-text-main\)/);}
  assert.doesNotMatch(htmls[1],/Bing|value="auto"[^>]*>auto/);assert.doesNotMatch(htmls[3],/SSML|aria-label="(?:System voice|系统音色)"/);
 }
 await i18n.changeLanguage('zh-CN');
});
