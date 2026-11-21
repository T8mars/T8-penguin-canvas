import contract from '../../backend/src/shared/nov21ModelsContract.json';
import {createNov21ModelsContract} from '../../backend/src/shared/nov21ModelsContract.mjs';
export const NOV21=createNov21ModelsContract(contract);
export const longImageSettings=(d:Record<string,any>):Record<string,any>=>({longImageSkill:d.longImageSkill??'ecommerce',longImageLength:d.longImageLength??'medium',longImageResolution:d.longImageResolution??'1k',longImageSingleRole:d.longImageSingleRole??'style',longImageNsfw:d.longImageNsfw??false});
export function buildLongImageRequest(prompt:string,images:string[],data:Record<string,any>){
 const s=longImageSettings(data);return NOV21.image({model:contract.longImage.model,prompt,skill:s.longImageSkill,resolution:s.longImageResolution,nsfw_check:s.longImageNsfw,...(s.longImageSkill==='ecommerce'?{images,length:s.longImageLength}:{image_with_roles:images.map((url,i)=>({url,role:images.length===1?s.longImageSingleRole:i===0?'style':'subject'}))})});
}
export function buildGeminiTtsRequest(model:string,prompt:string,audioUrls:string[],geminiTts:Record<string,any>){return {...NOV21.audio({model,prompt,audioUrls,geminiTts}),geminiTts};}
export function buildHeygenRequest(model:string,prompt:string,images:string[],audios:string[],videos:string[],data:Record<string,any>){const request={model,prompt,images,audios,videos,heygen:{avatar:data.heygenAvatar??'Abigail Sofa Front',voice:data.heygenVoice??'Warm Pro Narrator',motion_prompt:data.heygenMotionPrompt??'',ratio:data.ratio??'16:9',resolution:data.resolution??'1080p'}};NOV21.video(request);return request;}
export function buildMioraRequest(images:string[],data:Record<string,any>){return NOV21.model3d({model:contract.miora.model,images,prompt:data.prompt??'',generate_type:data.mioraGenerateType??'normal',face_count:data.mioraFaceCount??500000,enable_pbr:data.mioraPbr??false});}
