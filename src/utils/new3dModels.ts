import contract from '../../backend/src/shared/g26Krea3dContract.json';
import type { Hunyuan3DModel,Hunyuan3DSubmitRequest } from '../services/generation';
export const NEW_3D_CONTRACT=contract;
export const NEW_3D_MODELS=[...contract.hitem.models,...contract.meshy.models];
export function buildNew3dRequest(model:Hunyuan3DModel,images:string[],data:Record<string,any>,translate:(key:string)=>string=key=>key):Hunyuan3DSubmitRequest {
  if(!NEW_3D_MODELS.includes(model))throw Error(translate('g26Krea3d:invalidModel'));
  const text=model===contract.meshy.textModel;
  if(text?images.length!==0:model.includes('multi-image')?images.length<2||images.length>4:images.length!==1)throw Error(translate(text?'g26Krea3d:meshyTextReferences':'g26Krea3d:threeDReferences'));
  const request:Hunyuan3DSubmitRequest={model,...(!text?{images:[...images]}:{})};
  if(contract.hitem.models.includes(model)){
    request.request_type=data.hitemRequestType??'both';request.resolution=model.includes('portrait')?'1536pro':data.hitemResolution??'1536';request.face=data.hitemFace??1000000;
  }else{
    if(text){
      const prompt=String(data.prompt??'').trim();
      if(!prompt||[...prompt].length>contract.meshy.maxPromptCharacters)throw Error(translate('g26Krea3d:meshyPromptLength'));
      request.prompt=prompt;
      if(data.meshyArtStyle&&data.meshyArtStyle!=='api_default')request.art_style=data.meshyArtStyle;
      if(data.meshyPromptExpansion==='true'||data.meshyPromptExpansion==='false')request.enable_prompt_expansion=data.meshyPromptExpansion==='true';
    }
    if(data.meshyTopology&&data.meshyTopology!=='api_default')request.topology=data.meshyTopology;
    if(data.meshySymmetry&&data.meshySymmetry!=='api_default')request.symmetry_mode=data.meshySymmetry;
    if(data.meshyPolycount)request.target_polycount=data.meshyPolycount;
    for(const field of contract.meshy.booleans){if(text&&field==='should_texture')continue;const v=data['meshy_'+field];if(v==='true'||v==='false')(request as any)[field]=v==='true';}
  }
  return request;
}
