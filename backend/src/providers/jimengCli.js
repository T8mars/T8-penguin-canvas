const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const config = require('../config');
const { mediaRefToAbsoluteUrl, resolveMediaRef, mimeFromPath } = require('./mediaResolver');
const { providerTrace } = require('./providerTrace');
const { safeRemoteMediaFetch } = require('../utils/safeRemoteMediaFetch');
const jimengCliCompatibility = require('../shared/jimengCliCompatibility.json');

const JIMENG_CLI_SUPPORTED_VERSION = jimengCliCompatibility.supportedVersion;
const JIMENG_CLI_SUPPORTED_RELEASE_DATE = jimengCliCompatibility.releaseDate;
const JIMENG_SEEDANCE25_MODEL = jimengCliCompatibility.seedance25.modelVersion;
const JIMENG_SEEDANCE25_LIMITS = jimengCliCompatibility.seedance25.multimodal;
const JIMENG_SEEDANCE20_LIMITS = jimengCliCompatibility.seedance20Multimodal;

function cleanExecutablePath(provider) {
  return String(provider?.jimengConfig?.executablePath || '').trim();
}

function pollSeconds(provider) {
  const n = Number(provider?.jimengConfig?.pollSeconds || 3600);
  const seconds = Number.isFinite(n) ? Math.round(n) : 3600;
  return Math.max(0, Math.min(3600, seconds));
}

function shQuote(value) {
  return `'${String(value || '').replace(/'/g, "'\\''")}'`;
}

function isBareCommand(command) {
  const text = String(command || '').trim();
  return !!text && !/[\\/]/.test(text);
}

function wslExecutablePath(provider, command = cleanExecutablePath(provider)) {
  const value = String(command || 'dreamina').trim();
  return isBareCommand(value) ? value : wslPath(provider, value);
}

function wslCommandExists(command, provider) {
  const exe = wslExecutablePath(provider, command);
  if (!exe) return false;
  const distro = String(provider?.jimengConfig?.wslDistro || '').trim();
  const testLine = isBareCommand(exe)
    ? `command -v ${shQuote(exe)} >/dev/null 2>&1`
    : `test -x ${shQuote(exe)}`;
  const result = spawnSync('wsl.exe', [
    ...(distro ? ['-d', distro] : []),
    '-e',
    'sh',
    '-lc',
    testLine,
  ], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
  });
  return result.status === 0;
}

function commandExists(command, provider) {
  if (!command) return false;
  if (provider?.jimengConfig?.useWsl) return wslCommandExists(command, provider);
  if (path.isAbsolute(command)) return fs.existsSync(command);
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], {
    encoding: 'utf-8',
    timeout: 3000,
    windowsHide: true,
  });
  return result.status === 0;
}

async function providerCommandExists(command, provider, options = {}) {
  if (typeof options.commandExists === 'function') {
    return !!(await options.commandExists(command, provider));
  }
  return commandExists(command, provider);
}

function selectedModel(requested, models, fallback) {
  const fromList = Array.isArray(models) ? models.find((item) => String(item || '').trim()) : '';
  return String(requested || fromList || fallback || '').trim();
}

function parseSize(value) {
  const match = String(value || '').match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
  if (!match) return [1024, 1024];
  return [Math.max(1, Number(match[1])), Math.max(1, Number(match[2]))];
}

function ratioFromSize(size, fallback = '1:1') {
  const [w, h] = parseSize(size);
  const choices = [[21, 9], [16, 9], [3, 2], [4, 3], [1, 1], [3, 4], [2, 3], [9, 16]];
  const best = choices.reduce((acc, item) => (
    Math.abs((item[0] / item[1]) - (w / h)) < Math.abs((acc[0] / acc[1]) - (w / h)) ? item : acc
  ), choices[4]);
  return best ? `${best[0]}:${best[1]}` : fallback;
}

function imageResolution(model, size, input = {}) {
  const text = String(model || '').toLowerCase();
  const params = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  const requested = String(firstDefined(
    params.resolution_type,
    params.resolutionType,
    input.resolution_type,
    input.resolutionType,
  ) || '').trim().toLowerCase();
  if (['1k', '1.5k', '2k', '4k'].includes(requested)) return requested;
  if (text.includes('4k')) return '4k';
  if (text.includes('1.5k')) return '1.5k';
  if (text.includes('1k')) return '1k';
  if (text.includes('2k')) return '2k';
  const [w, h] = parseSize(size);
  if (imageModelVersion(model) === '5.0Pro' && Math.max(w, h) <= 1536) return '1.5k';
  return Math.max(w, h) > 2048 ? '4k' : '2k';
}

function imageModelVersion(model) {
  const text = String(model || '').trim();
  if (!text) return '';
  if (/(?:seedream[-_\s]?)?v?5\.0[-_\s]?pro/i.test(text) || /^5\.0pro$/i.test(text)) return '5.0Pro';
  const found = text.match(/(?:seedream[-_\s]?)?v?((?:3\.[01])|(?:4\.[01567])|(?:5\.0))/i);
  return found ? found[1] : '';
}

