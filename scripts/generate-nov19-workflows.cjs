'use strict';
const fs = require('node:fs'), path = require('node:path');
const c = require('../backend/src/shared/nov19ModelsContract.json');
const CASES = [
  {name:'kling-v4-image-text',model:c.kling.model},
  {name:'kling-v4-image-reference',model:c.kling.model,references:1},
  {name:'kling-v4-image-group',model:c.kling.model,group:true},
  ...c.mai.models.flatMap(model=>[0,1].map(references=>({name:model+(references?'-reference':'-text'),model,references}))),
  ...c.audio.models.map(model=>({name:model,model,audio:true})),
  {name:'qwen-audio-3.1-tts-next-reference',model:c.audio.models[1],audio:true,references:1},
];
function workflow(item) {
  const nodes=[],edges=[],kind=item.audio?'audio':'image';
  for(let i=0;i<(item.references||0);i++) {
    const id='reference'+i;nodes.push({id,type:'upload',position:{x:0,y:30+i*340},data:{uploadType:kind,lockedUploadType:kind,label:kind+' '+(i+1)}});
    edges.push({id:id+'-generate',source:id,target:'generate'});
  }
  const data={providerSource:'zhenzhen',reuseResult:false,prompt:item.audio?(item.references?'@voice1 你好，这是一段参考声音示例。':'你好，欢迎来到创作画布。'):item.references?'Use @Image1 as the subject. Place it in a clean pastel studio, preserve its identity.':item.group?'Create two related storyboard images of a green toy robot waving in a pastel studio.':'A green toy robot in a pastel studio, detailed illustration, no text.'};
  if(item.audio)Object.assign(data,{audioProviderMode:'qwen3-tts',qwenTtsModel:item.model,qwenAudio31Params:{seed:0,format:item.references?'pcm':'wav',sample_rate:item.model.endsWith('-next')?'48000':'22050',...(item.model.endsWith('-next')?{channels:'2'}:{})}});
  else Object.assign(data,{model:item.model.startsWith('mai-')?'mai-image-2-6':item.model,apiModel:item.model,imageBuiltinSource:'seedance-nz',imageOnlyOutput:true,referenceImages:[],...(item.model===c.kling.model?{klingImageSize:'1:1',klingImageResolution:'2k',klingImageMode:item.group?'auto':'disabled',klingImageCount:1,klingImageMaxImages:2,klingImageNsfw:false}:{maiSize:'1:1',maiResolution:'1k',maiBackground:'opaque',maiNsfw:false,maiAutoAspectRatio:false,maiWebGrounding:false})});
  nodes.push({id:'generate',type:kind,position:{x:440,y:30},data});nodes.push({id:'output',type:'output',position:{x:900,y:30},data:{label:'结果 / Result'}});edges.push({id:'generate-output',source:'generate',target:'output'});
  return {schema:'t8-workflow-fragment',version:1,title:item.name,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],savedAt:'2026-11-19T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development directory required');for(const item of CASES)fs.writeFileSync(path.join(root,'docs/workflows',item.name+'.json'),JSON.stringify(workflow(item),null,2)+'\n');console.log('Saved '+CASES.length+' credential-free workflows');}
module.exports={CASES,workflow};
