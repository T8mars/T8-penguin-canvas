'use strict';
const fs=require('node:fs'),path=require('node:path'),flash=require('../backend/src/shared/seedance25FlashContract.json'),h3=require('../backend/src/shared/h3TurboContract.json');
const CASES=[...flash.models.flatMap(model=>[{name:model,model,type:'video'},{name:model+'-sd25',model,type:'seedance25'}]),...['charswap','wuxi','wf','selflift'].map(key=>({name:h3[key].model,model:h3[key].model,type:'video'})),{name:h3.charswap.model+'-frames',model:h3.charswap.model,type:'video',frames:124}];
function workflow(item){
 const {model,type}=item,sd=model.startsWith('seedance-'),spec=Object.values(h3).find(s=>s.model===model),multi=model.endsWith('-multi'),i2v=model.endsWith('-i2v');
 const nodes=[],edges=[];const add=(id,type,data,x,y=30)=>nodes.push({id,type,data,position:{x,y}}),edge=source=>edges.push({id:source+'-generate',source,target:'generate'});
 const images=sd?i2v||multi?1:0:1,videos=sd?multi?1:0:spec.maxVideos?1:0,audios=sd?multi?1:0:spec.maxAudios?1:0;
 let y=30;for(const [kind,count]of [['image',images],['video',videos],['audio',audios]])for(let i=0;i<count;i++){const id=kind+(i+1);add(id,'upload',{uploadType:kind,lockedUploadType:kind,label:kind==='video'&&spec?.frames?'含音轨源视频 / MP4 with audio':kind+' '+(i+1)},0,y);y+=330;edge(id);}
 const data={model,providerSource:'zhenzhen',providerId:'',providerModel:'',reuseResult:false,prompt:sd?multi?'Use @Image 1 and the movement of @Video 1 to create a gentle scene.':'A green toy robot gently waves in a beige studio.':spec.frames?'Replace the subject with <Picture 1>, preserve source motion.':'The subject in <Picture 1> gently moves, static camera.',duration:sd?4:spec.minSeconds,resolution:'480p',ratio:sd?i2v?'adaptive':'16:9':spec.ratios[0]};
 if(type==='video')Object.assign(data,{mainId:sd?'seedance-2.5':h3.video.model,apiModel:model,videoBuiltinSource:'seedance-nz'});
 else Object.assign(data,{seedanceApiSource:'seedance-nz'});
 if(sd)Object.assign(data,{generateAudio:true,returnLastFrame:false,seed:-1,seedance25ReferenceTaskType:multi?'reference':'auto'});
 else Object.assign(data,{h3ComfySeed:-1,h3ComfyDurationMode:item.frames?'frames':'seconds',...(item.frames?{h3ComfyFrames:item.frames}:{})});
 add('generate',type,data,480);add('output','output',{},980);edges.push({id:'generate-output',source:'generate',target:'output'});
 return {schema:'t8-workflow-fragment',version:1,title:item.name,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],savedAt:'2026-11-17T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development directory required');for(const item of CASES)fs.writeFileSync(path.join(root,'docs/workflows',item.name+'.json'),JSON.stringify(workflow(item),null,2)+'\n');console.log(`Saved ${CASES.length} credential-free workflows`);}
module.exports={CASES,workflow};