function imageCustomDimensions(input = {}, resolutionType = '2k') {
  const params = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  const enabled = params.customSizeEnabled === true || input.customSizeEnabled === true;
  const rawWidth = firstDefined(params.width, params.customWidth, input.width, input.customWidth);
  const rawHeight = firstDefined(params.height, params.customHeight, input.height, input.customHeight);
  if (params.customSizeEnabled === false || input.customSizeEnabled === false) return null;
  if (!enabled && rawWidth === undefined && rawHeight === undefined) return null;
  if (rawWidth === undefined || rawHeight === undefined) {
    throw new Error('即梦 CLI 自定义尺寸必须同时填写宽度和高度。');
  }
  const width = Math.round(Number(rawWidth));
  const height = Math.round(Number(rawHeight));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('即梦 CLI 自定义宽高必须是有效整数。');
  }
  const limits = {
    '1k': { min: 512, max: 2016, area: 1763584 },
    '1.5k': { min: 972, max: 2268, area: 2359296 },
    '2k': { min: 768, max: 3072, area: 4194304 },
    '4k': { min: 1536, max: 6240, area: 16777216 },
  };
  const limit = limits[resolutionType] || limits['2k'];
  if (width < limit.min || width > limit.max || height < limit.min || height > limit.max || (width * height) > limit.area) {
    throw new Error(`即梦 CLI ${resolutionType.toUpperCase()} 自定义尺寸不合法：宽高需在 ${limit.min}-${limit.max}，且总像素不能超过 ${limit.area}。`);
  }
  return { width, height };
}

function supportedImageResolutions(model) {
  const modelVersion = imageModelVersion(model);
  if (modelVersion === '3.0' || modelVersion === '3.1') return new Set(['1k', '2k']);
  if (modelVersion === '5.0Pro') return new Set(['1.5k', '2k', '4k']);
  if (modelVersion) return new Set(['2k', '4k']);
  return new Set(['2k', '4k']);
}

