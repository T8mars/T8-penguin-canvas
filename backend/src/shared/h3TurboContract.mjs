// Runtime-neutral contract: both frontend preflight and backend use this builder.
export function createH3TurboContract(contract) {
  const imageModels = [contract.minimax.model, contract.qwen.model];
  const profile = model => Object.values(contract).find(spec => spec.model === model);
  const videoModels = Object.values(contract).filter(spec => spec === contract.video || spec.video).map(spec => spec.model);
  const normalizeResultModel = model => ({'minimax-h3-comfyui-max/10020':contract.wf.model,'minimax-h3-comfyui-max/10021':contract.selflift.model}[model] || model);
  const frames = Array.from({length: 21}, (_, i) => 22 + 17 * i);
  const ratios = (spec, resolution) => spec.token ? spec.ratios : spec.frames ? resolution === 'auto' ? ['auto'] : resolution === '768p' ? spec.ratios : ['auto','16:9','9:16'] : spec.ratios;
  const fail = code => { throw Object.assign(new Error(`H3/Turbo: ${code}`), { code, status: 400 }); };
  const refs = value => { if (value === undefined) return []; if (!Array.isArray(value) || value.some(url => typeof url !== 'string' || !url.trim())) fail('references'); return [...value]; };
  function build(request) {
    const spec = profile(request.model); if (!spec) fail('model');
    const video = videoModels.includes(spec.model);
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (!prompt || spec.promptBytes && new TextEncoder().encode(prompt).length > spec.promptBytes) fail('prompt');
    const images = refs(request.images), audios = refs(request.audios), videos = refs(request.videos);
    if (images.length > spec.maxImages || images.length < (spec.minImages || 0) || audios.length > (spec.maxAudios || 0) || audios.length < (spec.minAudios || 0) || videos.length > (spec.maxVideos || 0) || videos.length < (spec.minVideos || 0)) fail('references');
    if (spec.audioNeedsImage && audios.length && !images.length || spec.videoNeedsImage && videos.length && !images.length) fail('image-required');
    const resolution = request.resolution ?? spec.defaultResolution, ratio = request.ratio ?? spec.ratios[0];
    if (!spec.resolutions.includes(resolution) || !video && resolution === '720p' && !images.length) fail('resolution');
    if (!ratios(spec, resolution).includes(ratio)) fail('ratio');
    const metadata = { ...(spec.token ? {} : {resolution}), ratio };
    const payload = { model: spec.model, prompt, ...(images.length ? { images } : {}), metadata };
    if (video) {
      if (request.frames !== undefined) {
        if (!spec.frames || !frames.includes(request.frames) || request.seconds !== undefined) fail('frames');
        metadata.frames = request.frames;
      } else {
        const seconds = request.seconds ?? '5';
        if (typeof seconds !== 'string' || !/^(?:[3-9]|1[0-5])$/.test(seconds) || Number(seconds) < (spec.minSeconds || 3)) fail('seconds');
        payload.seconds = seconds;
      }
      if (request.seed !== undefined && !spec.nativeSeed || request.output_format !== undefined) fail('unsupported');
      if (spec.nativeSeed) {
        const seed = request.seed ?? -1;
        if (!Number.isInteger(seed) || seed < -1 || seed > 2147483647) fail('seed');
        if (seed >= 0) metadata.seed = seed;
      }
      if (audios.length) metadata.audio_urls = audios;
      if (videos.length) metadata.video_url = videos;
      if (spec.video) for (const match of prompt.matchAll(/<(Picture|Audio)\s+(\d+)>/gi)) {
        const count = match[1].toLowerCase() === 'picture' ? images.length : spec.audioTags ? audios.length : 0;
        if (Number(match[2]) < 1 || Number(match[2]) > count) fail('reference-tag');
      }
    } else {
      const seed = request.seed ?? -1;
      if (!Number.isInteger(seed) || seed < -1 || seed > 2147483647) fail('seed');
      if (seed >= 0) metadata.seed = seed;
      if (spec.formats) { const format = request.output_format ?? 'jpeg'; if (!spec.formats.includes(format)) fail('format'); metadata.output_format = format; }
      else if (request.output_format !== undefined) fail('unsupported');
    }
    for (const key of ['n', 'size', 'width', 'height', 'megapixels']) if (request[key] !== undefined) fail('unsupported');
    return payload;
  }
  return { contract, profile, imageModels, videoModels, frames, ratios, build, normalizeResultModel };
}
