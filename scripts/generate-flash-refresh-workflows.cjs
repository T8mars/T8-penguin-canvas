'use strict';
const fs=require('node:fs'),path=require('node:path');
const {CASES}=require('./verify-flash-refresh-live.cjs');
function workflow(item){
 const image=item.kind==='image',nodes=[],edges=[];
 const data=image?{model:'gpt-image-2.6',apiModel:item.model,imageBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',g26Mode:item.gif?'gif':'image',g26Resolution:item.resolution||'1k',g26Size:item.gif?'auto':'1:1',g26Quality:'auto',g26Format:'png',g26Count:1,imageOnlyOutput:true,referenceImages:[],reuseResult:false,prompt:item.gif?'A small blue circle bouncing, seamless looping GIF.':'A penguin beside a yellow cup.'}
  :{mainId:item.id.startsWith('kling')?'kling-v3.0':'veo3.1',model:item.model,videoBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',duration:3,resolution:item.id.startsWith('kling')?'720p':'360p',ratio:'16:9',reuseResult:false,prompt:'The penguin gently waves beside a yellow cup.'};
 if(!image&&item.mode!=='text'){
  nodes.push({id:'reference',type:'upload',position:{x:0,y:0},data:{uploadType:item.mode,lockedUploadType:item.mode,label:'参考素材 / Reference'}});
  edges.push({id:'reference-input',source:'reference',target:'generation'});
 }
 nodes.push({id:'generation',type:image?'image':'video',position:{x:450,y:0},data});
 nodes.push({id:'output',type:'output',position:{x:900,y:0},data:{label:'结果 / Result'}});
 edges.push({id:'generated-result',source:'generation',target:'output'});
 return {schema:'t8-workflow-fragment',version:1,title:item.id,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],savedAt:'2026-11-08T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development worktree required');for(const item of CASES)fs.writeFileSync(path.join(root,'docs/workflows',`refresh-${item.id}.json`),JSON.stringify(workflow(item),null,2)+'\n');console.log(`Saved ${CASES.length} credential-free workflows`);}
module.exports={CASES,workflow};
