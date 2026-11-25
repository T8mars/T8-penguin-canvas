export function buildMagi2Payload(contract, input) {
  const fail = (code, message) => { throw Object.assign(new Error(message), { status: 400, code: `magi2_${code}` }); };
  if (!contract.models.includes(input.model)) fail('model', 'Invalid Magi 2 model');
  const mode = input.mode ?? 'auto';
  const ratio = input.ratio ?? 'api_default';
  const duration = input.duration ?? contract.duration.default;
  const generateAudio = input.generateAudio ?? true;
  const seed = input.seed ?? -1;
  if (!contract.modes.includes(mode)) fail('mode', 'Invalid Magi 2 generation mode');
  if (!contract.ratios.includes(ratio)) fail('ratio', 'Invalid Magi 2 aspect ratio');
  if (!Number.isInteger(duration) || duration < contract.duration.min || duration > contract.duration.max) {
    fail('duration', 'Magi 2 duration must be 4–30 whole seconds');
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || [...input.prompt].length > contract.maxPromptCharacters) {
    fail('prompt', 'Magi 2 requires a prompt of at most 15000 characters');
  }
  if (typeof generateAudio !== 'boolean') fail('audio', 'Invalid Magi 2 audio switch');
  if (!Number.isInteger(seed) || seed < -1 || seed > contract.maxSeed) fail('seed', 'Invalid Magi 2 seed');

  const read = (kind) => {
    const entries = input[kind] ?? [];
    if (!Array.isArray(entries) || entries.length > contract.reference[kind]
      || entries.some(entry => typeof entry !== 'string' || !entry.trim())) {
      fail('references', 'Magi 2 accepts up to 10 images, 5 videos and 5 audio clips');
    }
    return entries;
  };
  const images = read('images');
  const videos = read('videos');
  const audios = read('audios');
  const hasAV = videos.length > 0 || audios.length > 0;
  const hasReferences = images.length > 0 || hasAV;
  const effectiveMode = mode !== 'auto' ? mode : hasAV || images.length >= 3 ? 'reference' : images.length ? 'frame' : 'text';
  if (effectiveMode === 'text' && hasReferences) fail('text', 'Text mode does not accept references');
  if (effectiveMode === 'frame' && (hasAV || images.length < 1 || images.length > 2)) {
    fail('frame', 'Frame mode needs one or two ordered images and no video or audio');
  }
  if (effectiveMode === 'reference' && !hasReferences) fail('reference', 'Reference mode requires at least one reference');

  const metadata = { resolution: contract.resolution, generate_audio: generateAudio };
  if (mode !== 'auto') metadata.generation_type = mode;
  if (ratio !== 'api_default') metadata.ratio = ratio;
  if (seed >= 0) metadata.seed = seed;
  return {
    payload: { model: input.model, prompt: input.prompt.trim(), seconds: String(duration), metadata },
    references: { images, videos, audios },
    taskType: effectiveMode,
  };
}
