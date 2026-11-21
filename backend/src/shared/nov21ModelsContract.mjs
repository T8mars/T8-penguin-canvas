// Runtime-neutral preflight, shared by the editor and production provider.
export function createNov21ModelsContract(contract) {
  const fail = message => { throw Object.assign(new Error(message), {status:400,code:'NOV21_INVALID_PARAMETER'}); };
  const list = value => { if(value===undefined)return [];if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!v.trim()))fail('Expected ordered media references');return [...value]; };
  const text = (value,max,required=true) => { if(typeof value!=='string'||[...value].length>max||required&&!value.trim())fail('Text is empty or exceeds the model limit');return value.trim(); };
  const member = (value,values) => { if(!values.includes(value))fail('Unsupported model option');return value; };
  const bool = value => { if(value===undefined)return false;if(typeof value!=='boolean')fail('Expected boolean');return value; };
  const isImage = model => model===contract.longImage.model;
  const isAudio = model => contract.gemini.models.includes(model);
  const isVideo = model => contract.heygen.models.includes(model);
  function image(request) {
    if(!isImage(request.model))fail('Unknown long-image model');
    const prompt=text(request.prompt,166000),skill=member(String(request.skill??'ecommerce').toLowerCase(),contract.longImage.skills),images=list(request.images),roles=request.image_with_roles??[];
    const chars=[...prompt],nonAscii=chars.filter(c=>c.codePointAt(0)>127).length;
    if((chars.length-nonAscii)*71000+nonAscii*166000>166000*71000)fail('Long-image mixed-language prompt exceeds limit');
    if(!Array.isArray(roles)||roles.some(v=>!v||typeof v.url!=='string'||!v.url.trim()||!['style','subject'].includes(v.role))||new Set(roles.map(v=>v.role)).size!==roles.length)fail('Use at most one style and one subject reference');
    if(skill==='ecommerce'&&(images.length<1||images.length>3||roles.length)||skill==='webpage'&&(images.length||request.length!==undefined))fail('Long-image mode and references do not match');
    const ordered=roles.slice().sort((a,b)=>['style','subject'].indexOf(a.role)-['style','subject'].indexOf(b.role));
    const count=skill==='ecommerce'?images.length:ordered.length;
    for(const match of prompt.matchAll(/@Image([0-9]+)(?![0-9])/gi))if(+match[1]<1||+match[1]>count)fail('Long-image reference tag has no matching input');
    const payload={model:request.model,prompt,skill,resolution:member(String(request.resolution??'1k').toLowerCase(),contract.longImage.resolutions),nsfw_check:bool(request.nsfw_check)};
    if(skill==='ecommerce'){payload.length=member(request.length??'medium',contract.longImage.lengths);payload.images=images;}else if(ordered.length)payload.image_with_roles=ordered.map(v=>({url:v.url,role:v.role}));
    return payload;
  }
  function audio(request) {
    if(!isAudio(request.model))fail('Unknown Gemini TTS model');
    if(list(request.audioUrls).length)fail('Gemini TTS does not accept reference audio');
    const p=request.geminiTts??request.metadata??{},voice=contract.gemini.voices.find(v=>v.toLowerCase()===String(p.voice??'Kore').trim().toLowerCase());
    if(!voice||p.format!==undefined&&p.format!=='wav')fail('Gemini TTS requires a documented voice and WAV');
    const instructions=text(p.instructions??'',1000,false),metadata={voice,format:'wav'};if(instructions)metadata.instructions=instructions;
    return {model:request.model,prompt:text(request.prompt,5000),metadata};
  }
  function video(request) {
    if(!isVideo(request.model))fail('Unknown HeyGen model');
    if(list(request.images).length||list(request.videos).length)fail('HeyGen does not accept image or video references');
    const p=request.heygen??request.metadata??{},audios=list(request.audios??p.audio_urls);
    if(audios.length>1)fail('HeyGen accepts one audio track');
    const metadata={avatar:text(p.avatar??'Abigail Sofa Front',500),ratio:member(p.ratio??request.ratio??'16:9',contract.heygen.ratios),resolution:member(p.resolution??request.resolution??'1080p',contract.heygen.resolutions)};
    const motion=text(p.motion_prompt??'',1200,false);if(motion)metadata.motion_prompt=motion;
    const payload={model:request.model,metadata};
    if(audios.length)metadata.audio_urls=audios;else{payload.prompt=text(request.prompt,5000);metadata.voice=text(p.voice??'Warm Pro Narrator',500);}
    return payload;
  }
  function model3d(request) {
    if(request.model!==contract.miora.model)fail('Unknown Miora model');
    const images=list(request.images);if(images.length>8)fail('Miora accepts at most eight ordered views');
    const generate_type=member(request.generate_type??'normal',['normal','geometry']),face_count=request.face_count??500000;
    if(!Number.isSafeInteger(face_count)||face_count<3000||face_count>1500000)fail('Miora face count must be 3000–1500000');
    const payload={model:request.model,generate_type,face_count};
    if(generate_type==='normal')payload.enable_pbr=bool(request.enable_pbr);
    if(images.length)payload.images=images;else payload.prompt=text(request.prompt,Number.MAX_SAFE_INTEGER);
    return payload;
  }
  return {contract,isImage,isAudio,isVideo,image,audio,video,model3d};
}
