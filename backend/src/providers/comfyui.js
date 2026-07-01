const fs = require('fs');
const path = require('path');
const {
  mimeFromPath,
  resolveMediaRef,
} = require('./mediaResolver');
const { isAllowedComfyuiUrl } = require('./comfyuiAccess');

const DEFAULT_TIMEOUT_MS = 5000;
const GENERATION_TIMEOUT_MS = 60 * 60 * 1000;
const SUCCESS_STATUSES = new Set(['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'DONE', 'OK']);
const FAILURE_STATUSES = new Set(['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED']);

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '') || 'http://127.0.0.1:8188';
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || fetch;
  const { fetchImpl: _fetchImpl, timeoutMs: _timeoutMs, ...fetchOptions } = options;
  void _fetchImpl;
  void _timeoutMs;
  try {
    return await fetchImpl(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseSize(value) {
  const match = String(value || '').match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
  if (!match) return { width: 1024, height: 1024 };
  return {
    width: Math.max(64, Number(match[1])),
    height: Math.max(64, Number(match[2])),
  };
}

function responseJson(res) {
  return res.text().then((text) => {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  });
}

function safeJsonText(value, max = 3000) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

function collectComfyErrorText(raw, fallback = '') {
  const parts = [];
  const push = (value) => {
    const text = safeJsonText(value, 1200).trim();
    if (text) parts.push(text);
  };
  push(fallback);
  push(raw?.error);
  push(raw?.message);
  push(raw?.detail);
  push(raw?.details);
  const nodeErrors = raw?.node_errors || raw?.nodeErrors || raw?.data?.node_errors;
  if (nodeErrors && typeof nodeErrors === 'object') {
    for (const [nodeId, info] of Object.entries(nodeErrors)) {
      push(`node #${nodeId}`);
      push(info?.class_type || info?.classType);
      push(info?.message);
      push(info?.errors);
      push(info?.details);
    }
  }
  if (!parts.length) push(raw);
  return parts.join('\n').slice(0, 4000);
}

function firstComfyNodeError(raw) {
  const nodeErrors = raw?.node_errors || raw?.nodeErrors || raw?.data?.node_errors;
  if (!nodeErrors || typeof nodeErrors !== 'object') return '';
  for (const [nodeId, info] of Object.entries(nodeErrors)) {
    const classType = String(info?.class_type || info?.classType || '').trim();
    const errors = Array.isArray(info?.errors) ? info.errors : [];
    const error = errors[0] || {};
    const text = [
      `#${nodeId}`,
      classType,
      error?.message,
      error?.details,
      info?.message,
      info?.details,
    ].filter(Boolean).join(' · ');
    if (text) return text.slice(0, 360);
  }
  return '';
}

function classifyComfyUiError(raw, fallback = 'ComfyUI 调用失败。') {
  const text = collectComfyErrorText(raw, fallback);
  const low = text.toLowerCase();
  const detail = firstComfyNodeError(raw) || safeJsonText(raw?.error || raw?.message || fallback, 360);
  const withDetail = (message) => (detail ? `${message}（${detail}）` : message);

  if (/aborterror|timeout|timed out|超时/.test(low)) {
    return {
      code: 'timeout',
      error: withDetail('ComfyUI 响应超时。请确认目标 ComfyUI 没有卡在加载模型，或稍后在队列空闲时重试。'),
    };
  }
  if (/econnrefused|failed to fetch|fetch failed|network|connect|connection refused|不在线|无法连接/.test(low)) {
    return {
      code: 'comfyui_offline',
      error: withDetail('没有连上 ComfyUI。请确认 ComfyUI 已启动，并且当前后端环境允许访问该地址。'),
    };
  }
  if (/class_type.*(does not exist|missing|not found)|node type.*not found|custom node|no module named|import failed|cannot import|was not found/.test(low)) {
    return {
      code: 'missing_custom_node',
      error: withDetail('ComfyUI 缺少这个 workflow 需要的自定义节点。请在 ComfyUI Manager 安装对应节点包，重启 ComfyUI 后再运行。'),
    };
  }
  if (/(ckpt_name|checkpoint|model_name|lora_name|vae_name|clip_name|control_net_name|unet_name).*(not in list|not found|does not exist|missing|no such file)|value not in list|not in list.*(safetensors|ckpt|vae|lora|clip)|model.*(not found|does not exist|missing)/.test(low)) {
    return {
      code: 'missing_model',
      error: withDetail('ComfyUI 缺少模型或模型名不匹配。请把 Checkpoint / LoRA / VAE / CLIP 等参数改成目标 ComfyUI 已安装的文件名。'),
    };
  }
  if (/invalid prompt|prompt outputs failed validation|node_errors|validation/.test(low)) {
    return {
      code: 'invalid_workflow',
      error: withDetail('ComfyUI 工作流校验失败。请检查导入的是 API Workflow，并确认参数映射没有写到错误节点。'),
    };
  }
  return {
    code: 'comfyui_failed',
    error: withDetail(fallback || 'ComfyUI 调用失败。'),
  };
}

function cloneWorkflow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function workflowList(provider) {
  return Array.isArray(provider?.comfyuiConfig?.workflows) ? provider.comfyuiConfig.workflows : [];
}

function findWorkflow(provider, input = {}) {
  const requested = String(input.providerModel || input.model || '').trim();
  const workflows = workflowList(provider);
  if (!workflows.length) return null;
  if (requested) {
    const exact = workflows.find((item) => item?.id === requested || item?.name === requested);
    if (exact) return exact;
  }
  return workflows[0];
}

function extensionForMime(mime) {
  const text = String(mime || '').toLowerCase();
  if (text.includes('jpeg') || text.includes('jpg')) return '.jpg';
  if (text.includes('webp')) return '.webp';
  if (text.includes('gif')) return '.gif';
  if (text.includes('bmp')) return '.bmp';
  if (text.includes('avif')) return '.avif';
  return '.png';
}

function imageRefForSource(source, input) {
  const key = String(source || '').trim().toLowerCase();
  const match = key.match(/^image(?:_|-)?(\d+)$/);
  if (!match) return '';
  const index = Math.max(0, Number(match[1]) - 1);
  const images = Array.isArray(input.images) ? input.images : [];
  return String(images[index] || '').trim();
}

function mediaRefForSource(source, input, kind) {
  const key = String(source || '').trim().toLowerCase();
  const match = key.match(new RegExp(`^${kind}(?:_|-)?(\\d+)$`));
  if (!match) return '';
  const index = Math.max(0, Number(match[1]) - 1);
  const values = Array.isArray(input[`${kind}s`]) ? input[`${kind}s`] : [];
  return String(values[index] || '').trim();
}

function inputOrProviderParam(input, ...keys) {
  const providerParams = input?.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key)) return input[key];
    if (Object.prototype.hasOwnProperty.call(providerParams, key)) return providerParams[key];
  }
  return undefined;
}

function hasRuntimeTextValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

async function uploadImageToComfy(baseUrl, imageRef, options = {}) {
  if (!imageRef) return '';
  let buffer = null;
  let filename = '';
  let mime = 'image/png';
  const mediaBaseUrl = options.mediaBaseUrl || options.t8BaseUrl;

  try {
    const local = await resolveMediaRef(imageRef, { target: 'local-path', baseUrl: mediaBaseUrl });
    buffer = fs.readFileSync(local.path);
    filename = path.basename(local.path);
    mime = local.mime || mimeFromPath(local.path, mime);
  } catch {
    const resolved = await resolveMediaRef(imageRef, { target: 'url', baseUrl: mediaBaseUrl });
    const res = await fetchWithTimeout(resolved.url, {
      method: 'GET',
      timeoutMs: options.timeoutMs || 30000,
      fetchImpl: options.fetchImpl,
    });
    if (!res.ok) throw new Error(`ComfyUI 参考图下载失败：HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    mime = res.headers?.get?.('content-type') || mime;
    filename = `t8-comfy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMime(mime)}`;
  }

  const form = new FormData();
  form.append('image', new Blob([buffer], { type: mime }), filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');

  const uploadRes = await fetchWithTimeout(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: form,
    timeoutMs: options.timeoutMs || 30000,
    fetchImpl: options.fetchImpl,
  });
  const raw = await responseJson(uploadRes);
  if (!uploadRes.ok) throw new Error(`ComfyUI 上传参考图失败：HTTP ${uploadRes.status}`);
  return String(raw?.name || raw?.filename || raw?.image || filename).trim();
}

async function sourceValue(source, input, size, context = {}) {
  const key = String(source || '').trim();
  const imageRef = imageRefForSource(key, input);
  if (imageRef) return uploadImageToComfy(context.comfyBaseUrl || context.baseUrl, imageRef, context);
  const videoRef = mediaRefForSource(key, input, 'video');
  if (videoRef) return videoRef;
  const audioRef = mediaRefForSource(key, input, 'audio');
  if (audioRef) return audioRef;
  if (key === 'prompt' || key === 'positive') {
    const prompt = inputOrProviderParam(input, 'prompt', 'positive');
    return hasRuntimeTextValue(prompt) ? String(prompt) : undefined;
  }
  if (key === 'negative') {
    const negative = inputOrProviderParam(input, 'negativePrompt', 'negative');
    return hasRuntimeTextValue(negative) ? String(negative) : undefined;
  }
  if (key === 'width') return size.width;
  if (key === 'height') return size.height;
  if (key === 'batch_size') {
    if (input.providerParams && Object.prototype.hasOwnProperty.call(input.providerParams, key)) return Number(input.providerParams[key]);
    return Object.prototype.hasOwnProperty.call(input, key) ? Number(input[key]) : undefined;
  }
  if (key === 'seed') {
    if (input.providerParams && Object.prototype.hasOwnProperty.call(input.providerParams, key)) {
      const providerSeed = Number(input.providerParams[key]);
      if (Number.isFinite(providerSeed)) return providerSeed;
    }
    return Number.isFinite(Number(input.seed)) ? Number(input.seed) : Math.floor(Math.random() * 2147483647);
  }
  if (['steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'model_name', 'ckpt_name', 'clip_name', 'vae_name', 'lora_name', 'unet_name', 'control_net_name', 'clip_vision_name', 'style_model_name', 'upscale_model', 'strength_model', 'strength_clip', 'start_at_step', 'end_at_step', 'guidance', 'shift', 'fps', 'frame_rate', 'num_frames', 'duration', 'strength', 'weight', 'control_after_generate', 'add_noise'].includes(key)) {
    if (input.providerParams && Object.prototype.hasOwnProperty.call(input.providerParams, key)) return input.providerParams[key];
    return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined;
  }
  if (key && Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  return input.providerParams && Object.prototype.hasOwnProperty.call(input.providerParams, key) ? input.providerParams[key] : undefined;
}

function normalizeWorkflowInputKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function hasWorkflowField(inputs, key) {
  return Object.prototype.hasOwnProperty.call(inputs || {}, key);
}

function isLinkedWorkflowInput(value) {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 3
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && (value.length === 1 || typeof value[1] === 'number' || typeof value[1] === 'string');
}

function isPrimitiveWorkflowValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['value', 'default', 'selected', 'current']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const next = value[key];
        return next === null || ['string', 'number', 'boolean'].includes(typeof next);
      }
    }
  }
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function workflowNodeText(node) {
  return `${node?._meta?.title || ''} ${node?.title || ''} ${node?.class_type || ''}`.toLowerCase();
}

function isOutputPathWorkflowField(fieldName) {
  const key = normalizeWorkflowInputKey(fieldName);
  return /^(filename|file_name|filename_prefix|prefix|save_path|output_path|output_dir|folder|subfolder)$/.test(key);
}

function isNegativeWorkflowField(fieldName, node) {
  return /(^|_)(negative|neg|uncond|反向|负向|不要|排除)(_|$)/i.test(fieldName)
    || /negative|neg|反向|负向|不要|排除/i.test(workflowNodeText(node));
}

function isTextWorkflowField(fieldName, node) {
  if (isOutputPathWorkflowField(fieldName)) return false;
  const key = normalizeWorkflowInputKey(fieldName);
  if (/^(prompt|positive|positive_prompt|negative|negative_prompt|caption|instruction|description|subject|style|wildcard|conditioning_text)$/.test(key)) return true;
  const nodeLooksPromptDriven = /prompt|textencode|caption|wildcard|llm|chat|conditioning|encode|positive|negative/i.test(workflowNodeText(node));
  if (/^(text|string|value)$/.test(key)) return nodeLooksPromptDriven;
  if (/(^|_)(prompt|caption|instruction|description)(_|$)/.test(key)) return true;
  if (/(^|_)(text|string)(_|$)/.test(key)) return nodeLooksPromptDriven;
  return nodeLooksPromptDriven && ['text', 'prompt', 'value'].includes(key);
}

function nodeLooksImageWorkflowInputDriven(node) {
  return /(loadimage|imageinput|image\s*input|input\s*image|mask|controlnet|ipadapter|openpose|depth|lineart|reference|inpaint|outpaint|canny|hed|scribble|softedge|pose|segmentation|segment|segment\s*anything|\bsam\b|sam2|vision)/i.test(workflowNodeText(node));
}

function nodeLooksVideoWorkflowInputDriven(node) {
  return /(loadvideo|videoinput|video\s*input|input\s*video|vhs|wanvideo|ltxv|svd|animatediff|video\s*reference|reference\s*video)/i.test(workflowNodeText(node));
}

function nodeLooksAudioWorkflowInputDriven(node) {
  return /(loadaudio|audioinput|audio\s*input|input\s*audio|tts|stt|voice|sound|music|speech|wav|audio\s*reference|reference\s*audio)/i.test(workflowNodeText(node));
}

function isImageWorkflowField(fieldName, node) {
  const key = normalizeWorkflowInputKey(fieldName);
  const fieldLooksMedia = /^(image|img|mask|control_image|reference_image|ref_image|source_image|input_image|init_image|start_image|end_image|face_image|person_image|pose_image|depth_image|normal_image|lineart_image|image_path|mask_image)$/.test(key)
    || /(^|_)(image|img|mask)(_|$)/.test(key)
    || ['image', 'img', 'mask', 'path', 'file'].includes(key);
  return fieldLooksMedia && nodeLooksImageWorkflowInputDriven(node);
}

function isVideoWorkflowField(fieldName, node) {
  const key = normalizeWorkflowInputKey(fieldName);
  const fieldLooksMedia = /^(video|video_path|input_video|source_video|reference_video|init_video|frames_video)$/.test(key)
    || /(^|_)(video|movie|frames)(_|$)/.test(key)
    || ['video', 'path', 'file'].includes(key);
  return fieldLooksMedia && nodeLooksVideoWorkflowInputDriven(node);
}

function isAudioWorkflowField(fieldName, node) {
  const key = normalizeWorkflowInputKey(fieldName);
  const fieldLooksMedia = /^(audio|audio_path|input_audio|source_audio|reference_audio|voice|sound|music|speech|wav)$/.test(key)
    || /(^|_)(audio|voice|sound|music|speech|wav)(_|$)/.test(key)
    || ['audio', 'path', 'file', 'voice'].includes(key);
  return fieldLooksMedia && nodeLooksAudioWorkflowInputDriven(node);
}

const DIRECT_WORKFLOW_SOURCE_FIELDS = new Set([
  'width',
  'height',
  'batch_size',
  'seed',
  'steps',
  'cfg',
  'sampler_name',
  'scheduler',
  'denoise',
  'model_name',
  'ckpt_name',
  'clip_name',
  'vae_name',
  'lora_name',
  'unet_name',
  'control_net_name',
  'clip_vision_name',
  'style_model_name',
  'upscale_model',
  'strength_model',
  'strength_clip',
  'start_at_step',
  'end_at_step',
  'guidance',
  'shift',
  'fps',
  'frame_rate',
  'num_frames',
  'duration',
  'strength',
  'weight',
  'control_after_generate',
  'add_noise',
]);

function directWorkflowSourceForField(fieldName) {
  const key = normalizeWorkflowInputKey(fieldName);
  if (key === 'noise_seed') return 'seed';
  if (key === 'positive_prompt') return 'prompt';
  if (key === 'negative_prompt') return 'negative';
  if (DIRECT_WORKFLOW_SOURCE_FIELDS.has(key)) return key;
  if (/(^|_)(model_name|ckpt_name|clip_name|vae_name|lora_name|unet_name|control_net_name|clip_vision_name|style_model_name|upscale_model)(_|$)/.test(key)) return key;
  return '';
}

function shouldSkipGenericWorkflowField(fieldName, value) {
  if (isLinkedWorkflowInput(value)) return true;
  if (!isPrimitiveWorkflowValue(value)) return true;
  const key = normalizeWorkflowInputKey(fieldName);
  if (isOutputPathWorkflowField(key)) return true;
  return /^(model|clip|vae|positive|negative|latent|latent_image|samples|images|conditioning|control_net)$/.test(key);
}

function isOutputWorkflowNode(classType) {
  const low = String(classType || '').toLowerCase();
  return /(save|preview|output|export).*(image|video|audio|text|string)|(image|video|audio|text|string).*(save|preview|output|export)/.test(low);
}

function isDisplayOnlyWorkflowNode(node) {
  const text = workflowNodeText(node);
  if (/(show\s*anything|showanything|展示任何|展示|viewer|display|inspect|debug|logger|console|watch|note|result)/i.test(text)) {
    return !/(prompt|textencode|caption|wildcard|llm|chat|input|loadimage|loadvideo|loadaudio|sampler|generate|generator)/i.test(text);
  }
  return false;
}

function inferWorkflowFields(prompt) {
  const fields = [];
  let promptSeen = false;
  let imageIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;
  const seen = new Set();
  const clipTextRoles = new Map();
  for (const [, node] of Object.entries(prompt || {})) {
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
    const positive = Array.isArray(node.inputs.positive) ? String(node.inputs.positive[0] || '').trim() : '';
    const negative = Array.isArray(node.inputs.negative) ? String(node.inputs.negative[0] || '').trim() : '';
    if (positive) clipTextRoles.set(positive, 'prompt');
    if (negative) clipTextRoles.set(negative, 'negative');
  }
  const push = (nodeId, fieldName, source) => {
    const key = `${nodeId}::${fieldName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    fields.push({ nodeId, fieldName, source });
    return true;
  };
  for (const [nodeId, node] of Object.entries(prompt || {})) {
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
    const classType = String(node.class_type || '').toLowerCase();
    const title = workflowNodeText(node);
    const inputs = node.inputs;
    const inputKeys = Object.keys(inputs);
    const skipGenericInputs = isDisplayOnlyWorkflowNode(node) || isOutputWorkflowNode(classType);
    if (classType.includes('cliptextencode') && hasWorkflowField(inputs, 'text')) {
      const role = clipTextRoles.get(String(nodeId));
      const isNegative = role ? role === 'negative' : (/negative|neg|反向|负向|不要|排除/.test(title) || promptSeen);
      push(nodeId, 'text', isNegative ? 'negative' : 'prompt');
      if (!isNegative) promptSeen = true;
    }
    if ((classType.includes('loadimage') || classType.includes('imageinput')) && hasWorkflowField(inputs, 'image')) {
      imageIndex += 1;
      push(nodeId, 'image', `image${imageIndex}`);
    }
    if ((classType.includes('loadvideo') || classType.includes('videoinput') || classType.includes('vhs')) && hasWorkflowField(inputs, 'video')) {
      videoIndex += 1;
      push(nodeId, 'video', `video${videoIndex}`);
    }
    if ((classType.includes('loadaudio') || classType.includes('audioinput')) && hasWorkflowField(inputs, 'audio')) {
      audioIndex += 1;
      push(nodeId, 'audio', `audio${audioIndex}`);
    }
    if (classType.includes('emptylatent') || classType.includes('latentimage')) {
      if (hasWorkflowField(inputs, 'width')) push(nodeId, 'width', 'width');
      if (hasWorkflowField(inputs, 'height')) push(nodeId, 'height', 'height');
      if (hasWorkflowField(inputs, 'batch_size')) push(nodeId, 'batch_size', 'batch_size');
    }
    if (classType.includes('ksampler') || classType.includes('sampler')) {
      for (const key of ['seed', 'noise_seed']) {
        if (hasWorkflowField(inputs, key)) push(nodeId, key, 'seed');
      }
      for (const key of ['steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']) {
        if (hasWorkflowField(inputs, key)) push(nodeId, key, key);
      }
    }
    for (const key of ['model_name', 'ckpt_name', 'clip_name', 'vae_name', 'lora_name', 'unet_name', 'control_net_name', 'clip_vision_name', 'style_model_name', 'upscale_model', 'strength_model', 'strength_clip']) {
      if (hasWorkflowField(inputs, key)) push(nodeId, key, key);
    }
    for (const key of inputKeys) {
      if (skipGenericInputs) continue;
      if (seen.has(`${nodeId}::${key}`) || shouldSkipGenericWorkflowField(key, inputs[key])) continue;
      const directSource = directWorkflowSourceForField(key);
      if (directSource) {
        push(nodeId, key, directSource);
      } else if (isTextWorkflowField(key, node)) {
        const source = isNegativeWorkflowField(key, node) ? 'negative' : 'prompt';
        push(nodeId, key, source);
        if (source === 'prompt') promptSeen = true;
      } else if (isImageWorkflowField(key, node)) {
        imageIndex += 1;
        push(nodeId, key, `image${imageIndex}`);
      } else if (isVideoWorkflowField(key, node)) {
        videoIndex += 1;
        push(nodeId, key, `video${videoIndex}`);
      } else if (isAudioWorkflowField(key, node)) {
        audioIndex += 1;
        push(nodeId, key, `audio${audioIndex}`);
      } else {
        push(nodeId, key, normalizeWorkflowInputKey(key));
      }
    }
  }
  return fields;
}

function compactWorkflowFields(fields) {
  const out = [];
  const seen = new Set();
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!field || typeof field !== 'object') continue;
    const nodeId = String(field.nodeId || field.node || '').trim();
    const fieldName = String(field.fieldName || field.input || field.name || '').trim();
    if (!nodeId || !fieldName) continue;
    const key = `${nodeId}::${fieldName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hasValue = Object.prototype.hasOwnProperty.call(field, 'value');
    const rawSource = String(field.source || '').trim();
    const source = rawSource || (hasValue ? 'fixed' : fieldName);
    const next = { nodeId, fieldName, source };
    if (source === 'fixed' && hasValue) next.value = field.value;
    out.push(next);
  }
  return out;
}

function clipTextRoleMap(prompt) {
  const roles = new Map();
  for (const [, node] of Object.entries(prompt || {})) {
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
    const positive = Array.isArray(node.inputs.positive) ? String(node.inputs.positive[0] || '').trim() : '';
    const negative = Array.isArray(node.inputs.negative) ? String(node.inputs.negative[0] || '').trim() : '';
    if (positive) roles.set(positive, 'prompt');
    if (negative) roles.set(negative, 'negative');
  }
  return roles;
}

function isPromptLikeSource(source, fieldName) {
  return ['prompt', 'positive', 'negative', 'text'].includes(source) || source === fieldName;
}

function canonicalizeWorkflowFields(prompt, fields) {
  const compacted = compactWorkflowFields(fields);
  const sourceFields = compacted.length ? compacted : inferWorkflowFields(prompt);
  const roles = clipTextRoleMap(prompt);
  const out = [];
  const seen = new Set();
  let hasPromptField = false;
  let correctedPromptToNegative = false;
  for (const field of sourceFields) {
    const nodeId = String(field.nodeId || '').trim();
    const fieldName = String(field.fieldName || '').trim();
    if (!nodeId || !fieldName) continue;
    const next = { ...field, nodeId, fieldName };
    const node = prompt?.[nodeId];
    const classType = String(node?.class_type || '').toLowerCase();
    const role = roles.get(nodeId);
    const source = String(next.source || fieldName || '').trim();
    if (role && classType.includes('cliptextencode') && fieldName === 'text' && isPromptLikeSource(source, fieldName)) {
      next.source = role === 'prompt' ? 'prompt' : 'negative';
      if (role === 'negative' && ['prompt', 'positive', 'text'].includes(source)) correctedPromptToNegative = true;
    }
    const key = `${next.nodeId}::${next.fieldName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (next.source === 'prompt' || next.source === 'positive') hasPromptField = true;
    out.push(next);
  }
  if (!hasPromptField && (!compacted.length || correctedPromptToNegative)) {
    const detectedPrompt = inferWorkflowFields(prompt).find((field) => (
      (field.source === 'prompt' || field.source === 'positive') &&
      !seen.has(`${field.nodeId}::${field.fieldName}`)
    ));
    if (detectedPrompt) out.push(detectedPrompt);
  }
  return out;
}

