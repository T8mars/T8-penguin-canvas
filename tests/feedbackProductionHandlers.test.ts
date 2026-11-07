import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {syncMaterialSetUpstream} from '../src/utils/materialSetUpstream.ts';
import {hasUpstreamFeedbackCycle} from '../src/utils/upstreamFeedback.ts';
import {importDirectorUpstreamScripts} from '../src/utils/directorStoryboardImport.ts';
import {sanitizeDirectorStoryboardShots} from '../src/utils/directorStoryboard.ts';

function handler(file:string,start:string,end:string,deps:Record<string,unknown>,name:string){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);
  const code=transformSync(source.slice(a,b)+`\nreturn ${name};`,{loader:'ts'}).code;
  return new Function(...Object.keys(deps),code)(...Object.values(deps));
}
const incoming={id:'a',sourceNodeId:'group',kind:'image' as const,url:'/current.png',origin:'upstream' as const};
test('actual rebuild handler requires confirmation, replaces exactly the current snapshot, and clears suppression',()=>{
  for(const answer of [false,true]){
    let confirmations=0;const writes:any[]=[],patches:any[]=[];
    const rebuild=handler('src/components/nodes/MaterialSetNode.tsx','  const rebuildFromUpstream =','  const splitMaterialSet =',{
      upstreamCandidate:{kind:'image',list:[incoming]},readOnly:false,id:'set',
      rf:{getEdges:()=>[{source:'group',target:'set'}],getNodes:()=>[]},hasUpstreamFeedbackCycle,
      items:[{id:'old',kind:'image',url:'/gone.png'}],window:{confirm:()=>{confirmations++;return answer;}},t:(key:string)=>key,
      commitItems:(kind:string,items:any[])=>writes.push({kind,items}),syncMaterialSetUpstream,update:(patch:any)=>patches.push(patch),setError:()=>{},
    },'rebuildFromUpstream');
    rebuild();assert.equal(confirmations,1);assert.equal(writes.length,answer?1:0);
    if(answer){assert.deepEqual(writes[0].items.map((item:any)=>item.url),['/current.png']);assert.deepEqual(patches,[{materialSetSyncUpstream:true,materialSetExcludedUpstream:[]}]);}
  }
});
test('actual rebuild rejects read-only canvases and group feedback loops before confirmation/mutation',()=>{
  for(const readOnly of [true,false]){
    let confirmations=0,writes=0,error='';
    const rebuild=handler('src/components/nodes/MaterialSetNode.tsx','  const rebuildFromUpstream =','  const splitMaterialSet =',{
      upstreamCandidate:{kind:'image',list:[incoming]},readOnly,id:'set',
      rf:{getEdges:()=>[{source:'group',target:'set'}],getNodes:()=>[{id:'group',type:'groupBox',data:{memberIds:['set']}}]},hasUpstreamFeedbackCycle,
      items:[{id:'old',kind:'image',url:'/gone.png'}],window:{confirm:()=>{confirmations++;return true;}},t:(key:string)=>key,
      commitItems:()=>writes++,syncMaterialSetUpstream,update:()=>writes++,setError:(value:string)=>{error=value;},
    },'rebuildFromUpstream');
    rebuild();assert.equal(confirmations,0);assert.equal(writes,0);if(!readOnly)assert.equal(error,'materialSet.cycle');
  }
});
test('actual director importer blocks busy/invalid inputs and imports valid drafts without submitting a task',()=>{
  for(const [busy,script,expected] of [[true,'正常脚本',0],[false,'镜头1 0-30秒\n动作',0],[false,'镜头1 0-5秒\n动作',1]] as const){
    const writes:any[]=[],notices:string[]=[];
    const run=handler('src/components/nodes/DirectorStoryboardNode.tsx','  const importUpstreamScripts =','  const assignShotImages =',{
      isBusy:busy,upstream:{texts:[{id:'script',sourceNodeId:'source',kind:'text',url:script}],images:[]},
      shots:sanitizeDirectorStoryboardShots([]),importDirectorUpstreamScripts,
      writeShots:(shots:any[])=>writes.push(shots),setActiveShotId:()=>{},setScriptImportNotice:(value:string)=>notices.push(value),t:(key:string)=>key,MIN_DURATION:4,MAX_DURATION:15,
    },'importUpstreamScripts');
    run();assert.equal(writes.length,expected);if(!busy&&expected===0)assert.ok(notices.includes('directorImport.invalidDuration'));
    if(expected)assert.equal(writes[0][0].taskId,null);
  }
});
