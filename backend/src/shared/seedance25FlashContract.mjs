export function createSeedance25FlashContract(contract) {
  const isFlash = model => contract.models.includes(model);
  const fail = message => { throw Object.assign(new Error(`Seedance 2.5: ${message}`), {status: 400}); };
  function validate(request) {
    const flash = isFlash(request.model), multi = request.model.endsWith('-multi');
    const images = [request.firstFrame, request.lastFrame, ...(request.refImages || [])].filter(Boolean);
    const videos = request.videos || [], audios = request.audios || [];
    if (flash) {
      for (const key of ['refImages','videos','audios']) if (request[key] !== undefined && (!Array.isArray(request[key]) || request[key].some(value => typeof value !== 'string' || !value.trim()))) fail('invalid references');
      if (request.draft === true) fail('Flash does not support draft mode');
      if (!contract.resolutions.includes(request.resolution || '720p')) fail('Flash resolution must be 480p/720p');
      if (request.model.endsWith('-i2v') && (request.ratio || 'adaptive') !== 'adaptive') fail('Flash I2V requires adaptive ratio');
      if (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < -1 || request.seed > 2147483647)) fail('invalid seed');
      if (multi && (images.length > 10 || videos.length > 5 || audios.length > 5)) fail('Flash references exceed 10 images / 5 videos / 5 audios');
    }
    const type = request.omni_reference_task_type ?? 'auto';
    if (!contract.taskTypes.includes(type) || !multi && type !== 'auto') fail('invalid reference task type');
    if (['edit', 'extend'].includes(type) && (!videos.length || (request.ratio || 'adaptive') !== 'adaptive')) fail('edit/extend requires a video and adaptive ratio');
    if (type === 'edit' && Number(request.duration) !== -1) fail('edit requires automatic duration (-1)');
    return type === 'auto' ? {} : {omni_reference_task_type: type};
  }
  return {isFlash, validate, contract};
}