function parseExcludeRules(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;，；]+/);
  const out = [];
  for (const raw of rawItems) {
    const item = String(raw || '').trim();
    if (!item || out.includes(item)) continue;
    out.push(item.slice(0, 120));
  }
  return out.slice(0, 200);
}

function shouldExcludeWorkflowField(prompt, field, rules) {
  const excludeRules = parseExcludeRules(rules);
  if (!excludeRules.length || !field) return false;
  const nodeId = String(field.nodeId || '').trim();
  const fieldName = String(field.fieldName || '').trim();
  const source = String(field.source || fieldName || '').trim();
  const node = prompt?.[nodeId] || {};
  const classType = String(node.class_type || '').trim();
  const title = String(node?._meta?.title || node?.title || classType || '').trim();
  const normalize = (value) => String(value || '').trim().toLowerCase();
  const exactTokens = new Set([
    normalize(source),
    normalize(fieldName),
    normalize(nodeId),
    normalize(`#${nodeId}`),
    normalize(`${nodeId}.${fieldName}`),
    normalize(`#${nodeId}.${fieldName}`),
    normalize(`${classType}.${fieldName}`),
    normalize(`${classType}.${source}`),
    normalize(title),
    normalize(classType),
  ].filter(Boolean));
  const searchable = [
    nodeId,
    `#${nodeId}`,
    fieldName,
    source,
    classType,
    title,
    `${nodeId}.${fieldName}`,
    `#${nodeId}.${fieldName}`,
    `${classType}.${fieldName}`,
    `${classType}.${source}`,
  ].filter(Boolean).join(' ').toLowerCase();
  for (const rawRule of excludeRules) {
    const rule = normalize(rawRule);
    if (!rule) continue;
    const prefixed = rule.match(/^(source|field|class|node|title)\s*:\s*(.+)$/);
    if (prefixed) {
      const [, kind, value] = prefixed;
      const target = normalize(value);
      if (kind === 'source' && normalize(source) === target) return true;
      if (kind === 'field' && normalize(fieldName) === target) return true;
      if (kind === 'class' && normalize(classType).includes(target)) return true;
      if (kind === 'node' && (normalize(nodeId) === target || normalize(`#${nodeId}`) === target)) return true;
      if (kind === 'title' && normalize(title).includes(target)) return true;
      continue;
    }
    if (exactTokens.has(rule) || searchable.includes(rule)) return true;
  }
  return false;
}

