// Runtime-neutral contract shared by the renderer and Provider; no network or storage.
export function createTripoContract(contract) {
  const models = contract.models.map(item => item.id);
  const fail = (code, field = '') => { throw Object.assign(new Error(`${code}${field ? `: ${field}` : ''}`), { code, field, status: 400 }); };
  const profile = model => contract.models.find(item => item.id === model) || fail('invalidModel');
  const value = (data, key) => data[key] ?? contract.fields[key]?.default;
  const enabled = (data, key, fallback = false) => {
    const v = value(data, key);
    return v === 'api_default' || v == null ? fallback : v === true || v === 'true';
  };
  function activeFields(model, data = {}, imageCount = 0) {
    const p = profile(model), fields = new Set(contract.familyFields[p.group]);
    if (p.group === 'generate') {
      const h3 = model.startsWith('tripo-h-v3.'), p1 = model.startsWith('tripo-p-p1'), p2 = model.startsWith('tripo-p-p2');
      if (p.mode !== 'text') for (const k of ['prompt', 'negative_prompt', 'image_seed']) fields.delete(k);
      if (p.mode === 'text') for (const k of ['texture_alignment', 'orientation']) fields.delete(k);
      if (p.mode !== 'image') fields.delete('enable_image_autofix');
      if (p.mode !== 'multiview') for (const k of ['input_mode', 'multiview_task_id']) fields.delete(k);
      else if (value(data, 'input_mode') !== 'multiviewTaskId') fields.delete('multiview_task_id');
      if (!h3) for (const k of ['geometry_quality', 'smart_low_poly', 'generate_parts']) fields.delete(k);
      if (!(h3 || p2)) fields.delete('quad');
      if (!(h3 || p1 || p2)) for (const k of ['texture_quality', 'auto_size', 'compress']) fields.delete(k);
      if (!enabled(data, 'texture', true) && !enabled(data, 'pbr', true)) for (const k of ['texture_quality', 'texture_alignment', 'orientation', 'texture_seed']) fields.delete(k);
    } else if (p.group === 'texture') {
      const mode = value(data, 'texture_prompt_mode');
      if (mode !== 'text') for (const k of ['texture_prompt_text', 'style_image_url']) fields.delete(k);
      if (mode !== 'image') fields.delete('texture_image_url');
      if (mode !== 'images') for (const view of contract.views) fields.delete(`texture_${view}_image_url`);
      if (model.endsWith('v2.5')) fields.delete('compress');
    } else if (p.group === 'retopology' && model.endsWith('v1')) {
      fields.delete('bake'); fields.delete('part_names');
    } else if (p.group === 'mesh') {
      fields.clear(); fields.add('model_url');
      if (model.endsWith('segment-v2')) {
        fields.add('ref_image_url');
        if (!data.ref_image_url && !imageCount) { fields.add('segmentation_granularity'); fields.add('split_by_connectivity'); }
      } else if (model.endsWith('smartsegment')) {
        for (const k of ['seg_type', 'granularity', 'hint']) fields.add(k);
        if (value(data, 'seg_type') === 'image') { fields.delete('model_url'); fields.add('image_url'); }
        else fields.add('transform');
      } else if (model.endsWith('complete')) {
        fields.clear(); for (const k of ['tripo_segment_task_id', 'completion_mode', 'part_names']) fields.add(k);
      }
    } else if (p.group === 'convert') {
      if (!enabled(data, 'quad')) fields.delete('force_symmetry');
      if (!enabled(data, 'flatten_bottom')) fields.delete('flatten_bottom_threshold');
      if (!['GLTF', 'OBJ'].includes(value(data, 'format'))) fields.delete('export_vertex_colors');
      if (value(data, 'format') !== 'FBX') fields.delete('fbx_preset');
    }
    return [...fields];
  }
  function imageRoles(model, data = {}) {
    const p = profile(model);
    if (p.group === 'generate') return p.mode === 'text' || p.mode === 'multiview' && value(data, 'input_mode') === 'multiviewTaskId'
      ? [] : Array(p.mode === 'multiview' ? 4 : 1).fill(null);
    if (p.group === 'splat') return [null];
    if (p.group === 'texture') return value(data, 'texture_prompt_mode') === 'text' ? ['style_image_url']
      : value(data, 'texture_prompt_mode') === 'image' ? ['texture_image_url'] : contract.views.map(v => `texture_${v}_image_url`);
    if (model.endsWith('segment-v2')) return ['ref_image_url'];
    if (model.endsWith('smartsegment') && value(data, 'seg_type') === 'image') return ['image_url'];
    return [];
  }
  function partNames(input) {
    if (input == null || input === '' || Array.isArray(input) && input.length === 0) return [];
    let names = input;
    if (typeof names === 'string') {
      names = names.trim(); if (!names || names === 'null') return [];
      try { names = names.startsWith('[') ? JSON.parse(names) : names.split(','); } catch { fail('invalidParts', 'part_names'); }
    }
    if (!Array.isArray(names) || names.some(v => typeof v !== 'string')) fail('invalidParts', 'part_names');
    names = names.map(v => v.trim());
    if (names.some(v => !v || v.includes(',')) || new Set(names).size !== names.length || [...names.join(',')].length > 1024) fail('invalidParts', 'part_names');
    return names;
  }
  function faceRange(model, data = {}) {
    const p = profile(model);
    if (p.group === 'convert') return [500, 2000000];
    if (p.group !== 'generate') return [1, 2147483647];
    if (model.startsWith('tripo-p-p1')) return [50, 20000];
    if (model.startsWith('tripo-p-p2')) return [48, enabled(data, 'quad') ? 25000 : 50000];
    return [1, enabled(data, 'quad') ? 150000 : value(data, 'geometry_quality') === 'detailed' ? 2000000 : model.includes('v2.5') ? 500000 : model.includes('v3.0') ? 1000000 : 1500000];
  }
  const isLocalSource = s => typeof s === 'string' && /^\/(?:files\/|input\/|output\/|api\/resources\/file\/|api\/project-assets\/)/.test(s);
  function url(input, field) {
    if (isLocalSource(input)) return input;
    try { const u = new URL(input); if (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !/\s/.test(input)) return input; } catch {}
    fail('invalidUrl', field);
  }
  function build(request) {
    const p = profile(request.model), data = request.metadata ?? {}, refs = request.images ?? [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('invalidValue', 'metadata');
    if (!Array.isArray(refs) || refs.some(s => typeof s !== 'string' || !s.trim())) fail('imageCount', 'images');
    const fields = activeFields(request.model, data, refs.length), active = new Set(fields), roles = imageRoles(request.model, data);
    for (const field of Object.keys(data)) if (!active.has(field) || field === 'prompt') fail('unsupportedField', field);
    if (refs.length > roles.length) fail('imageCount', 'images');
    const metadata = {}, payload = { model: request.model }, bindings = [];
    for (const field of fields) {
      const spec = contract.fields[field]; let v = field === 'prompt' ? request.prompt : value(data, field);
      if (field === 'compress' && v === false) continue;
      if (field === 'compress' && typeof v === 'string') v = v.toLowerCase();
      if (field === 'part_names') { v = partNames(v); if (v.length) metadata[field] = v; continue; }
      if (v == null || v === '' || v === 'api_default') continue;
      if (contract.booleanFields.includes(field) && typeof v === 'boolean') v = String(v);
      if (spec.type === 'enum' && !spec.options.includes(v)) fail('invalidOption', field);
      if (spec.type === 'text' && typeof v !== 'string') fail('invalidValue', field);
      if (['integer', 'number'].includes(spec.type) && (typeof v !== 'number' || !Number.isFinite(v) || spec.type === 'integer' && !Number.isSafeInteger(v) || v < spec.min || v > spec.max)) fail('invalidValue', field);
      if (typeof v === 'string') v = v.trim();
      if (field === 'prompt') { payload.prompt = v; continue; }
      if (field.endsWith('_seed') && v === -1 || ['face_limit', 'texture_size'].includes(field) && v === 0) continue;
      metadata[field] = contract.booleanFields.includes(field) ? v === 'true' : v;
      if (field.endsWith('_url')) {
        url(v, field);
        if (field !== 'model_url' || isLocalSource(v)) bindings.push({ source: v, field, kind: field === 'model_url' ? 'model3d' : 'image' });
      }
    }
    if (p.mode === 'text' && (!payload.prompt || [...payload.prompt].length > 1024)) fail('promptLength', 'prompt');
    if ([...(metadata.negative_prompt || '')].length > 255) fail('invalidValue', 'negative_prompt');
    if (metadata.face_limit !== undefined) { const [min, max] = faceRange(request.model, data); if (metadata.face_limit < min || metadata.face_limit > max) fail('faceLimit', 'face_limit'); }
    if (metadata.texture_size !== undefined && metadata.texture_size < 256) fail('invalidValue', 'texture_size');
    if (enabled(data, 'generate_parts') && (enabled(data, 'texture', true) || enabled(data, 'pbr', true) || enabled(data, 'quad'))) fail('partsConflict', 'generate_parts');
    if (metadata.transform !== undefined) { const m = metadata.transform.split(',').map(s => s.trim()); if (m.length !== 16 || m.some(v => v === '' || !Number.isFinite(Number(v)))) fail('invalidValue', 'transform'); }
    for (const field of ['model_url', 'tripo_segment_task_id']) if (active.has(field) && !metadata[field]) fail('required', field);
    if (p.group === 'retopology' && request.model.endsWith('v1') && !metadata.face_limit) fail('required', 'face_limit');
    if (active.has('multiview_task_id') && !metadata.multiview_task_id) fail('required', 'multiview_task_id');
    if (p.group === 'texture' && value(data, 'texture_prompt_mode') === 'text' && !metadata.texture_prompt_text) fail('required', 'texture_prompt_text');
    if (p.group === 'generate' && roles.length && (p.mode === 'multiview' ? refs.length < 2 : refs.length !== 1) || p.group === 'splat' && refs.length !== 1) fail('imageCount', 'images');
    for (const [index, field] of roles.entries()) {
      const source = refs[index];
      if (source && field && metadata[field]) fail('duplicateImage', field);
      if (source) {
        bindings.push({ source, field, index, kind: 'image' });
        if (field) metadata[field] = source;
      }
      if (!source && field && !metadata[field] && (p.group === 'texture' && value(data, 'texture_prompt_mode') !== 'text' || request.model.endsWith('smartsegment'))) fail('required', field);
    }
    if (refs.length && roles[0] === null) payload.images = [...refs];
    if (Object.keys(metadata).length) payload.metadata = metadata;
    return { payload, bindings, model: request.model, taskType: p.group === 'generate' ? p.mode === 'text' ? 't3d' : 'i3d' : p.group };
  }
  return { models, fields: contract.fields, profile, isModel: model => models.includes(model), activeFields, imageRoles, partNames, faceRange, isLocalSource, build };
}
