import contract from '../../backend/src/shared/g26Krea3dContract.json';
import type { Hunyuan3DModel,Hunyuan3DSubmitRequest } from '../services/generation';
export const NEW_3D_CONTRACT=contract;
export const NEW_3D_MODELS=[...contract.hitem.models,...contract.meshy.models];
export function buildNew3dRequest(model:Hunyuan3DModel,images:string[],data:Record<string,any>,translate:(key:string)=>string=key=>key):Hunyuan3DSubmitRequest {
  if(!NEW_3D_MODELS.includes(model))throw Error(translate('g26Krea3d:invalidModel'));
  if(model.includes('multi-image')?images.length<2||images.length>4:images.length!==1)throw Error(translate('g26Krea3d:threeDReferences'));
  const request:Hunyuan3DSubmitRequest={model,images:[...images]};
  if(contract.hitem.models.includes(model)){
    request.request_type=data.hitemRequestType??'both';request.resolution=model.includes('portrait')?'1536pro':data.hitemResolution??'1536';request.face=data.hitemFace??1000000;
  }else{
    if(data.meshyTopology&&data.meshyTopology!=='api_default')request.topology=data.meshyTopology;
    if(data.meshySymmetry&&data.meshySymmetry!=='api_default')request.symmetry_mode=data.meshySymmetry;
    if(data.meshyPolycount)request.target_polycount=data.meshyPolycount;
    for(const field of contract.meshy.booleans){const v=data['meshy_'+field];if(v==='true'||v==='false')(request as any)[field]=v==='true';}
  }
  return request;
}