function filterWorkflowFields(prompt, fields, rules) {
  const excludeRules = parseExcludeRules(rules);
  const sourceFields = Array.isArray(fields) ? fields : [];
  if (!excludeRules.length) return sourceFields;
  return sourceFields.filter((field) => !shouldExcludeWorkflowField(prompt, field, excludeRules));
}

async function patchByFields(prompt, fields, input, size, context = {}) {
  if (!Array.isArray(fields)) return;
  for (const field of fields) {
    if (!field || typeof field !== 'object') continue;
    const nodeId = String(field.nodeId || field.node || '').trim();
    const fieldName = String(field.fieldName || field.input || field.name || '').trim();
    if (!nodeId || !fieldName || !prompt[nodeId]?.inputs) continue;
    const source = String(field.source || '').trim();
    const hasFixedValue = Object.prototype.hasOwnProperty.call(field, 'value') && field.value !== undefined;
    const useFixedValue = source === 'fixed' || (!source && hasFixedValue);
    const value = useFixedValue ? field.value : await sourceValue(source || fieldName, input, size, context);
    if (value !== undefined) prompt[nodeId].inputs[fieldName] = value;
  }
}

function patchByHeuristics(prompt, input, size, skips = {}) {
  let promptPatched = false;
  const providerParams = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  const seedCandidate = Object.prototype.hasOwnProperty.call(providerParams, 'seed') ? providerParams.seed : input.seed;
  const seedValue = Number(seedCandidate);
  const roles = clipTextRoleMap(prompt);
  let fallbackPromptNode = null;
  for (const [nodeId, node] of Object.entries(prompt || {})) {
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
    const classType = String(node.class_type || '').toLowerCase();
    if (!classType.includes('cliptextencode') || typeof node.inputs.text === 'undefined') continue;
    const role = roles.get(String(nodeId));
    if (role === 'prompt') {
      fallbackPromptNode = node;
      break;
    }
    if (!role && !fallbackPromptNode) fallbackPromptNode = node;
  }
  for (const node of Object.values(prompt)) {
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
    const classType = String(node.class_type || '').toLowerCase();
    if (!skips.text && !promptPatched && node === fallbackPromptNode && classType.includes('cliptextencode') && typeof node.inputs.text !== 'undefined') {
      node.inputs.text = String(input.prompt || '');
      promptPatched = true;
    }
    for (const key of Object.keys(node.inputs)) {
      const low = key.toLowerCase();
      if (!skips.width && low === 'width') node.inputs[key] = size.width;
      if (!skips.height && low === 'height') node.inputs[key] = size.height;
      if (!skips.seed && (low === 'seed' || low === 'noise_seed') && Number.isFinite(seedValue)) node.inputs[key] = seedValue;
    }
  }
}

