'use strict';
const fs=require('node:fs'),path=require('node:path');
const CASES=[['t2v','kling-v4-t2v'],['i2v','kling-v4-i2v'],['omni','kling-v4-omni'],['element-images','kling-v4-custom-element'],['element-video','kling-v4-custom-element'],['voice-audio','kling-v4-custom-voice'],['voice-provider-id','kling-v4-custom-voice'],['linked-omni','kling-v4-omni']];
function workflow([mode,model]){
 const nodes=[],edges=[];
 const upload=(id,kind,label)=>{nodes.push({id,type:'upload',position:{x:0,y:nodes.length*260},data:{label,uploadType:kind,lockedUploadType:kind}});return id;};
 const video=(id,selected,x,data={})=>nodes.push({id,type:'video',position:{x,y:60},data:{providerSource:'zhenzhen',providerId:'',providerModel:'',videoBuiltinSource:'seedance-nz',mainId:'kling-v3.0',model:selected,prompt:'A friendly toy robot gently waves.',klingV4Duration:3,klingV4Resolution:'720p',klingV4Ratio:'16:9',klingV4Watermark:'api_default',reuseResult:false,...data}});
 const link=(source,target)=>edges.push({id:`${source}-${target}`,source,target});
 if(mode==='i2v'){link(upload('first-frame','image','首帧 / First frame'),'generation');link(upload('last-frame','image','可选尾帧 / Optional last frame'),'generation');}
 if(mode==='omni')link(upload('reference-image','image','可选参考图 / Optional image reference'),'generation');
 if(mode==='element-images'||mode==='linked-omni'){link(upload('front-view','image','主体正面图 / Front view'),mode==='linked-omni'?'element':'generation');link(upload('side-view','image','主体不同视角 / Different view'),mode==='linked-omni'?'element':'generation');}
 if(mode==='element-video')link(upload('element-video','video','3–8秒1080p主体视频 / 3–8s 1080p element video'),'generation');
 if(mode==='voice-audio'||mode==='linked-omni')link(upload('voice-sample','audio','自己的原始语音 / Your original voice sample'),mode==='linked-omni'?'voice':'generation');
 if(mode==='linked-omni'){video('voice','kling-v4-custom-voice',430,{prompt:'',klingV4VoiceName:'MyVoice',klingV4VoiceSource:'audio',klingV4AudioUrl:''});video('element','kling-v4-custom-element',860,{prompt:'A friendly toy robot with a round head.',klingV4ElementName:'MyRobot',klingV4ReferenceType:'image_refer',klingV4ElementVoiceId:''});link('voice','element');link('voice','generation');link('element','generation');}
 video('generation',model,mode==='linked-omni'?1290:430,{
  ...(model==='kling-v4-custom-element'?{prompt:'A friendly toy robot with a round head.',klingV4ElementName:'MyRobot',klingV4ReferenceType:mode==='element-video'?'video_refer':'image_refer',klingV4ElementVideoUrl:'',klingV4ElementVoiceId:'',klingV4Tags:''}:{}),
  ...(model==='kling-v4-custom-voice'?{prompt:'',klingV4VoiceName:'MyVoice',klingV4VoiceSource:mode==='voice-provider-id'?'video_id':'audio',klingV4AudioUrl:'',klingV4VideoId:''}:{}),
  ...(model==='kling-v4-omni'?{prompt:mode==='linked-omni'?'@element_1 gently waves and says hello in the supplied voice.':'A friendly toy robot gently waves.',klingV4VideoUrls:'',klingV4ImageElementIds:'',klingV4VideoElementIds:'',klingV4VoiceIds:''}:{}),
 });
 nodes.push({id:'output',type:'output',position:{x:mode==='linked-omni'?1750:900,y:60},data:{label:'保存结果 / Saved result'}});link('generation','output');
 return {schema:'t8-workflow-fragment',version:1,title:`kling-v4-${mode}`,nodes,edges,nodeCount:nodes.length,edgeCount:edges.length,nodeTypes:[...new Set(nodes.map(n=>n.type))],topologyPreview:{nodes:nodes.map(n=>({id:n.id,type:n.type,x:n.position.x,y:n.position.y,label:n.data.label||n.data.model})),edges},savedAt:'2026-10-27T00:00:00.000Z'};
}
if(require.main===module){const root=path.resolve(__dirname,'..');if(!require('./worktree-role.cjs').inspectCurrentWorktree(root,'development').ok)throw Error('Development worktree required');for(const item of CASES)fs.writeFileSync(path.join(root,'docs/workflows',`kling-v4-${item[0]}.json`),JSON.stringify(workflow(item),null,2)+'\n');}
module.exports={CASES,workflow};
