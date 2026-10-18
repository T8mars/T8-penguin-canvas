const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const settingsRouter = require('./settings');
const { normalizeAdvancedProviders, maskAdvancedProviders } = require('../providers/registry');
const { generateChatWithProvider } = require('../providers/adapters');
const { providerSubmissionContextMiddleware } = require('../services/providerSubmissionContext');
const {
  DEFAULT_PROVIDER_LLM_TIMEOUT_MS,
  normalizeProviderLlmTimeoutMs,
} = require('../providers/providerTimeoutPolicy');

const router = express.Router();
router.use(providerSubmissionContextMiddleware);

const DEFAULT_TIMEOUT_MS = DEFAULT_PROVIDER_LLM_TIMEOUT_MS;
const DEFAULT_ZHENZHEN_MODEL = 'gpt-4o-mini';
const MODELSCOPE_QWEN3_VL_235B = 'Qwen/Qwen3-VL-235B-A22B-Instruct';
const MODELSCOPE_QWEN3_TEXT_235B = 'Qwen/Qwen3-235B-A22B';
const SIDE_FORMATS = new Set(['txt', 'json']);
const IDEOGRAM_MEDIUM_ALIASES = new Map([
  ['photograph', 'photograph'],
  ['photo', 'photograph'],
  ['illustration', 'illustration'],
  ['3d render', '3d_render'],
  ['3d_render', '3d_render'],
  ['3d-render', '3d_render'],
  ['3drender', '3d_render'],
  ['render', '3d_render'],
  ['3d', '3d_render'],
  ['painting', 'painting'],
  ['graphic design', 'graphic_design'],
  ['graphic_design', 'graphic_design'],
  ['graphic-design', 'graphic_design'],
  ['graphic', 'graphic_design'],
]);
const IDEOGRAM_MEDIUM_OPTIONS = new Set(['photograph', 'illustration', '3d_render', 'painting', 'graphic_design']);
const DIRECT_OUTPUT_RULES = [
  'Only output the final caption/tag result. Do not include greetings, explanations, suggestions, follow-up questions, or markdown.',
  '不要包含任何开场白、反问、解释、建议或结束语；不要提出任何后续问题。',
];

function cleanText(value, maxLen = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function mediaKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return kind === 'video' ? 'video' : 'image';
}

function sidecarFormats(value) {
  const raw = Array.isArray(value) ? value : String(value || 'txt').split(/[,，\s]+/);
  const out = [];
  for (const item of raw) {
    const format = String(item || '').trim().toLowerCase();
    if (SIDE_FORMATS.has(format) && !out.includes(format)) out.push(format);
  }
  return out.length ? out : ['txt'];
}

function sanitizePathPart(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+$/, '')
    .slice(0, 160);
  return cleaned || fallback;
}

function splitSourceName(value) {
  const raw = String(value || 'batch-item').split(/[\\/]/).pop() || 'batch-item';
  const ext = path.extname(raw);
  return {
    base: ext ? raw.slice(0, -ext.length) : raw,
    ext,
  };
}

function buildSidecarNames(item = {}, formats = ['txt']) {
  const relative = String(item.relativePath || item.name || 'batch-item').replace(/\\/g, '/');
  const parts = relative.split('/').filter(Boolean);
  const fileName = parts.pop() || item.name || 'batch-item';
  const { base } = splitSourceName(fileName);
  const safeDirs = parts
    .filter((part) => part !== '.' && part !== '..')
    .map((part) => sanitizePathPart(part, 'folder'));
  const prefix = safeDirs.length ? `${safeDirs.join('/')}/` : '';
  const safeBase = sanitizePathPart(base, 'batch-item');
  return Object.fromEntries(
    sidecarFormats(formats).map((format) => [format, `${prefix}${safeBase}.${format}`]),
  );
}

function stripCodeFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json|JSON|txt|text)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractJsonObjectText(value) {
  const text = String(value || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function normalizeTags(value, maxTags = 200) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,，;；\n]/);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const tag = String(item || '').trim().replace(/\s+/g, ' ');
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= maxTags) break;
  }
  return out;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHexColor(value) {
  const color = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return `#${color.slice(1).toUpperCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color.slice(1).split('').map((ch) => ch + ch).join('').toUpperCase()}`;
  }
  return null;
}