async function patchWorkflow(workflow, input = {}, context = {}) {
  const prompt = cloneWorkflow(workflow?.workflowJson || workflow?.workflow || workflow?.raw || workflow);
  if (!prompt) return null;
  const size = parseSize(input.size || `${input.width || 1024}x${input.height || 1024}`);
  const baseFields = Array.isArray(workflow?.fields) && workflow.fields.length ? workflow.fields : inferWorkflowFields(prompt);
  const canonicalFields = canonicalizeWorkflowFields(prompt, baseFields);
  const fields = filterWorkflowFields(prompt, canonicalFields, workflow?.excludeRules);
  await patchByFields(prompt, fields, input, size, context);
  const mapped = (fieldName, sources = []) => fields.some((field) => {
    const name = String(field?.fieldName || field?.input || field?.name || '').trim();
    const source = String(field?.source || '').trim();
    return name === fieldName || sources.includes(source);
  });
  const blockedByMappingOrExclude = (fieldName, sources = []) => canonicalFields.some((field) => {
    const name = String(field?.fieldName || field?.input || field?.name || '').trim();
    const source = String(field?.source || '').trim();
    return name === fieldName || sources.includes(source);
  });
  patchByHeuristics(prompt, input, size, {
    text: mapped('text', ['prompt', 'positive', 'negative']) || blockedByMappingOrExclude('text', ['prompt', 'positive', 'negative']),
    width: mapped('width', ['width']) || blockedByMappingOrExclude('width', ['width']),
    height: mapped('height', ['height']) || blockedByMappingOrExclude('height', ['height']),
    seed: mapped('seed', ['seed']) || mapped('noise_seed', ['seed']) || blockedByMappingOrExclude('seed', ['seed']) || blockedByMappingOrExclude('noise_seed', ['seed']),
  });
  return prompt;
}

