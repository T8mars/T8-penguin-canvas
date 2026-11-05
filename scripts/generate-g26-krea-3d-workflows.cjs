'use strict';
const fs=require('node:fs'),path=require('node:path'),c=require('../backend/src/shared/g26Krea3dContract.json');
const imageCases=require('./verify-g26-krea-live.cjs').CASES;
const CASES=[...imageCases,...[...c.hitem.models,...c.meshy.models].map(model=>({id:model,model,refs:model.includes('multi')?2:1,three:true}))];
function workflow(item){
 const nodes=[],edges=[],three=!!item.three,g=c.g26.models.includes(item.model),k=c.krea.models.includes(item.model);
 for(let index=0;index<(item.refs||0);index++){const id='reference-'+index;nodes.push({id,type:'upload',position:{x:0,y:index*260},data:{label:three?(index?'背面 / Back':'正面 / Front'):`参考图 ${index+1} / Reference ${index+1}`,uploadType:'image',lockedUploadType:'image'}});edges.push({id:'reference-edge-'+index,source:id,target:'generation'});}
 const prompt=item.mode==='gif'?'A blue toy robot waves one arm, fixed camera, seamless animated looping GIF.':item.mode==='svg'?'A simple blue robot vector icon on a white background, geometric shapes.':'A friendly blue toy robot on a plain cream studio background.';
 const data=three?{model:item.model,threeDTab:item.model.startsWith('hitem')?'hitem3d':'meshy',hitemRequestType:item.model.includes('multi')?'both':'mesh',hitemResolution:item.model.includes('portrait')?'1536pro':'1536',hitemFace:100000,meshyPolycount:100,meshy_should_remesh:'true',meshy_should_texture:'false',meshy_enable_pbr:'false'}:
  {model:g?c.g26.tab:k?c.krea.tab:c.zimage.tab,apiModel:item.model,imageBuiltinSource:'seedance-nz',providerSource:'zhenzhen',providerId:'',providerModel:'',aspectRatio:'',sizeLevel:'',referenceImages:[],imageOnlyOutput:true,prompt,
   ...(g?{g26Mode:item.mode||'image',g26Size:item.mode==='svg'?'auto':'1:1',g26Count:item.n||1,g26Resolution:'1k',g26Format:'png',g26GifSize:'512x512',g26FrameCount:2,g26FrameDuration:200}:{}),
   ...(k?{kreaSize:'custom',kreaWidth:256,kreaHeight:256,kreaSeed:42,kreaVariant:item.refs?'jam':'berry',kreaReasoning:'low',kreaFormat:item.refs?'jpeg':'png'}:{}),
   ...(!g&&!k?{zImageRatio:'1:1',zImageSeed:42}:{})};
 nodes.push({id:'generation',type:three?'model-3d':'image',position:{x:440,y:50},data:{label:item.model,...data,reuseResult:false}});
 nodes.push({id:'output',type:three?'model-3d-preview':'output',position:{x:960,y:50},data:{label:'结果 / Result'}});edges.push({id:'result-edge',source:'generation',target:'output'});
 return {schema:'t8-workflow-fragment',version:1,title:item.id,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],savedAt:'2026-11-05T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development worktree required');for(const item of CASES)fs.writeFileSync(path.join(root,'docs/workflows',item.id+'.json'),JSON.stringify(workflow(item),null,2)+'\n');console.log(`Saved ${CASES.length} credential-free workflows`);}
module.exports={CASES,workflow};
