const fs=require('node:fs'),path=require('node:path'),c=require('../backend/src/shared/h3TurboContract.json');
const CASES=[['minimax-h3-image-t2i',c.minimax.model,false],['minimax-h3-image-i2i',c.minimax.model,true],['qwen-image-2.1-turbo-t2i',c.qwen.model,false],['qwen-image-2.1-turbo-i2i',c.qwen.model,true],['minimax-h3-comfyui-max-t2v',c.video.model,false],['minimax-h3-comfyui-max-image-audio',c.video.model,true]];
function workflow(name){
 const row=CASES.find(row=>row[0]===name);if(!row)throw Error('Unknown workflow');const [,model,refs]=row,video=model===c.video.model;
 const nodes=[],edges=[];const node=(id,type,data,x,y=30)=>nodes.push({id,type,data,position:{x,y}}),edge=(source,target)=>edges.push({id:source+'-'+target,source,target});
 if(refs){node('reference1','upload',{uploadType:'image',lockedUploadType:'image',label:'参考图 1 / Reference 1'},0);edge('reference1','generate');if(!video){node('reference2','upload',{uploadType:'image',lockedUploadType:'image',label:'参考图 2 / Reference 2'},0,340);edge('reference2','generate');}else{node('audio','upload',{uploadType:'audio',lockedUploadType:'audio',label:'参考音频 / Reference audio'},0,340);edge('audio','generate');}}
 const base={model,providerSource:'zhenzhen',providerId:'',providerModel:'',reuseResult:false,prompt:refs?'Keep the teapot shape from image one, use blue ceramic glaze, simple studio background.':'A green ceramic teapot on a cream table, simple studio photography, no text.'};
 node('generate',video?'video':'image',video?{...base,mainId:model,videoBuiltinSource:'seedance-nz',ratio:'16:9',duration:3,resolution:'480p'}:{...base,apiModel:model,imageBuiltinSource:'seedance-nz',aspectRatio:'1:1',sizeLevel:model===c.qwen.model&&refs?'720p':'1k',h3TurboSeed:0,...(model===c.minimax.model?{h3TurboFormat:refs?'webp':'png'}:{}),imageOnlyOutput:true},470);
 node('output','output',{},960);edge('generate','output');
 return {schema:'t8-workflow-fragment',version:1,title:name,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],savedAt:'2026-11-11T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development worktree required');for(const [name]of CASES)fs.writeFileSync(path.join(root,'docs/workflows',name+'.json'),JSON.stringify(workflow(name),null,2)+'\n');console.log('Saved six credential-free workflows');}
module.exports={CASES,workflow};
