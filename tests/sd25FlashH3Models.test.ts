import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {H3_TURBO,buildH3VideoRequest} from '../src/utils/h3Turbo';
import {SD25_FLASH} from '../src/utils/seedance25Flash';
import {SEEDANCE25_MODEL_OPTIONS} from '../src/config/seedance';
import {VIDEO_MODELS,videoModelOptionsForSource} from '../src/providers/models';
import Controls from '../src/components/nodes/H3ComfyControls';
import ReferenceControls from '../src/components/nodes/Seedance25ReferenceControls';
import i18n from '../src/i18n';
import {inferRunRecoveryDescriptor} from '../src/utils/runRecovery';
import {isConnectionValid} from '../src/config/portTypes';
import {workflowManifestToFragment} from '../src/utils/workflowResource';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('six Flash models are available only on budget house in both entries, standard defaults remain',()=>{
 const tab=VIDEO_MODELS.find(m=>m.id==='seedance-2.5')!;
 assert.equal(SEEDANCE25_MODEL_OPTIONS[0].value,'seedance-2.5-global-standard-i2v');
 for(const model of SD25_FLASH.contract.models){assert.ok(SEEDANCE25_MODEL_OPTIONS.some(m=>m.value===model));const option=videoModelOptionsForSource(tab,'seedance-nz').find(o=>o.value===model)!;assert.ok(option);assert.deepEqual(option.resolutions,['480p','720p']);if(model.endsWith('-i2v'))assert.deepEqual(option.ratios,['adaptive']);if(model.endsWith('-multi'))assert.deepEqual([option.maxRefImages,option.maxRefVideos,option.maxRefAudios],[10,5,5]);assert.equal(inferRunRecoveryDescriptor({provider:'seedance-nz',model,taskId:'fixture'})!.kind,'seedance');}
});
test('production H3 request helper does not leak generic seeds or seconds into frames mode',()=>{
 const c=H3_TURBO.contract;
 const input=buildH3VideoRequest(c.charswap.model,'test',['x'],[],['v'],{h3ComfyDurationMode:'frames',h3ComfyFrames:124,h3ComfySeed:0,seed:42},5,'480p','auto');
 assert.equal(input.seconds,undefined);assert.equal(input.frames,124);assert.equal(input.seed,0);
 for(const spec of [c.wf,c.selflift])assert.equal(buildH3VideoRequest(spec.model,'test',['x'],[],[],{seed:42,h3ComfySeed:99},3,'480p','16:9').seed,undefined);
});
test('native controls in both languages expose only valid model-dependent options',async()=>{
 for(const lang of ['zh-CN','en-US']){await i18n.changeLanguage(lang);for(const spec of Object.values(H3_TURBO.contract) as any[]){if(!spec.video)continue;const html=renderToStaticMarkup(React.createElement(Controls,{model:spec.model,data:{h3ComfyDurationMode:'frames'},update(){}}));assert.doesNotMatch(html,/h3Turbo:/);assert.equal(html.includes('type="number"'),Boolean(spec.nativeSeed));assert.equal(html.includes('value="124"'),Boolean(spec.frames));}
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(ReferenceControls,{data:{},update(){}})),/h3Turbo:/);
 }await i18n.changeLanguage('zh-CN');
});
test('17 workflows import with valid ordered media edges and no task identities',()=>{
 const {CASES,workflow}=require('../scripts/generate-sd25-flash-h3-workflows.cjs');assert.equal(CASES.length,17);
 for(const item of CASES){const fragment=workflowManifestToFragment(workflow(item),{includeApiKeys:false})!;assert.ok(fragment);const nodes:any[]=fragment.nodes.map(node=>({...node,data:{...node.data,...(node.type==='upload'?{[node.data.uploadType==='image'?'imageUrl':node.data.uploadType==='audio'?'audioUrl':'videoUrl']:'/files/input/ref.'+({image:'png',audio:'wav',video:'mp4'}[String(node.data.uploadType)]||'bin')}:{})}}));for(const edge of fragment.edges)assert.ok(isConnectionValid(nodes.find(n=>n.id===edge.source),nodes.find(n=>n.id===edge.target),edge),item.name);}
});