function sanitizePalette(value, maxLen) {
  if (!Array.isArray(value)) return null;
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const color = normalizeHexColor(item);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    out.push(color);
    if (out.length >= maxLen) break;
  }
  return out.length ? out : null;
}

function canonicalIdeogramMedium(value) {
  if (typeof value !== 'string') return value;
  const key = value.trim().replace(/\.$/, '').trim().toLowerCase();
  return IDEOGRAM_MEDIUM_ALIASES.get(key) || value.trim();
}

function normalizeIdeogramStyle(style) {
  if (!isPlainObject(style)) return style;
  const medium = style.medium != null ? canonicalIdeogramMedium(style.medium) : undefined;
  const hasPhoto = Boolean(style.photo);
  const hasArt = Boolean(style.art_style);
  let photoBranch = true;
  if (IDEOGRAM_MEDIUM_OPTIONS.has(medium)) photoBranch = medium === 'photograph';
  else if (hasArt && !hasPhoto) photoBranch = false;

  const out = {};
  if (style.aesthetics != null) out.aesthetics = style.aesthetics;
  if (style.lighting != null) out.lighting = style.lighting;
  if (photoBranch) {
    const value = hasPhoto ? style.photo : style.art_style;
    if (value != null) out.photo = value;
    if (medium != null) out.medium = medium;
  } else {
    if (medium != null) out.medium = medium;
    const value = hasArt ? style.art_style : style.photo;
    if (value != null) out.art_style = value;
  }
  const palette = sanitizePalette(style.color_palette, 16);
  if (palette) out.color_palette = palette;
  for (const [key, value] of Object.entries(style)) {
    if (!(key in out) && !['aesthetics', 'lighting', 'photo', 'art_style', 'medium', 'color_palette'].includes(key)) {
      out[key] = value;
    }
  }
  return out;
}

function normalizeIdeogramElement(element) {
  if (!isPlainObject(element)) return element;
  const type = element.type === 'text' ? 'text' : 'obj';
  const out = { type };
  if (element.bbox != null) out.bbox = element.bbox;
  if (type === 'text') {
    if (element.text != null) out.text = element.text;
    if (element.desc != null) out.desc = element.desc;
  } else if (element.desc != null) {
    out.desc = element.desc;
  }
  const palette = sanitizePalette(element.color_palette, 5);
  if (palette) out.color_palette = palette;
  for (const [key, value] of Object.entries(element)) {
    if (!(key in out) && key !== 'color_palette') out[key] = value;
  }
  return out;
}

function normalizeIdeogramCaptionPayload(data) {
  if (!isPlainObject(data)) return data;
  const out = {};
  if (data.high_level_description != null) out.high_level_description = data.high_level_description;
  if (data.style_description != null) out.style_description = normalizeIdeogramStyle(data.style_description);
  if (isPlainObject(data.compositional_deconstruction)) {
    const decon = data.compositional_deconstruction;
    const normalized = {};
    if (decon.background != null) normalized.background = decon.background;
    if (Array.isArray(decon.elements)) normalized.elements = decon.elements.map(normalizeIdeogramElement);
    for (const [key, value] of Object.entries(decon)) {
      if (!(key in normalized) && !['background', 'elements'].includes(key)) normalized[key] = value;
    }
    out.compositional_deconstruction = normalized;
  } else if (data.compositional_deconstruction != null) {
    out.compositional_deconstruction = data.compositional_deconstruction;
  }
  for (const [key, value] of Object.entries(data)) {
    if (!['high_level_description', 'style_description', 'compositional_deconstruction', 'aspect_ratio'].includes(key)) {
      out[key] = value;
    }
  }
  return out;
}

function normalizeTriggerText(value) {
  return String(value || '')
    .replace(/，/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*)+$/g, '')
    .trim();
}

function triggerFromInput(input = {}) {
  return normalizeTriggerText(input.triggerText || input.trigger || input.batchTagTrigger || input.customPrompt);
}