function viewUrl(baseUrl, item, defaultType = 'output') {
  const filename = String(item?.filename || item?.file || item?.name || '').trim();
  if (!filename) return '';
  const type = String(item?.type || defaultType || 'output').trim();
  const subfolder = String(item?.subfolder || '').trim();
  return `${baseUrl}/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}&subfolder=${encodeURIComponent(subfolder)}`;
}

function collectComfyOutputs(raw, promptId, baseUrl) {
  const source = raw?.[promptId] || raw?.data?.[promptId] || raw?.data || raw;
  const outputs = source?.outputs || source?.output || {};
  const imageUrls = [];
  const videoUrls = [];
  const audioUrls = [];
  const texts = [];
  for (const output of Object.values(outputs || {})) {
    if (!output || typeof output !== 'object') continue;
    for (const item of Array.isArray(output.images) ? output.images : []) {
      const url = viewUrl(baseUrl, item, 'output');
      if (url && !imageUrls.includes(url)) imageUrls.push(url);
    }
    for (const item of Array.isArray(output.videos) ? output.videos : []) {
      const url = viewUrl(baseUrl, item, 'output');
      if (url && !videoUrls.includes(url)) videoUrls.push(url);
    }
    for (const item of Array.isArray(output.audio) ? output.audio : []) {
      const url = viewUrl(baseUrl, item, 'output');
      if (url && !audioUrls.includes(url)) audioUrls.push(url);
    }
    for (const key of ['text', 'texts', 'string', 'strings']) {
      const value = output[key];
      if (typeof value === 'string') texts.push(value);
      if (Array.isArray(value)) texts.push(...value.filter((item) => typeof item === 'string'));
    }
  }
  return { imageUrls, videoUrls, audioUrls, text: texts.join('\n').trim() };
}

