export function createSeedream55DraftContract(c) {
  const fail = (code, field = '') => { throw Object.assign(new Error(`Seedream/Seedance: ${code}${field ? ` (${field})` : ''}`), { code, field, status: 400 }); };
  const bool = (value, field, fallback = false) => { if (value === undefined) return fallback; if (typeof value !== 'boolean') fail('boolean', field); return value; };
  function buildImage(r) {
    if (r.prompt !== undefined && typeof r.prompt !== 'string') fail('prompt');
    const layer = c.layerModels.includes(r.model);
    if (!layer && !c.imageModels.includes(r.model)) fail('model');
    const refs = r.images || [], prompt = String(r.prompt || '').trim(), length = [...prompt].length;
    if (!Array.isArray(refs) || refs.some(url => typeof url !== 'string' || !url)) fail('images');
    if (layer ? refs.length !== 1 : r.model.endsWith('-i2i') ? refs.length < 1 || refs.length > c.maxReferences : refs.length !== 0) fail('images');
    if (layer ? length > 2000 : length < 5 || length > 5000) fail('prompt');
    const format = r.output_format ?? 'png'; if (!['png', 'jpeg'].includes(format)) fail('format');
    const metadata = { output_format: format, watermark: bool(r.watermark, 'watermark') };
    if (layer) {
      const resolution = r.resolution || 'auto'; if (!['auto', ...c.resolutions].includes(resolution)) fail('resolution');
      metadata.resolution = resolution;
      const max = r.max_images ?? 30; if (!Number.isInteger(max) || max < 2 || max > 100) fail('maxImages');
      metadata.max_images = max; metadata.text_recognition = bool(r.text_recognition, 'text_recognition');
      if (r.background !== undefined || r.size || r.width !== undefined || r.height !== undefined) fail('unsupported', 'background/size');
    } else {
      const background = r.background ?? 'auto'; if (!['auto', 'transparent', 'opaque'].includes(background)) fail('background');
      if (background === 'transparent' && format !== 'png') fail('transparentPng');
      metadata.background = background;
      if (r.max_images !== undefined || r.text_recognition !== undefined) fail('unsupported', 'layer controls');
      if (r.size || r.width !== undefined || r.height !== undefined) {
        if (r.resolution && r.resolution !== 'custom') fail('unsupported', 'resolution/size');
        const match = /^(\d+)[xX×](\d+)$/.exec(String(r.size || '').trim());
        const w = r.width ?? Number(match?.[1]), h = r.height ?? Number(match?.[2]);
        if (![w, h].every(v => Number.isInteger(v) && v >= 240 && v <= 11520) || w * h < 921600 || w * h > 8294400 || w / h < 1 / 16 || w / h > 16) fail('dimensions');
        metadata.width = w; metadata.height = h;
      } else { const resolution = r.resolution || '1k'; if (!c.resolutions.includes(resolution)) fail('resolution'); metadata.resolution = resolution; }
    }
    const identifier = r.safety_identifier ?? ''; if (typeof identifier !== 'string' || [...identifier].length > 64) fail('identifier');
    if (identifier) metadata.safety_identifier = identifier;
    return { model: r.model, ...(prompt ? { prompt } : {}), ...(refs.length ? { images: [...refs] } : {}), metadata };
  }
  function draftId(value) { const id = typeof value === 'string' ? value.trim() : ''; if (!id || id.length > 512 || /\s|:\/\//.test(id)) fail('draftId'); return id; }
  function buildDraft(r) {
    if (!c.draftModels.includes(r.model)) fail('model');
    for (const field of ['prompt', 'images', 'refImages', 'firstFrame', 'lastFrame', 'videos', 'audios']) if (Array.isArray(r[field]) ? r[field].length : r[field]) fail('draftReferences');
    const format = r.output_format ?? 'mp4'; if (!['mp4', 'mov'].includes(format)) fail('format');
    return { model: r.model, metadata: { draft_task_id: draftId(r.draft_task_id), output_format: format, return_last_frame: bool(r.return_last_frame, 'return_last_frame') } };
  }
  return { buildImage, buildDraft, draftId, isImage: model => [...c.imageModels, ...c.layerModels].includes(model), isDraft: model => c.draftModels.includes(model) };
}
