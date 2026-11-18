export function createNov19ModelsContract(contract, voices) {
  const fail = message => { throw Object.assign(new Error(message), {status:400,code:'NOV19_INVALID_PARAMETER'}); };
  const list = (value, name) => { if(value===undefined)return [];if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||!x.trim()))fail(name+' requires an ordered array');return [...value]; };
  const text = (value,max) => { if(typeof value!=='string'||!value.trim()||[...value].length>max)fail('Prompt is empty or exceeds the model character limit');return value.trim(); };
  const number = (value,fallback,min,max,integer=false) => { const n=value??fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||integer&&!Number.isSafeInteger(n))fail('Numeric parameter outside model range');return n; };
  const bool = (value,fallback=false) => { if(value===undefined)return fallback;if(typeof value!=='boolean')fail('Expected boolean parameter');return value; };
  const member = (value,values) => { if(!values.includes(value))fail('Unsupported model option: '+String(value));return value; };
  const isMai = model => contract.mai.models.includes(model);
  const isImage = model => model===contract.kling.model||isMai(model);
  const isAudio = model => contract.audio.models.includes(model);
  const audioProfile = model => {
    if(!isAudio(model))fail('Unknown Qwen Audio 3.1 model');const next=model.endsWith('-next'),plus=model.endsWith('-plus');
    return {next,plus,formats:next?contract.audio.nextFormats:contract.audio.systemFormats,rates:next?contract.audio.nextRates:contract.audio.systemRates,
      languages:plus?contract.audio.plusLanguages:contract.audio.flashLanguages,voices:next?[]:voices[plus?'plus':'flash'],maxPrompt:next?3000:20000,maxSeed:next?2147483647:65535};
  };
  function image(request) {
    const model=request.model,kling=model===contract.kling.model;if(!isImage(model))fail('Unknown image model');
    const images=list(request.images??request.refImages,'images'),spec=kling?contract.kling:contract.mai;
    if(images.length>spec.maxImages)fail('Too many image references');
    const prompt=text(request.prompt,kling?50000:contract.mai.maxPrompt);
    if(kling){const nonAscii=[...prompt].filter(c=>c.codePointAt(0)>127).length;if(([...prompt].length-nonAscii)*21000+nonAscii*50000>50000*21000)fail('Kling mixed-language prompt exceeds limit');}
    const payload={model,prompt,nsfw_check:bool(request.nsfw_check)};
    if(kling){
      for(const m of prompt.matchAll(/@Image([0-9]+)(?![0-9])/gi))if(+m[1]<1||+m[1]>images.length)fail('Kling reference tag has no matching image');
      payload.size=member(request.aspect_ratio??request.size??'auto',contract.kling.sizes);
      payload.resolution=member(String(request.resolution??'2k').toLowerCase(),contract.kling.resolutions);
      const mode=member(request.sequential_image_generation??'disabled',['disabled','auto']);payload.sequential_image_generation=mode;
      if(mode==='auto'){
        if(request.n!==undefined&&request.n!==1)fail('Kling group mode cannot combine n > 1');
        payload.sequential_image_generation_options={max_images:number(request.sequential_image_generation_options?.max_images,undefined,2,4,true)};
      }else payload.n=number(request.n,1,1,9,true);
    }else{
      if(request.n!==undefined&&request.n!==1)fail('MAI 2.7 n must be 1');payload.n=1;payload.background=member(request.background??'auto',['auto','opaque']);
      if(!images.length){
        const size=String(request.size??'1:1').trim(),pixels=/^(\d+)[xX*×](\d+)$/.exec(size),explicit=request.width!==undefined||request.height!==undefined;
        if(explicit||pixels){
          const w=explicit?request.width:Number(pixels[1]),h=explicit?request.height:Number(pixels[2]);
          number(w,undefined,768,Math.floor(spec.maxPixels/768),true);number(h,undefined,768,Math.floor(spec.maxPixels/768),true);
          if(w*h>spec.maxPixels)fail('MAI 2.7 pixel area exceeds 4194304');payload.width=Math.floor(w/32)*32;payload.height=Math.floor(h/32)*32;
        }else{
          const m=/^(\d+):(\d+)$/.exec(size);if(!m||+m[1]<1||+m[2]<1||!Number.isSafeInteger(+m[1])||!Number.isSafeInteger(+m[2])||Math.max(+m[1],+m[2])>Math.min(+m[1],+m[2])*4)fail('MAI 2.7 ratio must be 1:4 to 4:1; auto is unsupported');
          payload.size=size;payload.resolution=member(String(request.resolution??'1k').toLowerCase(),spec.resolutions);
        }
      }
    }
    if(images.length)payload.images=images;return payload;
  }
  function audio(request){
    const model=request.model,spec=audioProfile(model),p=request.qwenAudio31??request.metadata??{};
    if(!p||typeof p!=='object'||Array.isArray(p))fail('Qwen Audio parameters require an object');
    const prompt=text(request.prompt,spec.maxPrompt),format=member(p.format??(spec.next?'wav':'mp3'),spec.formats),sampleRate=member(String(p.sample_rate??(spec.next?'48000':'22050')),spec.rates);
    if(format==='opus'&&['22050','44100'].includes(sampleRate))fail('Opus does not support this sample rate');
    const metadata={format,sample_rate:sampleRate,rate:number(p.rate,1,.5,2),volume:number(p.volume,50,0,100,true),enable_aigc_tag:bool(p.enable_aigc_tag)};
    const refs=list(request.audioUrls??p.audio_urls,'audioUrls');if(refs.length>3)fail('Next accepts at most three references');
    const payload={model,prompt,metadata};
    if(spec.next){
      metadata.channels=member(String(p.channels??'2'),['1','2']);if(format==='mp3')metadata.enable_cbr=bool(p.enable_cbr);
      if(refs.length)metadata.audio_urls=refs;
      for(const m of prompt.matchAll(/@voice([0-9]+)(?![0-9])/gi))if(+m[1]<1||+m[1]>refs.length)fail('Qwen reference tag has no matching audio');
    }else{
      if(refs.length)fail('Only Qwen Next accepts reference audio');metadata.voice=member(p.voice??spec.voices[0].id,spec.voices.map(v=>v.id));
      metadata.pitch=number(p.pitch,1,.5,2);metadata.enable_ssml=bool(p.enable_ssml);
      if(p.language_hint&&p.language_hint!=='auto')metadata.language_hint=member(p.language_hint,spec.languages);
      if(p.instruction!==undefined&&typeof p.instruction!=='string')fail('Instruction must be text');if(p.instruction?.trim())metadata.instruction=p.instruction.trim();
      if(metadata.enable_ssml&&(!/^\s*<speak(?:\s[^>]*)?>[\s\S]*<\/speak>\s*$/.test(prompt)||/<!/.test(prompt)))fail('SSML requires a speak root without declarations');
    }
    const seed=number(p.seed??request.seed,-1,-1,spec.maxSeed,true);if(seed!==-1)payload.seed=seed;
    return payload;
  }
  return {contract,voices,isMai,isImage,isAudio,audioProfile,image,audio};
}
