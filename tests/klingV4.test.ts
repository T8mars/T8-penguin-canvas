import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {captureKlingV4,executeKlingV4,klingV4Reference,readKlingV4Pending} from '../src/utils/klingV4.ts';
import {VIDEO_MODELS} from '../src/providers/models.ts';import {resolveNodeConnectionPorts,isConnectionValid} from '../src/config/portTypes.ts';
import {collectUpstreamMaterials} from '../src/components/nodes/useUpstreamMaterials.ts';
import {workflowManifestToFragment} from '../src/utils/workflowResource.ts';
import {historyVideoBasicSettings} from '../src/utils/historyVideoBasicSettings.ts';
const require=createRequire(import.meta.url);const {normalizeRunRecoveryDescriptor,recoveryRequest,normalizeRecoveryPayload}=require('../backend/src/services/runRecovery.js');
const {providerDeclarationForNode}=require('../backend/src/collaboration/runIntentAuthority.js');
const media={imageUrls:[],videoUrls:[],audioUrls:[]};const model='kling-v4-custom-element';const ref=JSON.stringify({schema:'t8-kling-v4-reference-v1',model,elementId:'own-element',referenceType:'video_refer'});
const node=(id:string,model:string,data:any={})=>({id,type:'video',position:{x:0,y:0},data:{model,mainId:'kling-v3.0',videoBuiltinSource:'seedance-nz',...data}});
test('five options stay in the existing Kling family; old default unchanged',()=>{const family=VIDEO_MODELS.find(v=>v.id==='kling-v3.0')!;assert.equal(family.apiModelOptions[0].value,'kling-v3.0-std-t2v');assert.equal(family.apiModelOptions.filter(v=>v.value.startsWith('kling-v4-')).length,5);});
test('capture merges typed IDs without treating linked IDs as raw media; inactive audio source is omitted',()=>{
 const request=captureKlingV4({klingV4ImageElementIds:'image-1'},'kling-v4-omni','hello',media,[ref]);assert.deepEqual(request.imageElementIds,['image-1']);assert.deepEqual(request.videoElementIds,['own-element']);assert.equal(klingV4Reference(ref).elementId,'own-element');
 const voice=captureKlingV4({klingV4VoiceSource:'audio',klingV4VoiceName:'name',klingV4VideoId:'stale'},'kling-v4-custom-voice','', {...media,audioUrls:['/files/a.wav']});assert.equal(voice.videoId,'');
 assert.throws(()=>readKlingV4Pending({taskId:'a',model,request:{model:'other'}}));
});
test('auxiliary ports route text/audio through the existing null Handle; legacy video remains video',()=>{
 const source=node('source',model,{outputText:ref,texts:[ref],prompt:'private description'}), target=node('target','kling-v4-omni');
 const ports=resolveNodeConnectionPorts(source as any);assert.ok(ports.resolved);if(ports.resolved)assert.deepEqual(ports.outputs[0].kinds,['text','metadata']);
 assert.equal(isConnectionValid(source as any,target as any),true);
 const materials=collectUpstreamMaterials([source],new Map([['source',new Set([null])]]),new Map(),[]);assert.deepEqual(materials.texts.map(v=>v.url),[ref]);assert.equal(materials.videos.length,0);
 const legacy=resolveNodeConnectionPorts(node('legacy','kling-v3.0-std-t2v') as any);if(legacy.resolved)assert.deepEqual(legacy.outputs[0].kinds,['video']);
});
test('recovery keeps exact model/referenceType and ID outputs; no auxiliary result is mislabeled video',()=>{
 const descriptor=normalizeRunRecoveryDescriptor({kind:'kling',taskId:'accepted',model,referenceType:'video_refer'});const request=recoveryRequest('http://127.0.0.1',descriptor);assert.equal(request.options.method,'GET');assert.equal(new URL(request.url).searchParams.get('referenceType'),'video_refer');
 const parsed=normalizeRecoveryPayload({data:{status:'succeeded',auxiliaryText:ref}},descriptor);assert.equal(parsed.state,'succeeded');assert.equal(parsed.outputs[0].kind,'text');assert.equal(normalizeRecoveryPayload({data:{status:'succeeded'}},descriptor).state,'pending');
 const pending={taskId:'accepted',model,request:{model}};assert.equal(providerDeclarationForNode(node('v','other',{klingV4Pending:pending})).model,model);
});
test('accepted task resumes GET only, commits reusable text without fake video',async t=>{
 const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});const calls:any[]=[],events:any[]=[];const pending={taskId:'accepted',model,request:{model,referenceType:'video_refer'}};
 globalThis.fetch=async(input,init)=>{calls.push({input,init});return new Response(JSON.stringify({success:true,data:{status:'succeeded',auxiliaryText:ref,elementId:'own-element'}}));};
 const reporter:any={signal:new AbortController().signal,providerSubmitted:async(v:any)=>events.push(v),polling:async()=>{},providerResponse:async()=>{},output:async(v:any)=>events.push(v)};
 await executeKlingV4({model:'kling-v4-t2v'},reporter,{pending:()=>assert.fail('must not submit'),stage:()=>{}},pending);
 assert.equal(calls.length,1);assert.notEqual(calls[0].init?.method,'POST');assert.equal(new URL(calls[0].input,'http://localhost').searchParams.get('model'),model);assert.equal(events[1].assets[0].kind,'text');
});
test('ambiguous acceptance and cancellation never issue a second POST',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let posts=0;globalThis.fetch=async()=>{posts++;throw Error('network reset');};
 await assert.rejects(executeKlingV4({model:'kling-v4-t2v',prompt:'hello'},{} as any,{pending:()=>{},stage:()=>{}}),(error:any)=>error.klingV4AcceptanceUnknown===true);assert.equal(posts,1);
});
test('all reusable workflows import with valid existing ports and no credentials/runtime identities',()=>{
 const {CASES,workflow}=require('../scripts/generate-kling-v4-workflows.cjs');
 for(const item of CASES){const w=workflow(item),fragment=workflowManifestToFragment(w);assert.equal(fragment.nodes.filter((n:any)=>n.type==='video').length,item[0]==='linked-omni'?3:1);for(const edge of fragment.edges)assert.equal(isConnectionValid(fragment.nodes.find((n:any)=>n.id===edge.source) as any,fragment.nodes.find((n:any)=>n.id===edge.target) as any,edge),true);assert.doesNotMatch(JSON.stringify(w),/(?:apiKey|taskId|klingV4Pending|https?:\/\/)/i);}
});
test('parameter history restores explicit v4 values without reference IDs or current media mutation',()=>{
 const settings={mainId:'kling-v3.0',model:'kling-v4-omni',videoBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',ratio:'16:9',duration:3,resolution:'720p',seed:-1,klingV4Duration:3,klingV4Watermark:'disabled'};
 assert.deepEqual(historyVideoBasicSettings({historyResolvedInput:{schema:'t8-video-frontend-context-v1',origin:'frontend-common-context',prompt:'robot',localRefImages:[],localRefVideos:[],localRefAudios:[],basicSettings:settings}}),settings);
});