function assertImageResolutionSupported(model, resolutionType) {
  if (supportedImageResolutions(model).has(resolutionType)) return;
  const modelVersion = imageModelVersion(model) || String(model || '当前模型');
  const supported = Array.from(supportedImageResolutions(model)).map((item) => item.toUpperCase()).join(' / ');
  throw new Error(`即梦 CLI ${modelVersion} 不支持 ${String(resolutionType).toUpperCase()}；请选择 ${supported}。`);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function imageGenerateNum(input = {}) {
  const params = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  return clampInt(firstDefined(
    params.generate_num,
    params.generateNum,
    input.generate_num,
    input.generateNum,
    input.n,
    params.n,
  ), 1, 10, 1);
}

function videoResolution(model, resolution) {
  const modelVersion = videoModelVersion(model);
  const value = String(resolution || '').trim().toUpperCase();
  if (modelVersion === JIMENG_SEEDANCE25_MODEL) {
    if (['480P', '720P', '1080P'].includes(value)) return value;
    return '720P';
  }
  if (modelVersion.startsWith('seedance2.0')) {
    if (modelVersion === 'seedance2.0_vip') {
      if (['4K', 'NATIVE4K', '2160P', 'UHD'].includes(value)) return '4K';
      if (value === '1080P') return '1080P';
    }
    return '720P';
  }
  if (modelVersion.startsWith('seedance1.') || /^3\./.test(modelVersion)) return '720P';
  if (['480P', '720P', '1080P', '4K'].includes(value)) return value;
  const text = String(model || '').toLowerCase();
  if (text.includes('4k')) return '4K';
  if (text.includes('1080')) return '1080P';
  if (text.includes('480')) return '480P';
  return '720P';
}

function commandSupportsVideoModel(command, modelVersion) {
  if (!modelVersion) return false;
  if (modelVersion === JIMENG_SEEDANCE25_MODEL) {
    return jimengCliCompatibility.seedance25.commands.includes(command);
  }
  if (modelVersion.startsWith('seedance2.0')) return command !== 'multiframe2video';
  if (modelVersion === 'seedance1.5pro') return command === 'image2video' || command === 'frames2video';
  if (modelVersion === 'seedance1.0fast') return command === 'image2video';
  return false;
}

function videoDuration(value, model) {
  const n = Number(value || 5);
  const modelVersion = videoModelVersion(model);
  const candidate = Number.isFinite(n) ? Math.round(n) : 5;
  if (modelVersion === JIMENG_SEEDANCE25_MODEL) return Math.max(4, Math.min(30, candidate));
  if (modelVersion === 'seedance1.5pro') return Math.max(5, Math.min(12, candidate));
  if (modelVersion === 'seedance1.0fast') return Math.max(5, Math.min(10, candidate));
  return Math.max(4, Math.min(15, candidate));
}

function videoModelVersion(model) {
  const low = String(model || '').toLowerCase();
  const compact = (value) => String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  const flat = (value) => String(value || '').toLowerCase().replace(/[\s_.-]+/g, '');
  const matches = (key) => low.includes(key) || compact(low).includes(compact(key)) || flat(low).includes(flat(key));
  const aliases = [
    ['seedance2.5', 'seedance2.5'],
    ['seedance-2.5', 'seedance2.5'],
    ['seedance2.0fast_vip', 'seedance2.0fast_vip'],
    ['seedance2.0_vip', 'seedance2.0_vip'],
    ['seedance2.0mini', 'seedance2.0mini'],
    ['seedance2.0_mini', 'seedance2.0mini'],
    ['seedance-2.0-mini', 'seedance2.0mini'],
    ['seedance2.0fast', 'seedance2.0fast'],
    ['seedance2.0', 'seedance2.0'],
    ['seedance1.5pro', 'seedance1.5pro'],
    ['seedance1.5_pro', 'seedance1.5pro'],
    ['seedance-1.5-pro', 'seedance1.5pro'],
    ['seedance1.0fast', 'seedance1.0fast'],
    ['seedance1.0_fast', 'seedance1.0fast'],
    ['seedance-1.0-fast', 'seedance1.0fast'],
    // v1.4.17 still no longer exposes the old seedance1.0 name; migrate saved aliases to the supported fast model.
    ['seedance1.0', 'seedance1.0fast'],
    ['seedance-1.0', 'seedance1.0fast'],
    ['seedance1.0pro', 'seedance1.0fast'],
    ['seedance1.0_pro', 'seedance1.0fast'],
    ['seedance-1.0-pro', 'seedance1.0fast'],
    ['seedance1.0lite_t2v', 'seedance1.0fast'],
    ['seedance1.0_lite_t2v', 'seedance1.0fast'],
    ['seedance-1.0-lite-t2v', 'seedance1.0fast'],
    ['seedance1.0lite_i2v', 'seedance1.0fast'],
    ['seedance1.0_lite_i2v', 'seedance1.0fast'],
    ['seedance-1.0-lite-i2v', 'seedance1.0fast'],
    ['3.0_fast', 'seedance1.0fast'],
    ['3.0fast', 'seedance1.0fast'],
    ['3.0_pro', 'seedance1.0fast'],
    ['3.0pro', 'seedance1.0fast'],
    ['3.5_pro', 'seedance1.5pro'],
    ['3.5pro', 'seedance1.5pro'],
  ];
  const found = aliases.find(([key]) => matches(key));
  return found ? found[1] : '';
}

function multimodalLimits(modelVersion) {
  return modelVersion === JIMENG_SEEDANCE25_MODEL ? JIMENG_SEEDANCE25_LIMITS : JIMENG_SEEDANCE20_LIMITS;
}

function multimodalInputError(modelVersion, images, videos, audios) {
  const limits = multimodalLimits(modelVersion);
  if (images > limits.images) return `即梦 CLI ${modelVersion} 全能参考最多支持 ${limits.images} 张图片。`;
  if (videos > limits.videos) return `即梦 CLI ${modelVersion} 全能参考最多支持 ${limits.videos} 个视频。`;
  if (audios > limits.audios) return `即梦 CLI ${modelVersion} 全能参考最多支持 ${limits.audios} 个音频。`;
  if ((images + videos + audios) > limits.total) return `即梦 CLI ${modelVersion} 全能参考素材总数不能超过 ${limits.total} 个。`;
  if (!limits.audioOnly && images === 0 && videos === 0) return '即梦 CLI Seedance 2.0 全能参考需要至少一张图片或一个视频。';
  return '';
}

function videoRatio(value) {
  const ratio = String(value || '').trim();
  return new Set(['1:1', '3:4', '16:9', '4:3', '9:16', '21:9']).has(ratio) ? ratio : '';
}

function videoMode(input = {}) {
  const params = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  const raw = String(params.frameMode || params.jimengMode || input.frameMode || input.jimengMode || '').trim().toLowerCase();
  if (['first', 'image', 'image2video', 'first_frame', 'first-frame'].includes(raw)) return 'first';
  if (['firstlast', 'first_last', 'first-last', 'frames', 'frames2video'].includes(raw)) return 'firstlast';
  if (['multiframe', 'multi-frame', 'smart', 'smart-multiframe', 'intelligent', 'intelligent-multiframe'].includes(raw)) return 'multiframe';
  if (['omni', 'all', 'all-around', 'allaround', 'multimodal', 'reference', 'ref', 'auto', ''].includes(raw)) return 'omni';
  return 'omni';
}

function appendVideoModelResolutionArgs(args, command, model, resolution) {
  if (command === 'multiframe2video') {
    const resolved = videoResolution(model, resolution).toLowerCase();
    args.push(`--video_resolution=${resolved === '1080p' ? '1080p' : '720p'}`);
    return;
  }
  const modelVersion = videoModelVersion(model);
  if (commandSupportsVideoModel(command, modelVersion)) args.push(`--model_version=${modelVersion}`);
  args.push(`--video_resolution=${videoResolution(model, resolution).toLowerCase()}`);
}

function transitionDuration(totalDuration, transitionCount) {
  const count = Math.max(1, Number(transitionCount) || 1);
  const total = Number(totalDuration || 5);
  const each = (Number.isFinite(total) ? total : 5) / count;
  return Math.max(1, Math.min(8, each));
}

function wslPath(provider, value) {
  if (!provider?.jimengConfig?.useWsl) return value;
  const text = String(value || '').replace(/\\/g, '/');
  const match = text.match(/^([A-Za-z]):\/(.*)$/);
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2]}` : text;
}

function cliCommand(provider) {
  const exe = cleanExecutablePath(provider);
  if (!provider?.jimengConfig?.useWsl) return { command: exe, argsPrefix: [] };
  const distro = String(provider.jimengConfig.wslDistro || '').trim();
  return {
    command: 'wsl.exe',
    argsPrefix: [...(distro ? ['-d', distro] : []), '-e', 'sh', '-lc'],
    shell: true,
    dreamina: wslExecutablePath(provider, exe || 'dreamina'),
  };
}

function jsonScore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 1;
  const keys = new Set(Object.keys(value).map((key) => key.toLowerCase()));
  let weight = 0;
  for (const key of ['submit_id', 'gen_status', 'result_json', 'images', 'videos', 'data', 'total_credit']) {
    if (keys.has(key)) weight += 10;
  }
  return weight;
}

function jsonCandidates(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const first = raw[i];
    if (first !== '{' && first !== '[') continue;
    const stack = [];
    let inString = false;
    let escape = false;
    for (let j = i; j < raw.length; j += 1) {
      const ch = raw[j];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        stack.push(ch);
      } else if (ch === '}' || ch === ']') {
        const open = stack.pop();
        if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) break;
        if (!stack.length) {
          try {
            out.push({ index: i, value: JSON.parse(raw.slice(i, j + 1)) });
          } catch {
            // keep scanning
          }
          break;
        }
      }
    }
  }
  return out;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  const candidates = jsonCandidates(raw);
  if (!candidates.length) return { text: raw };
  const exact = candidates.find((item) => !raw.slice(0, item.index).trim());
  if (exact) return exact.value;
  candidates.sort((a, b) => jsonScore(b.value) - jsonScore(a.value));
  return candidates[0].value;
}

async function spawnCli(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('即梦 CLI 执行超时。'));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `exit=${code}`).slice(0, 1000)));
        return;
      }
      resolve(extractJson(`${stdout}\n${stderr}`));
    });
  });
}

async function runCli(provider, args, options = {}, extraTimeout = 120) {
  if (options.runCli) return options.runCli(cleanExecutablePath(provider) || 'dreamina', args);
  const exe = cleanExecutablePath(provider);
  if (!exe) throw new Error('请先填写 dreamina / 即梦 CLI 可执行路径。');
  if (provider?.jimengConfig?.useWsl) {
    const prefix = cliCommand(provider);
    const line = `${shQuote(prefix.dreamina || 'dreamina')} ${args.map((arg) => shQuote(arg)).join(' ')}`;
    return spawnCli(prefix.command, [...prefix.argsPrefix, line], (pollSeconds(provider) + extraTimeout) * 1000);
  }
  return spawnCli(exe, args, (pollSeconds(provider) + extraTimeout) * 1000);
}

function parseEmbeddedJson(value) {
  const text = String(value || '').trim();
  if (!/^[\[{]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const MEDIA_VALUE_RE = /^(https?:\/\/|file:\/\/|[A-Za-z]:\\|\/files\/output\/|\/output\/|\/assets\/|\/|.*\.(?:png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v)(?:\?|#)?$)/i;

function collectOutputs(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const text = value.trim();
    const parsed = parseEmbeddedJson(text);
    if (parsed) collectOutputs(parsed, out);
    else if (MEDIA_VALUE_RE.test(text)) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectOutputs(item, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const key of [
    'url', 'urls', 'image', 'images', 'image_url', 'image_urls',
    'video', 'videos', 'video_url', 'video_urls', 'output', 'outputs',
    'result', 'results', 'file', 'files', 'path', 'paths',
    'download_url', 'download_urls', 'downloadUrl', 'file_path', 'filePath', 'result_json',
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) collectOutputs(value[key], out);
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') collectOutputs(item, out);
  }
  return out;
}

function outputValues(raw) {
  const values = [];
  collectOutputs(raw, values);
  const out = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function submitId(raw) {
  const found = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['submit_id', 'submitid', 'task_id', 'taskid'].includes(String(key).toLowerCase()) && item) found.push(String(item));
      else visit(item);
    }
  };
  visit(raw);
  return found[0] || '';
}

function failureReason(raw) {
  const found = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    const status = String(value.gen_status || value.status || '').trim().toLowerCase();
    const reason = value.fail_reason || value.failReason || value.error || value.message || value.msg;
    const reasonText = String(reason || '').trim();
    if (
      reasonText
      && (
        ['fail', 'failed', 'error'].includes(status)
        || /fail|error|invalid param|aigccompliance|confirmation|required/i.test(reasonText)
      )
    ) {
      found.push(reasonText);
    }
    for (const item of Object.values(value)) {
      if (item && (typeof item === 'object' || Array.isArray(item))) visit(item);
    }
  };
  visit(raw);
  return found[0] || '';
}

function outputExtFromMime(mime, fallback) {
  const text = String(mime || '').toLowerCase();
  if (text.includes('mp4')) return '.mp4';
  if (text.includes('webm')) return '.webm';
  if (text.includes('quicktime')) return '.mov';
  if (text.includes('mpeg') || text.includes('mp3')) return '.mp3';
  if (text.includes('wav')) return '.wav';
  if (text.includes('ogg')) return '.ogg';
  if (text.includes('flac')) return '.flac';
  if (text.includes('jpeg')) return '.jpg';
  if (text.includes('webp')) return '.webp';
  if (text.includes('png')) return '.png';
  return fallback;
}

function defaultExtForKind(kind) {
  if (kind === 'video') return '.mp4';
  if (kind === 'audio') return '.mp3';
  return '.png';
}

function outputExtFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if (ext) return ext;
  } catch {
    // ignore non-url values
  }
  return fallback;
}

function writeTempMedia(buffer, ext, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-jimeng-ref-'));
  const filePath = path.join(dir, `media${ext || '.bin'}`);
  fs.writeFileSync(filePath, buffer);
  if (Array.isArray(options.tempPaths)) {
    options.tempPaths.push(filePath);
    options.tempPaths.push(dir);
  }
  return filePath;
}

async function mediaRefToTempFile(value, kind, options = {}) {
  const fallbackExt = defaultExtForKind(kind);
  const resolved = await resolveMediaRef(value, {
    target: 'url',
    baseUrl: options.baseUrl,
  });

  if (resolved.kind === 'data-url' && resolved.base64) {
    const ext = outputExtFromMime(resolved.mime, fallbackExt);
    return writeTempMedia(Buffer.from(resolved.base64, 'base64'), ext, options);
  }

  const url = resolved.url || mediaRefToAbsoluteUrl(value, options);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`无法解析本地媒体路径：${String(value || '').slice(0, 160)}`);
  }

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`即梦参考素材下载失败：HTTP ${response.status}`);
  }
  const contentType = typeof response.headers?.get === 'function' ? response.headers.get('content-type') : '';
  const ext = outputExtFromMime(contentType, outputExtFromUrl(url, fallbackExt));
  return writeTempMedia(Buffer.from(await response.arrayBuffer()), ext, options);
}

function cleanupTempPaths(paths) {
  for (const item of Array.isArray(paths) ? [...paths].reverse() : []) {
    try {
      if (!item) continue;
      if (fs.existsSync(item)) {
        const stat = fs.statSync(item);
        if (stat.isDirectory()) fs.rmSync(item, { recursive: true, force: true });
        else fs.unlinkSync(item);
      }
    } catch {
      // best effort cleanup
    }
  }
}

const MEDIA_EXTS_BY_KIND = {
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']),
  video: new Set(['.mp4', '.webm', '.mov', '.m4v']),
};

function windowsPathFromWsl(value) {
  const text = String(value || '');
  if (process.platform !== 'win32') return text;
  const match = text.match(/^\/mnt\/([a-z])\/(.+)$/i);
  if (!match) return text;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function outputUrlForLocalPath(value) {
  const localPath = path.resolve(windowsPathFromWsl(String(value || '')));
  const outputRoot = path.resolve(config.OUTPUT_DIR);
  if (localPath === outputRoot || !localPath.startsWith(`${outputRoot}${path.sep}`)) return '';
  return `/files/output/${encodeURIComponent(path.basename(localPath))}`;
}

async function defaultStoreOutput(value, kind, options = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('/files/output/')) return text;
  if (!fs.existsSync(config.OUTPUT_DIR)) fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const prefix = kind === 'video' ? 'jimeng_video' : 'jimeng';
  let ext = kind === 'video' ? '.mp4' : '.png';
  let buf = null;
  let localPath = text;
  if (text.startsWith('file://')) {
    localPath = decodeURIComponent(new URL(text).pathname || '');
    if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(localPath)) localPath = localPath.slice(1);
  }
  localPath = windowsPathFromWsl(localPath);
  if (/^https?:\/\//i.test(text)) {
    if (options.fetchImpl) {
      const res = await options.fetchImpl(text);
      if (!res.ok) throw new Error(`即梦结果下载失败：HTTP ${res.status}`);
      const contentType = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : '';
      ext = outputExtFromMime(contentType, ext);
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      const remote = await safeRemoteMediaFetch(text, {
        allowedKinds: [kind],
        trustedProviderOutput: true,
        maxBytes: kind === 'video' ? 1024 * 1024 * 1024 : 64 * 1024 * 1024,
        deadlineMs: 5 * 60 * 1000,
        idleTimeoutMs: 30 * 1000,
        maxRedirects: 4,
        userAgent: 'T8-PenguinCanvas-JimengCLI/1.0',
      });
      ext = outputExtFromMime(remote.contentType, ext);
      buf = remote.buffer;
    }
  } else if (fs.existsSync(localPath)) {
    const existingOutputUrl = outputUrlForLocalPath(localPath);
    if (existingOutputUrl) return existingOutputUrl;
    ext = path.extname(localPath) || ext;
    buf = fs.readFileSync(localPath);
  } else {
    return text;
  }
  const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(config.OUTPUT_DIR, filename), buf);
  return `/files/output/${filename}`;
}

async function resolveLocalMedia(value, kind, provider, options = {}) {
  if (options.resolveLocalMedia) return options.resolveLocalMedia(value, kind);
  try {
    const resolved = await resolveMediaRef(value, {
      target: 'local-path',
      baseUrl: options.baseUrl,
    });
    return wslPath(provider, resolved.path);
  } catch (err) {
    try {
      const tempPath = await mediaRefToTempFile(value, kind, options);
      return wslPath(provider, tempPath);
    } catch (downloadErr) {
      throw downloadErr?.message ? downloadErr : err;
    }
  }
}

async function queryResult(provider, id, kind, options = {}) {
  const args = [
    'query_result',
    `--submit_id=${id}`,
    `--download_dir=${wslPath(provider, config.OUTPUT_DIR)}`,
  ];
  return runCli(provider, args, options, 60);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortRaw(raw) {
  try {
    return JSON.stringify(raw).slice(0, 800);
  } catch {
    return String(raw || '').slice(0, 800);
  }
}

function downloadedOutputsForTask(id, kind, startedAt = 0) {
  if (!id || !fs.existsSync(config.OUTPUT_DIR)) return [];
  const extSet = MEDIA_EXTS_BY_KIND[kind] || MEDIA_EXTS_BY_KIND.image;
  const idText = String(id);
  const since = Number(startedAt) || 0;
  const files = fs.readdirSync(config.OUTPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(config.OUTPUT_DIR, entry.name);
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {
        return null;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!extSet.has(ext)) return null;
      if (!entry.name.includes(idText) && stat.mtimeMs < since - 1000) return null;
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.map((item) => item.filePath);
}

async function materializeOutputs(raw, kind, options = {}) {
  const failure = failureReason(raw);
  if (failure) throw new Error(`即梦生成失败：${failure}`);
  const values = outputValues(raw);
  const urls = [];
  for (const value of values) {
    const local = options.storeOutput
      ? await options.storeOutput(value, kind)
      : await defaultStoreOutput(value, kind, options);
    if (local && !urls.includes(local)) urls.push(local);
  }
  return urls;
}

async function storeOutputs(raw, kind, provider, options = {}, tracker = {}) {
  const startedAt = Date.now();
  tracker.pollCount = 0;
  tracker.lastRaw = raw;
  let urls = await materializeOutputs(raw, kind, options);
  if (urls.length) return urls;
  const id = submitId(raw);
  if (!id) {
    throw new Error(`即梦 CLI 未返回可用媒体结果：${shortRaw(raw)}`);
  }

  const deadline = startedAt + pollSeconds(provider) * 1000;
  const pollIntervalMs = options.pollIntervalMs === undefined
    ? 2000
    : Math.max(0, Number(options.pollIntervalMs) || 0);
  let lastRaw = raw;
  let lastStatus = '';
  let lastFailure = '';
  do {
    tracker.pollCount += 1;
    const queried = await queryResult(provider, id, kind, options);
    lastRaw = queried;
    tracker.lastRaw = queried;
    lastStatus = String(queried?.gen_status || queried?.status || '').trim();
    lastFailure = failureReason(queried);
    if (lastFailure) throw new Error(`即梦生成失败：${lastFailure}`);

    urls = await materializeOutputs(queried, kind, options);
    if (urls.length) return urls;

    const downloaded = downloadedOutputsForTask(id, kind, startedAt);
    for (const filePath of downloaded) {
      const local = options.storeOutput
        ? await options.storeOutput(filePath, kind)
        : await defaultStoreOutput(filePath, kind, options);
      if (local && !urls.includes(local)) urls.push(local);
    }
    if (urls.length) return urls;

    const normalizedStatus = lastStatus.toLowerCase();
    if (['fail', 'failed', 'error'].includes(normalizedStatus)) {
      throw new Error(`即梦生成失败：${shortRaw(queried)}`);
    }

    if (Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  } while (true);

  const suffix = lastStatus ? `，当前状态=${lastStatus}` : '';
  if (lastFailure) {
    throw new Error(`即梦生成失败：${lastFailure}`);
  }
  throw new Error(`即梦任务已提交但还没有可下载${kind === 'video' ? '视频' : '图片'}，submit_id=${id}${suffix}。稍后可用 dreamina query_result --submit_id=${id} --download_dir=${config.OUTPUT_DIR} 查询。原始返回：${shortRaw(lastRaw)}`);
}

async function resolveLocalMediaList(values, kind, provider, options = {}) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!value) continue;
    out.push(await resolveLocalMedia(value, kind, provider, options));
  }
  return out;
}

async function generateImage(provider, input = {}, options = {}) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return { ok: false, code: 'missing_prompt', providerId: provider.id, protocol: 'jimeng-cli', error: '请输入图像提示词。' };
  const model = selectedModel(input.providerModel || input.model, provider.imageModels, 'jimeng-image-2k');
  const refs = Array.isArray(input.images) ? input.images : [];
  const args = [];
  const tempPaths = [];
  const mediaOptions = { ...options, tempPaths };
  const tracker = { pollCount: 0, lastRaw: null };
  try {
    const resolutionType = imageResolution(model, input.size || '1024x1024', input);
    assertImageResolutionSupported(model, resolutionType);
    const customDimensions = imageCustomDimensions(input, resolutionType);
    if (refs.length) {
      if (refs.length > 10) throw new Error('即梦 CLI 图生图一次最多支持 10 张参考图。');
      const refPaths = await resolveLocalMediaList(refs, 'image', provider, mediaOptions);
      args.push('image2image', `--images=${refPaths.join(',')}`, `--prompt=${prompt}`);
    } else {
      args.push('text2image', `--prompt=${prompt}`);
      if (!customDimensions) args.push(`--ratio=${ratioFromSize(input.size || '1024x1024')}`);
    }
    const modelVersion = imageModelVersion(model);
    if (modelVersion) args.push(`--model_version=${modelVersion}`);
    if (customDimensions) args.push(`--width=${customDimensions.width}`, `--height=${customDimensions.height}`);
    const generateNum = imageGenerateNum(input);
    if (generateNum > 1) args.push(`--generate_num=${generateNum}`);
    args.push(`--resolution_type=${resolutionType}`, `--poll=${pollSeconds(provider)}`);
    const raw = await runCli(provider, args, options, 120);
    tracker.lastRaw = raw;
    const imageUrls = await storeOutputs(raw, 'image', provider, options, tracker);
    const finalRaw = tracker.lastRaw || raw;
    return { ok: true, kind: 'image', code: 'completed', providerId: provider.id, protocol: 'jimeng-cli', model, imageUrls, taskId: submitId(raw), raw: finalRaw, ...providerTrace(null, finalRaw, { pollCount: tracker.pollCount }) };
  } catch (e) {
    const finalRaw = tracker.lastRaw;
    return { ok: false, code: 'cli_failed', providerId: provider.id, protocol: 'jimeng-cli', model, taskId: submitId(finalRaw), error: e?.message || '即梦 CLI 调用失败。', ...providerTrace(null, finalRaw, { pollCount: tracker.pollCount }) };
  } finally {
    cleanupTempPaths(tempPaths);
  }
}

async function generateVideo(provider, input = {}, options = {}) {
  const prompt = String(input.prompt || '').trim();
  const model = selectedModel(input.providerModel || input.model, provider.videoModels, 'seedance2.0fast_vip');
  const modelVersion = videoModelVersion(model);
  const refs = Array.isArray(input.images) ? input.images : [];
  const videos = Array.isArray(input.videos) ? input.videos : [];
  const audios = Array.isArray(input.audios) ? input.audios : [];
  const duration = videoDuration(input.duration, model);
  const ratio = videoRatio(input.aspect_ratio || input.ratio);
  const args = [];
  const mode = videoMode(input);
  const isMultimodalRequest = videos.length > 0 || audios.length > 0 || (mode === 'omni' && refs.length > 0);
  if (!prompt && !isMultimodalRequest) {
    return { ok: false, code: 'missing_prompt', providerId: provider.id, protocol: 'jimeng-cli', error: '请输入视频提示词。' };
  }
  if (mode === 'multiframe' && modelVersion === JIMENG_SEEDANCE25_MODEL) {
    return {
      ok: false,
      code: 'jimeng_seedance25_multiframe_unsupported',
      providerId: provider.id,
      protocol: 'jimeng-cli',
      error: '即梦智能多帧使用固定模型，不能选择 Seedance 2.5；请改用全能参考、首帧或首尾帧模式。',
    };
  }
  if (mode === 'multiframe' && videos.length === 0 && audios.length === 0
    && (refs.length < 2 || refs.length > jimengCliCompatibility.intelligentMultiframe.images)) {
    return {
      ok: false,
      code: 'jimeng_multiframe_input_invalid',
      providerId: provider.id,
      protocol: 'jimeng-cli',
      error: `即梦智能多帧必须提供 2-${jimengCliCompatibility.intelligentMultiframe.images} 张图片。`,
    };
  }
  const tempPaths = [];
  const mediaOptions = { ...options, tempPaths };
  const tracker = { pollCount: 0, lastRaw: null };
  try {
    if (isMultimodalRequest) {
      const inputError = multimodalInputError(modelVersion, refs.length, videos.length, audios.length);
      if (inputError) {
        return { ok: false, code: 'jimeng_multimodal_input_invalid', providerId: provider.id, protocol: 'jimeng-cli', error: inputError };
      }
      const limits = multimodalLimits(modelVersion);
      const imagePaths = await resolveLocalMediaList(refs.slice(0, limits.images), 'image', provider, mediaOptions);
      const videoPaths = await resolveLocalMediaList(videos.slice(0, limits.videos), 'video', provider, mediaOptions);
      const audioPaths = await resolveLocalMediaList(audios.slice(0, limits.audios), 'audio', provider, mediaOptions);
      args.push('multimodal2video');
      if (prompt) args.push(`--prompt=${prompt}`);
      args.push(`--duration=${duration}`);
      if (ratio) args.push(`--ratio=${ratio}`);
      appendVideoModelResolutionArgs(args, 'multimodal2video', model, input.resolution);
      for (const p of imagePaths) args.push(`--image=${p}`);
      for (const p of videoPaths) args.push(`--video=${p}`);
      for (const p of audioPaths) args.push(`--audio=${p}`);
    } else if (mode === 'firstlast' && refs.length >= 2) {
      const firstPath = await resolveLocalMedia(refs[0], 'image', provider, mediaOptions);
      const lastPath = await resolveLocalMedia(refs[1], 'image', provider, mediaOptions);
      args.push('frames2video', `--first=${firstPath}`, `--last=${lastPath}`, `--prompt=${prompt}`, `--duration=${duration}`);
      appendVideoModelResolutionArgs(args, 'frames2video', model, input.resolution);
    } else if (mode === 'multiframe' && refs.length >= 2) {
      const paths = [];
      for (const ref of refs.slice(0, 20)) paths.push(await resolveLocalMedia(ref, 'image', provider, mediaOptions));
      args.push('multiframe2video', `--images=${paths.join(',')}`);
      appendVideoModelResolutionArgs(args, 'multiframe2video', model, input.resolution);
      if (paths.length === 2) {
        args.push(`--prompt=${prompt}`, `--duration=${transitionDuration(duration, 1)}`);
      } else {
        const each = transitionDuration(duration, paths.length - 1);
        for (let i = 0; i < paths.length - 1; i += 1) {
          args.push(`--transition-prompt=${prompt}`);
          args.push(`--transition-duration=${each}`);
        }
      }
    } else if (refs.length >= 1) {
      const refPath = await resolveLocalMedia(refs[0], 'image', provider, mediaOptions);
      args.push('image2video', `--image=${refPath}`, `--prompt=${prompt}`, `--duration=${duration}`);
      appendVideoModelResolutionArgs(args, 'image2video', model, input.resolution);
    } else {
      args.push('text2video', `--prompt=${prompt}`, `--duration=${duration}`, `--ratio=${ratio || '16:9'}`);
      appendVideoModelResolutionArgs(args, 'text2video', model, input.resolution);
    }
    args.push(`--poll=${pollSeconds(provider)}`);
    const raw = await runCli(provider, args, options, 180);
    tracker.lastRaw = raw;
    const videoUrls = await storeOutputs(raw, 'video', provider, options, tracker);
    const finalRaw = tracker.lastRaw || raw;
    return { ok: true, kind: 'video', code: 'completed', providerId: provider.id, protocol: 'jimeng-cli', model, videoUrls, taskId: submitId(raw), raw: finalRaw, ...providerTrace(null, finalRaw, { pollCount: tracker.pollCount }) };
  } catch (e) {
    const finalRaw = tracker.lastRaw;
    return { ok: false, code: 'cli_failed', providerId: provider.id, protocol: 'jimeng-cli', model, taskId: submitId(finalRaw), error: e?.message || '即梦 CLI 调用失败。', ...providerTrace(null, finalRaw, { pollCount: tracker.pollCount }) };
  } finally {
    cleanupTempPaths(tempPaths);
  }
}

async function testProvider(provider, options = {}) {
  const executablePath = cleanExecutablePath(provider);
  if (!executablePath) {
    return {
      ok: false,
      code: 'missing_cli_path',
      providerId: provider.id,
      protocol: 'jimeng-cli',
      error: '请先填写 dreamina / 即梦 CLI 可执行路径。',
    };
  }
  if (!(await providerCommandExists(executablePath, provider, options))) {
    return {
      ok: false,
      code: 'cli_not_found',
      providerId: provider.id,
      protocol: 'jimeng-cli',
      error: '未找到即梦 CLI，请检查路径或 PATH。',
    };
  }
  return {
    ok: true,
    code: options.dryRun ? 'dry_run_ok' : 'cli_found',
    providerId: provider.id,
    protocol: 'jimeng-cli',
    message: `即梦 CLI 路径可用；当前节点按 v${JIMENG_CLI_SUPPORTED_VERSION} 命令契约适配。`,
    supportedCliVersion: JIMENG_CLI_SUPPORTED_VERSION,
    supportedCliReleaseDate: JIMENG_CLI_SUPPORTED_RELEASE_DATE,
  };
}

module.exports = {
  generateImage,
  generateVideo,
  testProvider,
};
