'use strict';
const fs=require('fs'),path=require('path'),c=require('../backend/src/shared/nov21ModelsContract.json'),h3=require('../backend/src/shared/h3TurboContract.json');
const CASES=[
 {name:'kling-v4-long-image-ecommerce',model:c.longImage.model,type:'image',images:1},
 {name:'kling-v4-long-image-webpage',model:c.longImage.model,type:'image',images:2,webpage:true},
 ...c.gemini.models.map(model=>({name:model.replace('/','-'),model,type:'audio'})),
 ...Object.values(h3).filter(s=>s.token).map(s=>({name:s.model,model:s.model,type:'video',images:1,audios:s.minAudios||0,videos:s.minVideos||0})),
 ...c.heygen.models.flatMap(model=>[false,true].map(audio=>({name:model+(audio?'-audio':'-text'),model,type:'video',audios:audio?1:0}))),
 ...[false,true].map(image=>({name:'miora-3d-'+(image?'image':'text'),model:c.miora.model,type:'model-3d',images:image?1:0})),
];
function workflow(item){const nodes=[],edges=[],data={providerSource:'zhenzhen',reuseResult:false,prompt:item.type==='audio'?'欢迎来到无限画布。':item.type==='video'?'A friendly person looks at the camera and waves gently.':item.type==='model-3d'?'A blue ceramic teapot.':item.webpage?'Design a coffee roastery landing page. Use @Image1 as style and @Image2 as subject.':'Create a product detail page for the teapot in @Image1.'};
 for(const [kind,count]of [['image',item.images],['audio',item.audios],['video',item.videos]])for(let i=0;i<(count||0);i++){const id=kind+i;nodes.push({id,type:'upload',position:{x:0,y:nodes.length*280},data:{uploadType:kind,lockedUploadType:kind,label:kind+' '+(i+1)}});edges.push({id:id+'-generate',source:id,target:'generate'});}
 if(item.type==='image')Object.assign(data,{model:'kling-v4-image',apiModel:item.model,imageBuiltinSource:'seedance-nz',imageOnlyOutput:true,longImageSkill:item.webpage?'webpage':'ecommerce',longImageLength:'short',longImageResolution:'1k',longImageSingleRole:'style',longImageNsfw:false});
 else if(item.type==='audio')Object.assign(data,{audioProviderMode:'gemini-tts',geminiTtsModel:item.model,geminiTtsParams:{voice:'Kore',instructions:''}});
 else if(item.type==='model-3d')Object.assign(data,{model:item.model,threeDTab:'miora-3d',mioraGenerateType:'normal',mioraFaceCount:500000,mioraPbr:false});
 else Object.assign(data,{mainId:c.heygen.models.includes(item.model)?'heygen-avatar-6':h3.video.model,model:item.model,videoBuiltinSource:'seedance-nz',duration:5,ratio:item.model.includes('charswap')?'auto':'16:9',resolution:c.heygen.models.includes(item.model)?'1080p':'768p',...(c.heygen.models.includes(item.model)?{heygenAvatar:'Abigail Sofa Front',heygenVoice:'Warm Pro Narrator',heygenMotionPrompt:''}:{h3ComfyDurationMode:'seconds'})});
 nodes.push({id:'generate',type:item.type,position:{x:440,y:30},data},{id:'result',type:item.type==='model-3d'?'model-3d-preview':'output',position:{x:900,y:30},data:{label:'结果 / Result'}});edges.push({id:'generate-result',source:'generate',target:'result'});
 return {schema:'t8-workflow-fragment',version:1,title:item.name,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],savedAt:'2026-11-22T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development directory required');for(const item of CASES)fs.writeFileSync(path.join(root,'docs/workflows',item.name+'.json'),JSON.stringify(workflow(item),null,2)+'\n');console.log('Saved '+CASES.length+' credential-free workflows');}
module.exports={CASES,workflow};
