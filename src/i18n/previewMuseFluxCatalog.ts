export const previewMuseFluxZh = {
  hyDescription: '支持文生图和最多5张有序参考图。自定义宽高256–8192，总像素不超过8,294,400；0为随机种子。',
  museImageDescription: '文生图或最多9张参考图；参考图总计不超过11 MiB。尺寸和格式由模型决定。',
  museVideoDescription: '固定约10秒、720p、有声音。最多9张参考图，总计11 MiB；参考构图不保证相同首帧。不支持参考视频或音频。',
  fluxDescription: 'T2I不接收参考图；I2I需要1–10张参考图，每张不超过10 MiB。Klein支持种子、步数和格式。',
  width:'宽度',height:'高度',seed:'种子',negative:'负面提示词',steps:'步数（0为平台默认）',format:'输出格式',apiDefault:'平台默认',
  promptRequired:'必须填写提示词',invalidModel:'模型无效',imageCount:'参考图数量超限',invalidRatio:'画幅无效',invalidResolution:'分辨率无效',
  fluxReferences:'Flux T2I不能连接图片，I2I需要1–10张参考图',invalidSafety:'安全容忍度须为0–4整数',invalidSeed:'种子超出有效整数范围',invalidSteps:'步数须为0–16整数',invalidFormat:'输出格式无效',invalidBoolean:'选项须为布尔值',invalidPrompt:'负面提示词须为文本',invalidPixels:'宽高须为256–8192整数，总像素不超过8,294,400',museReferences:'Muse最多接收9张参考图，不支持视频或音频参考'
};
export const previewMuseFluxEn: Record<keyof typeof previewMuseFluxZh,string> = {
 hyDescription:'Text or up to 5 ordered reference images. Custom edges: 256–8192; at most 8,294,400 pixels. Seed 0 is random.',
 museImageDescription:'Text or up to 9 ordered references, totaling at most 11 MiB. The model chooses dimensions and format.',
 museVideoDescription:'About 10 seconds, 720p, with audio. Up to 9 references totaling 11 MiB. Composition guidance does not guarantee an identical first frame. No video/audio references.',
 fluxDescription:'T2I accepts no references. I2I requires 1–10 images, at most 10 MiB each. Klein supports seed, steps and format.',
 width:'Width',height:'Height',seed:'Seed',negative:'Negative prompt',steps:'Steps (0 uses API default)',format:'Output format',apiDefault:'API default',
 promptRequired:'A prompt is required',invalidModel:'Invalid model',imageCount:'Too many reference images',invalidRatio:'Invalid aspect ratio',invalidResolution:'Invalid resolution',fluxReferences:'Flux T2I accepts no images; I2I requires 1–10 references',invalidSafety:'Safety tolerance must be an integer from 0 to 4',invalidSeed:'Seed is outside the supported integer range',invalidSteps:'Steps must be an integer from 0 to 16',invalidFormat:'Invalid output format',invalidBoolean:'Expected a boolean option',invalidPrompt:'Negative prompt must be text',invalidPixels:'Edges must be integers from 256 to 8192, totaling at most 8,294,400 pixels',museReferences:'Muse accepts up to 9 images and no video/audio references'
};