function extractPromptId(raw) {
  return String(raw?.prompt_id || raw?.promptId || raw?.id || raw?.data?.prompt_id || raw?.data?.id || '').trim();
}

function extractStatus(raw) {
  const value = raw?.status || raw?.data?.status || raw?.state || raw?.data?.state || '';
  if (typeof value === 'object') return String(value?.status_str || value?.status || '').trim().toUpperCase();
  return String(value || '').trim().toUpperCase();
}

async function pollHistory(baseUrl, promptId, options = {}) {
  const interval = Number(options.pollIntervalMs || 1000);
  const requestedMaxPoll = Math.max(1, Number(options.maxPoll || 600));
  const minMaxPoll = Math.ceil(GENERATION_TIMEOUT_MS / Math.max(1, interval));
  const maxPoll = Math.max(requestedMaxPoll, minMaxPoll);
  let lastRaw = null;
  for (let i = 0; i < maxPoll; i += 1) {
    if (i > 0 && interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
    const res = await fetchWithTimeout(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
      method: 'GET',
      timeoutMs: options.timeoutMs || 30000,
      fetchImpl: options.fetchImpl,
    });
    const raw = await responseJson(res);
    lastRaw = raw;
    if (!res.ok) throw new Error(`ComfyUI history 查询失败：HTTP ${res.status}`);
    const outputs = collectComfyOutputs(raw, promptId, baseUrl);
    if (outputs.imageUrls.length || outputs.videoUrls.length || outputs.audioUrls.length || outputs.text) {
      return { raw, ...outputs };
    }
    const status = extractStatus(raw);
    if (SUCCESS_STATUSES.has(status)) return { raw, ...outputs };
    if (FAILURE_STATUSES.has(status)) {
      const classified = classifyComfyUiError(raw, 'ComfyUI 工作流执行失败。');
      const error = new Error(classified.error);
      error.code = classified.code;
      error.raw = raw;
      throw error;
    }
  }
  throw new Error(`ComfyUI 工作流超时：${JSON.stringify(lastRaw || promptId).slice(0, 500)}`);
}

