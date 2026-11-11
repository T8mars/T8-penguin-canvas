// Runtime-neutral contract: both frontend preflight and backend use this builder.
export function createH3TurboContract(contract) {
  const imageModels = [contract.minimax.model, contract.qwen.model];
  const profile = model => Object.values(contract).find(spec => spec.model === model);
  const fail = code => { throw Object.assign(new Error(`H3/Turbo: ${code}`), { code, status: 400 }); };
  const refs = value => { if (value === undefined) return []; if (!Array.isArray(value) || value.some(url => typeof url !== 'string' || !url.trim())) fail('references'); return [...value]; };
  function build(request) {
    const spec = profile(request.model); if (!spec) fail('model');
    const video = spec === contract.video;
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (!prompt || spec.promptBytes && new TextEncoder().encode(prompt).length > spec.promptBytes) fail('prompt');
    const images = refs(request.images), audios = refs(request.audios);
    if (images.length > spec.maxImages || audios.length > (spec.maxAudios || 0) || refs(request.videos).length) fail('references');
    const resolution = request.resolution ?? spec.defaultResolution, ratio = request.ratio ?? spec.ratios[0];
    if (!spec.resolutions.includes(resolution) || !video && resolution === '720p' && !images.length) fail('resolution');
    if (!spec.ratios.includes(ratio)) fail('ratio');
    const metadata = { resolution, ratio };
    const payload = { model: spec.model, prompt, ...(images.length ? { images } : {}), metadata };
    if (video) {
      const seconds = request.seconds ?? '5';
      if (typeof seconds !== 'string' || !/^(?:[3-9]|1[0-5])$/.test(seconds)) fail('seconds');
      if (request.seed !== undefined || request.output_format !== undefined) fail('unsupported');
      payload.seconds = seconds;
      if (audios.length) metadata.audio_urls = audios;
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
  return { contract, profile, imageModels, build };
}