function prefixTextWithTrigger(text, triggerValue) {
  const trigger = normalizeTriggerText(triggerValue);
  const clean = String(text || '').trim();
  if (!trigger) return clean;
  const prefix = `${trigger},`;
  if (!clean) return prefix;
  if (clean.toLowerCase().startsWith(prefix.toLowerCase())) return clean;
  return `${prefix} ${clean.replace(/^[,，\s]+/, '')}`;
}

function selectedSidecarText(input = {}) {
  const parsed = input.parsed || {};
  const mode = String(input.mode || 'tags').trim();
  if (mode === 'caption') return parsed.caption || parsed.text || parsed.rawText || '';
  if (mode === 'short') return parsed.shortCaption || parsed.text || parsed.rawText || '';
  if (mode === 'tags') return parsed.text || (Array.isArray(parsed.tags) ? parsed.tags.join(', ') : '') || parsed.rawText || '';
  return parsed.text || parsed.caption || parsed.shortCaption || (Array.isArray(parsed.tags) ? parsed.tags.join(', ') : '') || parsed.rawText || '';
}

function applyTriggerToIdeogramPayload(data, triggerValue) {
  const normalized = normalizeIdeogramCaptionPayload(data);
  if (!isPlainObject(normalized)) return normalized;
  const trigger = normalizeTriggerText(triggerValue);
  if (!trigger) return normalized;
  const out = {};
  out.high_level_description = prefixTextWithTrigger(normalized.high_level_description || '', trigger);
  for (const [key, value] of Object.entries(normalized)) {
    if (key !== 'high_level_description') out[key] = value;
  }
  return out;
}

function parseBatchTagOutput(rawText, mode = 'tags') {
  const raw = String(rawText || '').trim();
  const clean = stripCodeFence(raw);
  let metadata = null;
  if (mode === 'json') {
    try {
      const parsed = JSON.parse(clean);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed;
    } catch {
      try {
        const parsed = JSON.parse(extractJsonObjectText(clean));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed;
      } catch {
        metadata = null;
      }
    }
  }
  const tags = normalizeTags(metadata?.tags ?? (mode === 'tags' ? clean : []));
  const caption = String(metadata?.high_level_description || metadata?.caption || (mode === 'caption' ? clean : '')).trim();
  const shortCaption = String(metadata?.shortCaption || metadata?.short_caption || (mode === 'short' ? clean : '')).trim();
  return {
    text: mode === 'tags'
      ? tags.join(', ')
      : mode === 'caption'
        ? caption
        : mode === 'short'
          ? shortCaption
          : metadata
            ? JSON.stringify(metadata, null, 2)
            : clean,
    tags,
    caption,
    shortCaption,
    metadata,
    rawText: raw,
  };
}

function buildIdeogram4JsonPrompt(options = {}, fileName = '') {
  const kind = mediaKind(options.mediaKind);
  const fileLine = fileName ? `素材文件名：${fileName}` : '';
  const mediaText = kind === 'video' ? 'video frames' : 'image';
  const aspectRatioHint = kind === 'video'
    ? 'Use the visible frame composition to estimate bboxes.'
    : 'If the exact aspect ratio is unknown, infer it from the provided image.';
  return [
    'You are an Ideogram-4 structured captioner. Analyze the provided visual material and emit one JSON object for image-training captions.',
    fileLine,
    'Observe-only rule: describe only what is actually visible. Do not invent subjects, props, brands, text, background details, atmosphere, identity, or off-frame content.',
    'OUTPUT CONTRACT: exactly three top-level keys in this order: "high_level_description", "style_description", "compositional_deconstruction".',
    '"high_level_description": one concise observational sentence, under 50 words, starting directly with the subject. Do not start with "this image shows".',
    '"style_description": required object. For photographs use keys "aesthetics", "lighting", "photo", "medium", "color_palette". For illustration/3D/painting/graphic design use "aesthetics", "lighting", "medium", "art_style", "color_palette".',
    '"medium" must be one of: "photograph", "illustration", "3d_render", "painting", "graphic_design". "color_palette" uses dominant uppercase #RRGGBB colors, up to 16.',
    '"compositional_deconstruction": required object with "background" and "elements". Background describes the scene shell only. Elements are one item per distinct visible subject.',
    'Element shapes: {"type":"obj","bbox":[y1,x1,y2,x2],"desc":"..."} or {"type":"text","bbox":[y1,x1,y2,x2],"text":"VISIBLE TEXT","desc":"..."}.',
    'Bboxes are optional, normalized 0-1000, top-left origin, stored as [y1,x1,y2,x2]. Include bboxes only when the visible extent is clear.',
    'For visible text, preserve the exact characters in the "text" field. Prose fields stay in English.',
    `${aspectRatioHint} The current input is ${mediaText}.`,
    'Emit valid JSON only. No markdown fences. No commentary. No questions.',
    ...DIRECT_OUTPUT_RULES,
  ].filter(Boolean).join('\n');
}

