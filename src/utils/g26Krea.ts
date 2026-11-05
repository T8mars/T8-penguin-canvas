import contract from '../../backend/src/shared/g26Krea3dContract.json';
import type { SeedreamNzSubmitRequest } from '../services/generation';
export const NEW_IMAGE_CONTRACT = contract;
export const NEW_IMAGE_TABS = [contract.g26.tab,contract.krea.tab,contract.zimage.tab];
export const NEW_IMAGE_MODELS = [...contract.g26.models,...contract.krea.models,contract.zimage.model];
export const isNewImageModel = (model: string) => NEW_IMAGE_MODELS.includes(model);
export function newImageSettings(model: string, data: Record<string,any>) {
  const defaults: Record<string,string|number> = contract.g26.models.includes(model) ? {
    g26Mode:'image',g26Size:'1:1',g26Width:1024,g26Height:1024,g26Resolution:'1k',g26Count:1,g26Quality:'auto',g26Format:'png',g26Complexity:'api_default',g26Compression:-1,
    g26GifSize:'512x512',g26GifWidth:512,g26GifHeight:512,g26FrameCount:9,g26FrameDuration:200,g26MaskUrl:'',g26MarkupUrl:''
  } : contract.krea.models.includes(model) ? {kreaSize:'1:1',kreaWidth:1024,kreaHeight:1024,kreaVariant:'berry',kreaReasoning:'low',kreaFormat:'png',kreaSeed:-1,kreaNegative:''} : {zImageRatio:'1:1',zImageSeed:-1};
  return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,data[key] ?? value]));
}
export function buildNewImageRequest(model: string,prompt: string,images: string[],data: Record<string,any>): SeedreamNzSubmitRequest {
  const s = newImageSettings(model,data), fail = (key: string): never => {throw new Error(`g26Krea3d:${key}`);};
  if (!isNewImageModel(model)) fail('invalidModel');
  if (!prompt.trim()) fail('promptRequired');
  const request: SeedreamNzSubmitRequest = {model:model as SeedreamNzSubmitRequest['model'],prompt:prompt.trim(),...(images.length?{images:[...images]}:{})};
  if (contract.g26.models.includes(model)) {
    const low = model === contract.g26.models[0], mode = s.g26Mode;
    if (!(low?['image','gif']:['image','gif','svg']).includes(String(mode))) fail('invalidMode');
    if (images.length > (low?2:16) || !low && mode !== 'image' && images.length) fail('g26References');
    Object.assign(request,{output_mode:mode,n:low || mode !== 'image'?1:s.g26Count});
    if (low) Object.assign(request,{size:s.g26Size,resolution:'1k'});
    else if (mode === 'gif') Object.assign(request,{size:s.g26GifSize === 'custom'?`${s.g26GifWidth}x${s.g26GifHeight}`:s.g26GifSize,frame_count:s.g26FrameCount,frame_duration_ms:s.g26FrameDuration});
    else {
      request.size = s.g26Size === 'custom'?`${s.g26Width}x${s.g26Height}`:String(s.g26Size);
      if (mode === 'image') {
        Object.assign(request,{resolution:s.g26Resolution,output_format:s.g26Format,quality:s.g26Quality,complexity:s.g26Complexity});
        if (Number(s.g26Compression)>=0 && ['jpeg','webp'].includes(String(s.g26Format))) request.output_compression=Number(s.g26Compression);
        if (s.g26MaskUrl) request.mask_url=String(s.g26MaskUrl).trim();
        if (s.g26MarkupUrl) request.markup_url=String(s.g26MarkupUrl).trim();
      }
    }
  } else if (contract.krea.models.includes(model)) {
    if (model.endsWith('-t2i')?images.length!==0:images.length<1 || images.length>8) fail('kreaReferences');
    const preset=contract.krea.presets[s.kreaSize as keyof typeof contract.krea.presets];
    const [w,h]=s.kreaSize==='custom'?[Number(s.kreaWidth),Number(s.kreaHeight)]:preset||[];
    if (![w,h].every(v=>Number.isInteger(v)&&v>=256&&v<=4096)||w*h>contract.krea.maxPixels) fail('kreaPixels');
    Object.assign(request,{size:`${w}*${h}`,model_variant:s.kreaVariant,reasoning_level:s.kreaReasoning,output_format:s.kreaFormat,seed:s.kreaSeed,negative_prompt:s.kreaNegative});
  } else {
    if (images.length) fail('zReferences');
    Object.assign(request,{ratio:s.zImageRatio,seed:s.zImageSeed});
  }
  return request;
}