async function generateImage(provider, input = {}, options = {}) {
  const baseUrl = cleanBaseUrl(provider?.baseUrl || provider?.comfyuiConfig?.instances?.[0]);
  if (!isAllowedComfyuiUrl(baseUrl, { allowRemote: !!provider?.allowRemote })) {
    return {
      ok: false,
      code: 'non_local_comfyui',
      providerId: provider.id,
      protocol: 'comfyui',
      error: 'ComfyUI 默认只允许本机地址；如需接入其他地址，请在后端启用远端 ComfyUI 访问。',
    };
  }
  const workflow = findWorkflow(provider, input);
  if (!workflow) {
    return { ok: false, code: 'missing_workflow', providerId: provider.id, protocol: 'comfyui', error: '请先在扩展平台设置中保存 ComfyUI 工作流。' };
  }
  const prompt = await patchWorkflow(workflow, input, {
    ...options,
    comfyBaseUrl: baseUrl,
    mediaBaseUrl: options.baseUrl,
  });
  if (!prompt) {
    return { ok: false, code: 'invalid_workflow', providerId: provider.id, protocol: 'comfyui', error: 'ComfyUI 工作流 JSON 无效。' };
  }

  try {
    const res = await fetchWithTimeout(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: input.clientId || `t8-${Date.now()}` }),
      timeoutMs: options.timeoutMs || 30000,
      fetchImpl: options.fetchImpl,
    });
    const raw = await responseJson(res);
    if (!res.ok) {
      const classified = classifyComfyUiError(raw, `ComfyUI 提交失败：HTTP ${res.status}`);
      return { ok: false, code: classified.code, providerId: provider.id, protocol: 'comfyui', error: classified.error, raw };
    }
    const promptId = extractPromptId(raw);
    if (!promptId) {
      return { ok: false, code: 'missing_prompt_id', providerId: provider.id, protocol: 'comfyui', error: 'ComfyUI 未返回 prompt_id。', raw };
    }
    const polled = await pollHistory(baseUrl, promptId, options);
    if (!polled.imageUrls.length && !polled.videoUrls.length && !polled.audioUrls.length && !polled.text) {
      return { ok: false, code: 'empty_output', providerId: provider.id, protocol: 'comfyui', error: 'ComfyUI 工作流完成但没有返回输出。', raw: polled.raw };
    }
    return {
      ok: true,
      kind: polled.videoUrls.length ? 'video' : 'image',
      code: 'completed',
      providerId: provider.id,
      protocol: 'comfyui',
      model: workflow.id || workflow.name,
      taskId: promptId,
      imageUrls: polled.imageUrls,
      videoUrls: polled.videoUrls,
      audioUrls: polled.audioUrls,
      text: polled.text,
      raw: polled.raw,
    };
  } catch (e) {
    const classified = classifyComfyUiError(e?.raw || e, e?.message || 'ComfyUI 调用失败。');
    return { ok: false, code: e?.code || classified.code, providerId: provider.id, protocol: 'comfyui', error: classified.error };
  }
}

async function testProvider(provider, options = {}) {
  const baseUrl = cleanBaseUrl(provider?.baseUrl || provider?.comfyuiConfig?.instances?.[0]);
  if (!isAllowedComfyuiUrl(baseUrl, { allowRemote: !!provider?.allowRemote })) {
    return {
      ok: false,
      code: 'non_local_comfyui',
      providerId: provider.id,
      protocol: 'comfyui',
      error: 'ComfyUI 默认只允许本机地址；如需接入其他地址，请在后端启用远端 ComfyUI 访问。',
    };
  }

  if (options.dryRun) {
    return {
      ok: true,
      code: 'dry_run_ok',
      providerId: provider.id,
      protocol: 'comfyui',
      message: 'ComfyUI 地址格式可用，已跳过真实请求。',
    };
  }

  try {
    const res = await fetchWithTimeout(`${baseUrl}/queue`, {
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    if (!res.ok) {
      return {
        ok: false,
        code: 'http_error',
        providerId: provider.id,
        protocol: 'comfyui',
        error: `ComfyUI 队列接口不可用：HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      code: 'connected',
      providerId: provider.id,
      protocol: 'comfyui',
      message: 'ComfyUI 已连接。',
    };
  } catch (e) {
    const classified = classifyComfyUiError(e, e?.name === 'AbortError' ? 'ComfyUI 连接超时。' : (e?.message || 'ComfyUI 不在线。'));
    return {
      ok: false,
      code: classified.code === 'comfyui_failed' ? 'network_error' : classified.code,
      providerId: provider.id,
      protocol: 'comfyui',
      error: classified.error,
    };
  }
}

module.exports = {
  classifyComfyUiError,
  generateImage,
  testProvider,
};