function buildBatchTagPrompt(options = {}) {
  const mode = String(options.mode || 'tags').trim();
  const kind = mediaKind(options.mediaKind);
  const fileName = cleanText(options.fileName, 240);
  const maxTags = Math.max(1, Math.min(200, Math.round(Number(options.maxTags) || 30)));
  if (mode === 'json') return buildIdeogram4JsonPrompt({ ...options, mediaKind: kind }, fileName);
  const base = [
    `你是训练素材批量打标助手。请严格根据当前${kind === 'video' ? '视频' : '图像'}可见内容输出。`,
    fileName ? `素材文件名：${fileName}` : '',
    '输出语言：中文，必要的训练标签可保留英文通用 tag。',
    '不要编造不可见主体、人物身份、品牌或文字；不要输出 Markdown 解释。',
    ...DIRECT_OUTPUT_RULES,
  ].filter(Boolean);
  if (mode === 'caption') {
    return [
      ...base,
      'Generate a detailed paragraph that combines the subject, actions, environment, lighting, and mood into 2-3 cohesive sentences. Focus on accurate visual details rather than speculation.',
      'Output the description directly.',
      '只输出描述正文。',
    ].join('\n');
  }
  if (mode === 'short') {
    return [
      ...base,
      'Analyze the image and write a single concise sentence that describes the main subject and setting. Keep it grounded in visible details only.',
      '只输出短句正文。',
    ].join('\n');
  }
  return [
    ...base,
    `Your task is to generate a clean list of comma-separated tags based only on the visual information in the image. 输出逗号分隔 TAG，最多 ${maxTags} 个。`,
    'Strictly describe visual elements like subject, clothing, environment, colors, lighting, and composition. Avoid repeating tags. 不要加编号。',
  ].join('\n');
}

function buildBatchTagMessages(input = {}) {
  const item = input.item || {};
  const kind = mediaKind(item.kind || input.mediaKind);
  const mode = String(input.mode || 'tags').trim();
  const systemPrompt = cleanText(input.prompt, 8000) || buildBatchTagPrompt({
    mode: input.mode,
    mediaKind: kind,
    fileName: item.name,
    maxTags: input.maxTags,
  });
  const url = String(item.url || item.imageUrl || item.videoUrl || '').trim();
  const userInstruction = mode === 'json'
    ? `Analyze the provided ${kind === 'video' ? 'video' : 'image'} and emit the JSON caption.`
    : `Analyze the provided ${kind === 'video' ? 'video' : 'image'} and output the requested batch tag result.`;
  const content = [{ type: 'text', text: userInstruction }];
  if (url) {
    if (kind === 'video') content.push({ type: 'video_url', video_url: { url } });
    else content.push({ type: 'image_url', image_url: { url } });
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content },
  ];
}

function resolveBatchTagModel(provider, input = {}, kind = 'image') {
  const requested = cleanText(input.model || input.providerModel, 240);
  if (provider?.protocol === 'modelscope' && (kind === 'image' || kind === 'video')) {
    const models = Array.isArray(provider.chatModels) ? provider.chatModels : [];
    const hasVl = !models.length || models.includes(MODELSCOPE_QWEN3_VL_235B);
    if ((!requested || requested === MODELSCOPE_QWEN3_TEXT_235B) && hasVl) return MODELSCOPE_QWEN3_VL_235B;
  }
  return requested || provider?.defaults?.chatModel || provider?.chatModels?.[0] || DEFAULT_ZHENZHEN_MODEL;
}

function ensureInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel !== '' && (!rel || rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new Error('输出路径不安全。');
  }
  return resolvedTarget;
}

function uniqueFilePath(root, name, overwrite = false) {
  const parsed = path.parse(name);
  let currentName = name;
  let currentPath = ensureInside(root, path.join(root, currentName));
  if (overwrite || !fs.existsSync(currentPath)) return { name: currentName, path: currentPath };
  for (let index = 2; index < 10000; index += 1) {
    currentName = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`).replace(/\\/g, '/');
    currentPath = ensureInside(root, path.join(root, currentName));
    if (!fs.existsSync(currentPath)) return { name: currentName, path: currentPath };
  }
  throw new Error('无法生成不冲突的输出文件名。');
}

function ensureWritableDirectory(dirPath) {
  const resolved = path.resolve(dirPath);
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error(`输出路径不是目录: ${resolved}`);
    return resolved;
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function decodePublicPathname(value) {
  try {
    return decodeURIComponent(new URL(String(value || ''), 'http://127.0.0.1').pathname || '');
  } catch {
    return '';
  }
}

function sourcePathFromItem(item = {}) {
  const raw = String(item.sourcePath || item.localPath || item.originalPath || '').trim();
  if (!raw || !path.isAbsolute(raw)) return '';
  const resolved = path.resolve(raw);
  try {
    if (!fs.statSync(resolved).isFile()) return '';
  } catch {
    return '';
  }
  return resolved;
}

function isPathInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveSourcePathSidecarTarget(item = {}) {
  const sourcePath = sourcePathFromItem(item);
  if (!sourcePath) return null;
  const sourceDir = path.dirname(sourcePath);
  const sourceName = path.basename(sourcePath);
  return {
    root: sourceDir,
    item: {
      ...item,
      name: sourceName,
      relativePath: '',
    },
    urlForName() {
      return '';
    },
  };
}

const DEV_SOURCE_SKIP_DIRS = new Set([
  '.git',
  '.vite',
  'artifacts',
  'build',
  'data',
  'dist',
  'dist_electron',
  'input',
  'node_modules',
  'output',
  'thumbnails',
]);

function sourceBasenameFromItem(item = {}) {
  const raw = String(item.relativePath || item.name || '').replace(/\\/g, '/').split('/').pop() || '';
  return path.basename(raw);
}

function shouldSkipDevSourceDir(dirPath, projectRoot) {
  const name = path.basename(dirPath).toLowerCase();
  if (DEV_SOURCE_SKIP_DIRS.has(name)) return true;
  const resolved = path.resolve(dirPath);
  const blockedRoots = [
    projectRoot,
    config.INPUT_DIR,
    config.OUTPUT_DIR,
    config.DATA_DIR,
    config.THUMBNAILS_DIR,
  ].filter(Boolean);
  return blockedRoots.some((root) => isPathInside(root, resolved));
}

function collectDevSourceCandidateDirs(parentRoot, projectRoot, maxDirs = 500) {
  const out = [parentRoot];
  let entries = [];
  try {
    entries = fs.readdirSync(parentRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(parentRoot, entry.name);
    if (shouldSkipDevSourceDir(dir, projectRoot)) continue;
    out.push(dir);
    if (out.length >= maxDirs) break;
    let childEntries = [];
    try {
      childEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of childEntries) {
      if (!child.isDirectory()) continue;
      const childDir = path.join(dir, child.name);
      if (shouldSkipDevSourceDir(childDir, projectRoot)) continue;
      out.push(childDir);
      if (out.length >= maxDirs) break;
    }
    if (out.length >= maxDirs) break;
  }
  return out;
}

function splitDevSourceRoots(value) {
  return String(value || '')
    .split(process.platform === 'win32' ? /[;\r\n]+/ : /[:;\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addDevSourceRoot(out, seen, root) {
  const raw = String(root || '').trim();
  if (!raw || !path.isAbsolute(raw)) return;
  let resolved = '';
  try {
    resolved = path.resolve(raw);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return;
  } catch {
    return;
  }
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(resolved);
}

function devSourceSearchRoots(projectRoot) {
  const out = [];
  const seen = new Set();
  for (const root of splitDevSourceRoots(process.env.T8PC_BATCH_TAG_SOURCE_ROOTS)) {
    addDevSourceRoot(out, seen, root);
  }
  addDevSourceRoot(out, seen, path.dirname(projectRoot));

  const userRoots = [
    os.homedir(),
    process.env.USERPROFILE,
    process.env.HOME,
    process.env.ONEDRIVE,
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial,
  ].filter(Boolean);
  const commonNames = ['Desktop', 'Downloads', 'Pictures', 'Documents', 'Videos'];
  for (const root of userRoots) {
    for (const name of commonNames) addDevSourceRoot(out, seen, path.join(root, name));
  }
  for (const root of userRoots) addDevSourceRoot(out, seen, root);
  return out;
}

function inferDevSiblingSourcePath(item = {}) {
  if (config.IS_PACKAGED) return '';
  const sourceName = sourceBasenameFromItem(item);
  if (!sourceName) return '';
  const expectedSize = Number(item.size || item.fileSize || 0);
  const projectRoot = path.resolve(config.BASE_DIR || path.join(__dirname, '..', '..'));
  const matches = [];
  const checkedDirs = new Set();
  for (const root of devSourceSearchRoots(projectRoot)) {
    const dirs = collectDevSourceCandidateDirs(root, projectRoot);
    for (const dir of dirs) {
      const dirKey = process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir);
      if (checkedDirs.has(dirKey)) continue;
      checkedDirs.add(dirKey);
      const candidate = path.resolve(dir, sourceName);
      if (isPathInside(projectRoot, candidate)) continue;
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        if (expectedSize > 0 && stat.size !== expectedSize) continue;
        matches.push(candidate);
        if (matches.length > 1) return '';
      } catch {
        // Missing candidates are normal while scanning likely source folders.
      }
    }
  }
  return matches.length === 1 ? matches[0] : '';
}

function resolveInferredDevSidecarTarget(item = {}) {
  const sourcePath = inferDevSiblingSourcePath(item);
  if (!sourcePath) return null;
  const sourceDir = path.dirname(sourcePath);
  const sourceName = path.basename(sourcePath);
  return {
    root: sourceDir,
    item: {
      ...item,
      name: sourceName,
      relativePath: '',
    },
    urlForName() {
      return '';
    },
  };
}

function resolveLocalSidecarTarget(item = {}) {
  const sourceTarget = resolveSourcePathSidecarTarget(item);
  if (sourceTarget) return sourceTarget;

  const inferredTarget = resolveInferredDevSidecarTarget(item);
  if (inferredTarget) return inferredTarget;

  const pathname = decodePublicPathname(item.url || item.imageUrl || item.videoUrl);
  const mappings = [
    { prefix: '/files/input/', root: config.INPUT_DIR, publicPrefix: '/files/input/' },
    { prefix: '/input/', root: config.INPUT_DIR, publicPrefix: '/files/input/' },
    { prefix: '/files/output/', root: config.OUTPUT_DIR, publicPrefix: '/files/output/' },
    { prefix: '/output/', root: config.OUTPUT_DIR, publicPrefix: '/files/output/' },
  ];
  for (const mapping of mappings) {
    if (!pathname.startsWith(mapping.prefix)) continue;
    const rel = pathname.slice(mapping.prefix.length).replace(/^\/+/, '');
    if (!rel) continue;
    const sourcePath = ensureInside(mapping.root, path.join(mapping.root, rel));
    const sourceDir = path.dirname(sourcePath);
    const sourceName = path.basename(sourcePath);
    return {
      root: sourceDir,
      item: {
        ...item,
        name: item.name || sourceName,
        relativePath: '',
      },
      urlForName(name) {
        const targetPath = ensureInside(mapping.root, path.join(sourceDir, name));
        const targetRel = path.relative(mapping.root, targetPath).replace(/\\/g, '/');
        return `${mapping.publicPrefix}${targetRel}`;
      },
    };
  }
  return null;
}

function buildJsonPayload({
  item = {},
  parsed = {},
  providerId = '',
  model = '',
  mode = 'tags',
  triggerText = '',
  trigger = '',
  batchTagTrigger = '',
  customPrompt = '',
} = {}) {
  if (mode === 'json' && isPlainObject(parsed.metadata)) {
    return applyTriggerToIdeogramPayload(parsed.metadata, triggerFromInput({
      triggerText,
      trigger,
      batchTagTrigger,
      customPrompt,
    }));
  }
  return {
    sourceFile: item.name || '',
    sourceUrl: item.url || '',
    relativePath: item.relativePath || '',
    mediaType: item.kind || '',
    providerId,
    model,
    mode,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    caption: parsed.caption || '',
    shortCaption: parsed.shortCaption || '',
    text: parsed.text || '',
    rawText: parsed.rawText || '',
    metadata: parsed.metadata || null,
    createdAt: new Date().toISOString(),
  };
}

function writeBatchTagSidecars(input = {}) {
  const localTarget = input.outputRoot ? null : resolveLocalSidecarTarget(input.item);
  const outputRoot = path.resolve(localTarget?.root || input.outputRoot || path.join(config.OUTPUT_DIR, 'batch-tags'));
  ensureWritableDirectory(outputRoot);
  const formats = sidecarFormats(input.formats);
  const names = buildSidecarNames(localTarget?.item || input.item, formats);
  const saved = [];
  const mode = String(input.mode || 'tags').trim();
  const structuredJson = mode === 'json' && isPlainObject(input.parsed?.metadata);
  const payload = structuredJson
    ? `${JSON.stringify(buildJsonPayload(input), null, 2)}\n`
    : `${prefixTextWithTrigger(selectedSidecarText(input), triggerFromInput(input))}\n`;
  for (const format of formats) {
    const name = names[format];
    if (!name) continue;
    const target = uniqueFilePath(outputRoot, name, input.overwrite === true);
    ensureWritableDirectory(path.dirname(target.path));
    fs.writeFileSync(target.path, payload, 'utf8');
    saved.push({
      format,
      name: target.name.replace(/\\/g, '/'),
      path: target.path,
      directory: path.dirname(target.path),
      url: localTarget?.urlForName
        ? localTarget.urlForName(target.name)
        : `/files/output/batch-tags/${target.name.replace(/\\/g, '/')}`,
    });
  }
  return saved;
}

function maskedProvider(provider) {
  return maskAdvancedProviders([provider])[0] || null;
}

function zhenzhenProvider(settings, requestedModel) {
  if (!settings?.llmApiKey) {
    return {
      ok: false,
      code: 'missing_llm_api_key',
      error: '未配置 LLM 独立 API Key，请先在 API 设置里填写。',
    };
  }
  const model = cleanText(requestedModel, 240) || DEFAULT_ZHENZHEN_MODEL;
  return {
    ok: true,
    provider: {
      id: 'zhenzhen',
      label: 'LLM 独立 Key',
      protocol: 'openai-compatible',
      baseUrl: `${config.ZHENZHEN_BASE_URL.replace(/\/+$/, '')}/v1`,
      enabled: true,
      apiKey: settings.llmApiKey,
      chatModels: [model],
      defaults: { chatModel: model },
    },
  };
}

function resolveAdvancedProvider(body, providers) {
  const providerId = cleanText(body.providerId || body.provider_id, 80);
  if (body.provider && typeof body.provider === 'object') {
    const normalized = normalizeAdvancedProviders([body.provider], providers);
    const id = cleanText(body.provider.id, 80);
    return normalized.find((provider) => provider.id === id) || normalized[0] || null;
  }
  return providers.find((provider) => provider.id === providerId) || null;
}

function resolveBatchTagProvider(body, settings) {
  const source = cleanText(body.providerSource || body.provider_source || body.providerId, 80).toLowerCase();
  if (!source || source === 'zhenzhen') return zhenzhenProvider(settings, body.model || body.providerModel);
  const providers = normalizeAdvancedProviders(settings.advancedProviders);
  const provider = resolveAdvancedProvider(body, providers);
  if (!provider) {
    return { ok: false, code: 'provider_not_found', error: '未找到扩展平台配置。' };
  }
  if (!provider.enabled) {
    return { ok: false, code: 'provider_disabled', error: '扩展平台未启用，请先在 API 设置中启用。', provider };
  }
  return { ok: true, provider };
}

router.post('/tag', async (req, res) => {
  let clientGone = false;
  const controller = new AbortController();
  req.on('aborted', () => { clientGone = true; controller.abort(); });
  res.on('close', () => {
    if (!res.writableEnded) { clientGone = true; controller.abort(); }
  });
  try {
    const body = req.body || {};
    const item = body.item && typeof body.item === 'object' ? body.item : {};
    const kind = mediaKind(item.kind || body.mediaKind);
    const url = String(item.url || item.imageUrl || item.videoUrl || '').trim();
    if (!url) {
      return res.status(400).json({ success: false, code: 'missing_media', error: '请提供要打标的图像或视频素材。' });
    }

    const settings = settingsRouter.loadSettings({ persistMigrations: false });
    const resolved = resolveBatchTagProvider(body, settings);
    if (!resolved.ok) {
      return res.status(400).json({
        success: false,
        code: resolved.code,
        error: resolved.error,
        data: resolved.provider ? { provider: maskedProvider(resolved.provider) } : undefined,
      });
    }

    const model = resolveBatchTagModel(resolved.provider, body, kind);
    const triggerText = body.triggerText || body.trigger || body.batchTagTrigger || body.customPrompt;
    const messages = buildBatchTagMessages({
      item: { ...item, kind, url },
      mode: body.mode || body.batchTagMode || 'tags',
      model,
      maxTags: body.maxTags,
      prompt: body.prompt,
    });

    const result = await generateChatWithProvider(resolved.provider, {
      model,
      messages,
      temperature: body.temperature ?? 0.2,
      maxTokens: body.maxTokens || body.max_tokens || 1200,
      llmVideoMode: body.videoMode || body.llmVideoMode || 'frames',
      videoFrameCount: body.frameCount || body.videoFrameCount || 8,
      videoMaxWidth: body.videoMaxWidth || 720,
      videoMaxHeight: body.videoMaxHeight || 720,
      videoMaxBase64Mb: body.videoMaxBase64Mb || 8,
      videoCrf: body.videoCrf || 32,
    }, {
      timeoutMs: normalizeProviderLlmTimeoutMs(body.timeoutMs, { fallback: DEFAULT_TIMEOUT_MS }),
      baseUrl: `http://127.0.0.1:${config.PORT}`,
      signal: controller.signal,
    });
    if (clientGone) return undefined;
    if (!result.ok) {
      return res.status(502).json({
        success: false,
        code: result.code || 'batch_tag_failed',
        error: result.error || '打标 API 调用失败。',
        data: { provider: maskedProvider(resolved.provider), raw: result.raw },
      });
    }

    const mode = body.mode || body.batchTagMode || 'tags';
    const parsed = parseBatchTagOutput(result.text || '', mode);
    if (clientGone) return undefined;
    const outputFiles = body.save === false
      ? []
      : writeBatchTagSidecars({
        item: { ...item, kind, url },
        parsed,
        formats: body.formats || body.outputFormats || ['txt'],
        overwrite: body.overwrite === true,
        providerId: resolved.provider.id,
        model,
        mode,
        triggerText,
      });

    return res.json({
      success: true,
      data: {
        text: parsed.text,
        tags: parsed.tags,
        caption: parsed.caption,
        shortCaption: parsed.shortCaption,
        metadata: parsed.metadata,
        rawText: parsed.rawText,
        outputFiles,
        provider: maskedProvider(resolved.provider),
        model,
        videoMode: body.videoMode || body.llmVideoMode || 'frames',
        raw: result.raw,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: 'batch_tag_error',
      error: error?.message || String(error),
    });
  }
});

module.exports = router;
module.exports.buildBatchTagMessages = buildBatchTagMessages;
module.exports.buildBatchTagPrompt = buildBatchTagPrompt;
module.exports.parseBatchTagOutput = parseBatchTagOutput;
module.exports.resolveBatchTagModel = resolveBatchTagModel;
module.exports.writeBatchTagSidecars = writeBatchTagSidecars;
module.exports.buildSidecarNames = buildSidecarNames;
