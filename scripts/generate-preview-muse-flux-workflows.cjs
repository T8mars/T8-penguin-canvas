'use strict';
const fs=require('node:fs'),path=require('node:path');
const c=require('../backend/src/shared/previewMuseFluxContract.json');
const CASES=[{id:'hy-preview-text',model:c.hy.model},{id:'hy-preview-reference',model:c.hy.model,references:2},
 {id:'hy-preview-custom',model:c.hy.model,references:2,custom:true},
 ...[c.muse.imageModel,c.muse.videoModel].flatMap(model=>[{id:model+'-text',model},{id:model+'-reference',model,references:2}]),
 ...c.flux.models.map(model=>({id:model,model,references:model.endsWith('-i2i')?1:0}))];
function workflow(item){
 const video=item.model===c.muse.videoModel,flux=c.flux.models.includes(item.model),hy=item.model===c.hy.model;
 const nodes=[],edges=[];
 for(let i=0;i<(item.references||0);i++){
  nodes.push({id:'reference-'+i,type:'upload',position:{x:0,y:i*260},data:{label:`参考图 ${i+1} / Reference ${i+1}`,uploadType:'image',lockedUploadType:'image'}});
  edges.push({id:'reference-edge-'+i,source:'reference-'+i,target:'generation'});
 }
 nodes.push({id:'generation',type:video?'video':'image',position:{x:440,y:60},data:{label:item.model,providerSource:'zhenzhen',providerId:'',providerModel:'',
  ...(video?{model:item.model,mainId:item.model,videoBuiltinSource:'seedance-nz',ratio:'16:9',duration:10,resolution:'720p'}:
   {model:flux?'flux-3-image':item.model,apiModel:item.model,imageBuiltinSource:'seedance-nz',aspectRatio:item.custom?'custom':'auto',sizeLevel:hy?'1K':flux?'768sq':'',referenceImages:[],imageOnlyOutput:true,
    ...(hy?{hyWidth:1280,hyHeight:720,hySeed:0,hyNegativePrompt:''}:{}),
    ...(flux?{fluxImageGrounding:true,fluxImageSafetyTolerance:2,fluxImageSeed:42,fluxImageSteps:item.model.includes('-klein-')?4:0,fluxImageOutputFormat:'api_default'}:{})}),
  prompt:video?'Animate the reference scene gently with natural sound and a fixed camera.':'A friendly blue toy robot beside a yellow cup, cream studio background, clean illustration, no text.',reuseResult:false}});
 nodes.push({id:'output',type:'output',position:{x:900,y:60},data:{label:'结果 / Result'}});
 edges.push({id:'output-edge',source:'generation',...(video?{sourceHandle:'video'}:{}),target:'output'});
 return{schema:'t8-workflow-fragment',version:1,title:item.id,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],savedAt:'2026-11-01T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development worktree required');for(const item of CASES)fs.writeFileSync(path.join(root,'docs/workflows',item.id+'.json'),JSON.stringify(workflow(item),null,2)+'\n');}
module.exports={CASES,workflow};
