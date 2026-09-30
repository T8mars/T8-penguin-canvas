import { extractRhFieldOptions } from './rhFieldOptions';

export type RhToolboxMediaKind = 'text' | 'image' | 'video' | 'audio';

export type RhToolboxUserParamKind = 'text' | 'number' | 'select' | 'boolean';
export type RhToolboxQuickSurface = 'image' | 'video' | 'text' | 'audio';
export type RhToolboxMajorCategoryId = 'image' | 'video' | 'audio' | 'model3d' | 'text';

export interface RhToolboxMajorCategory {
  id: RhToolboxMajorCategoryId;
  name: string;
  description: string;
  order: number;
}

export type RhToolboxOutputRole =
  | 'append-output'
  | 'replace-source'
  | 'text-only'
  | 'multi-output';

export interface RhToolboxCategory {
  id: string;
  name: string;
  parentId?: RhToolboxMajorCategoryId;
  description?: string;
  order?: number;
  icon?: string;
}

export interface RhToolboxInputMapping {
  key: string;
  label?: string;
  kind: RhToolboxMediaKind;
  rhNodeId: string;
  fieldName: string;
  required?: boolean;
  multiple?: boolean;
  maxItems?: number;
  defaultValue?: string;
  uploadAsset?: boolean;
  order?: number;
}

export interface RhToolboxFixedParam {
  rhNodeId: string;
  fieldName: string;
  value: string | number | boolean;
  valueType?: RhToolboxUserParamKind | RhToolboxMediaKind;
}

export interface RhToolboxUserParam {
  key: string;
  label: string;
  kind: RhToolboxUserParamKind;
  rhNodeId: string;
  fieldName: string;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  options?: Array<string | number>;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

export interface RhToolboxOutputMapping {
  key: string;
  label?: string;
  kind: RhToolboxMediaKind;
  role?: RhToolboxOutputRole;
}

export interface RhToolboxTool {
  id: string;
  title: string;
  description?: string;
  categoryId: string;
  webappId: string;
  rhSite?: 'cn' | 'intl';
  enabled?: boolean;
  order?: number;
  capabilities: string[];
  inputSchema: RhToolboxInputMapping[];
  outputSchema: RhToolboxOutputMapping[];
  fixedParams?: RhToolboxFixedParam[];
  userParams?: RhToolboxUserParam[];
  runtime?: {
    instanceType?: string;
    pollIntervalMs?: number;
    maxPolls?: number;
    fetchAppInfo?: boolean;
  };
  ui?: {
    icon?: string;
    showInNode?: boolean;
    showInImageEditor?: boolean;
    showInVideoEditor?: boolean;
    showInTextEditor?: boolean;
    showInAudioEditor?: boolean;
  };
  version?: number;
}

export interface RhToolboxManifest {
  schema: 't8-rh-toolbox-manifest';
  version: number;
  updatedAt?: string;
  categories: RhToolboxCategory[];
  tools: RhToolboxTool[];
}

export interface RhToolboxInputPools {
  texts?: string[];
  images?: string[];
  videos?: string[];
  audios?: string[];
}

export interface RhToolboxPickedInputs {
  values: Record<string, string | string[]>;
  missing: string[];
}

export interface RhToolboxNodeInfoItem {
  nodeId: string;
  fieldName: string;
  fieldValue: string | number | boolean;
  valueType?: string;
}

export interface RhToolboxOutputClassification {
  urls: string[];
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  textOutputs: string[];
}

export interface RhToolboxQuickAction {
  surface: RhToolboxQuickSurface;
  toolId: string;
  title: string;
  label: string;
  description?: string;
  enabled: boolean;
  reason?: string;
  categoryId: string;
  capabilities: string[];
  inputKinds: RhToolboxMediaKind[];
  outputKinds: RhToolboxMediaKind[];
}

const DEFAULT_CATEGORY_ID = 'general';

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i;
const TEXT_RE = /\.(txt|md|json|csv)(\?|$)/i;

export const RH_TOOLBOX_ALL_CATEGORY_ID = 'all';
export const RH_TOOLBOX_DEFAULT_POLL_INTERVAL_MS = 5000;
export const RH_TOOLBOX_DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000;
export const RH_TOOLBOX_DEFAULT_MAX_POLLS = Math.ceil(
  RH_TOOLBOX_DEFAULT_POLL_TIMEOUT_MS / RH_TOOLBOX_DEFAULT_POLL_INTERVAL_MS,
);
export const RH_SMART_TRANSLATION_TOOL_ID = 'translate-cutout-v1';
export const RH_SMART_TRANSLATION_WEBAPP_ID = '2084616885802463233';
export const RH_SMART_TRANSLATION_CATEGORY_ID = 'text-category-nfjhp';

export const RH_TOOLBOX_MAJOR_CATEGORIES: RhToolboxMajorCategory[] = [
  { id: 'image', name: '图像', description: '图像生成、编辑、修复和放大工具', order: 10 },
  { id: 'video', name: '视频', description: '视频生成、放大、插帧和剪辑工具', order: 20 },
  { id: 'audio', name: '音频', description: '音频生成、克隆、分离和增强工具', order: 30 },
  { id: 'model3d', name: '3D', description: '3D 模型、空间和模型处理工具', order: 40 },
  { id: 'text', name: '文本', description: '文本、提示词和结构化内容工具', order: 50 },
];

export const RH_TOOLBOX_MAJOR_CATEGORY_IDS = RH_TOOLBOX_MAJOR_CATEGORIES.map((category) => category.id);

export const RH_TOOLBOX_BUILTIN_CATEGORY_IDS = [
  'image-tools',
  'video-tools',
  'text-tools',
  'audio-tools',
  'model3d-tools',
] as const;

export function isRhToolboxBuiltinCategoryId(categoryId: unknown): boolean {
  const id = String(categoryId ?? '').trim();
  return RH_TOOLBOX_BUILTIN_CATEGORY_IDS.includes(id as any);
}

export const RH_TOOLBOX_QUICK_SURFACE_LABELS: Record<RhToolboxQuickSurface, string> = {
  image: '图像',
  video: '视频',
  text: '文本',
  audio: '音频',
};

const RH_TOOLBOX_SURFACE_CAPABILITY_PREFIX: Record<RhToolboxQuickSurface, string> = {
  image: 'image.',
  video: 'video.',
  text: 'text.',
  audio: 'audio.',
};

const RH_TOOLBOX_SURFACE_UI_FLAG: Record<RhToolboxQuickSurface, keyof NonNullable<RhToolboxTool['ui']>> = {
  image: 'showInImageEditor',
  video: 'showInVideoEditor',
  text: 'showInTextEditor',
  audio: 'showInAudioEditor',
};

export const RH_TOOLBOX_CAPABILITY_LABELS: Record<string, string> = {
  'image.cutout': '图像抠图',
  'image.edit': '图像编辑',
  'image.upscale': '图像放大',
  'image.expand': '图像扩图',
  'image.remove-subject': '消除主体',
  'image.restore': '图像修复',
  'image.background': '背景处理',
  'image.color': '色彩调整',
  'video.edit': '视频编辑',
  'video.upscale': '视频放大',
  'video.frame-interpolate': '视频插帧',
  'video.remove-bg': '视频去背景',
  'video.retime': '视频变速',
  'video.to-image': '视频取图',
  'text.expand': '文本扩写',
  'text.rewrite': '文本改写',
  'text.translate': '文本翻译',
  'text.prompt-enhance': '提示词增强',
  'text.summarize': '文本总结',
  'text.classify': '文本分类',
  'audio.clone': '音频克隆',
  'audio.tts': '文本转语音',
  'audio.separate': '音频分离',
  'audio.enhance': '音频增强',
  'audio.denoise': '音频降噪',
  'audio.music': '音乐生成',
};

function cleanId(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function cleanText(value: unknown, fallback = ''): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return raw.length > 160 ? raw.slice(0, 160) : raw;
}

export function normalizeRhToolboxMajorCategoryId(value: unknown): RhToolboxMajorCategoryId | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'image' || raw === 'images' || raw === 'img' || raw === 'photo' || raw === 'image-tools' || raw === '图像' || raw === '图片') return 'image';
  if (raw === 'video' || raw === 'videos' || raw === 'movie' || raw === 'video-tools' || raw === '视频') return 'video';
  if (raw === 'audio' || raw === 'sound' || raw === 'music' || raw === 'voice' || raw === 'audio-tools' || raw === '音频' || raw === '声音') return 'audio';
  if (raw === '3d' || raw === 'model3d' || raw === 'model-3d' || raw === 'models' || raw === '3d-tools' || raw === 'model3d-tools' || raw === '模型') return 'model3d';
  if (raw === 'text' || raw === 'texts' || raw === 'prompt' || raw === 'llm' || raw === 'text-tools' || raw === '文本' || raw === '文字') return 'text';
  return undefined;
}

function inferMajorCategoryFromText(value: unknown): RhToolboxMajorCategoryId | undefined {
  const raw = String(value ?? '').toLowerCase();
  if (!raw) return undefined;
  if (/3d|model|mesh|glb|gltf|模型|三维/.test(raw)) return 'model3d';
  if (/video|movie|film|motion|视频|影片|动效/.test(raw)) return 'video';
  if (/audio|sound|voice|music|tts|stt|音频|声音|音乐|语音/.test(raw)) return 'audio';
  if (/text|prompt|llm|word|caption|文本|文字|提示词/.test(raw)) return 'text';
  if (/image|img|photo|picture|visual|图像|图片|照片|视觉/.test(raw)) return 'image';
  return undefined;
}

export function getRhToolboxCategoryMajorId(category: Partial<RhToolboxCategory> | null | undefined): RhToolboxMajorCategoryId {
  return normalizeRhToolboxMajorCategoryId(category?.parentId)
    || normalizeRhToolboxMajorCategoryId((category as any)?.majorCategoryId)
    || normalizeRhToolboxMajorCategoryId((category as any)?.surface)
    || inferMajorCategoryFromText(`${category?.id || ''} ${category?.name || ''} ${category?.description || ''}`)
    || 'image';
}

function cleanCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const capability = String(item ?? '').trim();
    if (!capability || seen.has(capability)) continue;
    seen.add(capability);
    out.push(capability);
  }
  return out;
}

function normalizeKind(value: unknown): RhToolboxMediaKind {
  return value === 'image' || value === 'video' || value === 'audio' ? value : 'text';
}

function normalizeUserParamKind(value: unknown): RhToolboxUserParamKind {
  if (value === 'number' || value === 'select' || value === 'boolean') return value;
  return 'text';
}

function cleanRhNodeId(value: unknown): string {
  return String(value ?? '').trim().replace(/^#/, '');
}

type RhToolboxMappingLike = {
  key?: unknown;
  rhNodeId?: unknown;
  fieldName?: unknown;
};

function parseRhFieldData(value: unknown): any {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function numberFromUnknown(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function getRhToolboxNodeInfoFieldOptions(field: any): Array<string | number> | undefined {
  return extractRhFieldOptions(field) ?? undefined;
}

function rhNodeInfoFieldMeta(field: any): any {
  const parsed = parseRhFieldData(field?.fieldData);
  if (Array.isArray(parsed) && parsed[1] && typeof parsed[1] === 'object') return parsed[1];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return {};
}

export function getRhToolboxNodeInfoFieldNodeId(field: any): string {
  return cleanRhNodeId(field?.nodeId ?? field?.node_id ?? field?.id);
}

export function getRhToolboxNodeInfoFieldName(field: any): string {
  return cleanText(field?.fieldName ?? field?.field_name ?? field?.name ?? field?.key);
}

export function getRhToolboxNodeInfoFieldLabel(field: any): string {
  const name = getRhToolboxNodeInfoFieldName(field);
  return cleanText(
    field?.descriptionCn
      ?? field?.description
      ?? field?.descriptionEn
      ?? field?.label
      ?? field?.title
      ?? field?.displayName
      ?? name,
    name,
  );
}

export function getRhToolboxNodeInfoFieldDefaultValue(field: any, kind?: RhToolboxUserParamKind): string | number | boolean {
  const raw = field?.fieldValue ?? field?.defaultValue ?? field?.value ?? '';
  const resolved = Array.isArray(raw) ? raw[0] : raw;
  const resolvedKind = kind || inferRhToolboxNodeInfoParamKind(field);
  if (resolvedKind === 'number') {
    const n = numberFromUnknown(resolved);
    return n ?? String(resolved ?? '');
  }
  if (resolvedKind === 'boolean') {
    return resolved === true || resolved === 'true' || resolved === 1 || resolved === '1';
  }
  if (resolved && typeof resolved === 'object') return '';
  return String(resolved ?? '');
}

export function inferRhToolboxNodeInfoMediaKind(field: any): RhToolboxMediaKind {
  const haystack = [
    field?.fieldType,
    field?.valueType,
    field?.nodeName,
    getRhToolboxNodeInfoFieldName(field),
  ].map((value) => String(value ?? '')).join(' ').toLowerCase();
  if (/\bvideo\b|movie|film|视频/.test(haystack)) return 'video';
  if (/\baudio\b|sound|music|voice|音频|声音|音乐|语音/.test(haystack)) return 'audio';
  if (/\bimage\b|\bimg\b|photo|picture|loadimage|图像|图片|照片/.test(haystack)) return 'image';
  return 'text';
}

export function inferRhToolboxNodeInfoParamKind(field: any): RhToolboxUserParamKind {
  if (getRhToolboxNodeInfoFieldOptions(field)?.length) return 'select';
  const typeText = [
    field?.fieldType,
    field?.valueType,
    field?.nodeName,
    parseRhFieldData(field?.fieldData)?.[0],
  ].map((value) => String(value ?? '')).join(' ').toUpperCase();
  if (typeText.includes('BOOLEAN') || typeText.includes('BOOL')) return 'boolean';
  if (
    typeText.includes('NUMBER')
    || typeText.includes('FLOAT')
    || typeText.includes('DOUBLE')
    || typeText.includes('INTEGER')
    || /\bINT\b/.test(typeText)
  ) {
    return 'number';
  }
  if (typeText.includes('LIST') || typeText.includes('SELECT') || typeText.includes('DROPDOWN') || typeText.includes('ENUM')) return 'select';
  return 'text';
}

function isRhNodeInfoPromptLikeField(field: any): boolean {
  const text = [
    getRhToolboxNodeInfoFieldName(field),
    getRhToolboxNodeInfoFieldLabel(field),
    field?.description,
    field?.descriptionEn,
    field?.label,
    field?.title,
    field?.displayName,
  ].map((value) => String(value ?? '')).join(' ').toLowerCase();
  return /prompt|positive|negative|caption|description|instruction|query|text|content|提示词|提示|正向|负向|文本|文字|描述|内容/.test(text);
}

export function isRhToolboxNodeInfoUserParamField(field: any): boolean {
  const nodeId = getRhToolboxNodeInfoFieldNodeId(field);
  const name = getRhToolboxNodeInfoFieldName(field);
  if (!nodeId || !name) return false;
  if (inferRhToolboxNodeInfoMediaKind(field) !== 'text') return false;
  if (isRhNodeInfoPromptLikeField(field)) return false;
  const kind = inferRhToolboxNodeInfoParamKind(field);
  return kind === 'number' || kind === 'boolean' || kind === 'select' || kind === 'text';
}

function rhMappingSignature(row: RhToolboxMappingLike): string {
  return `${cleanRhNodeId(row.rhNodeId)}::${cleanText(row.fieldName)}`;
}

function uniqueRhUserParamKey(base: string, used: Set<string>): string {
  const cleaned = cleanId(base, 'param');
  if (!used.has(cleaned)) {
    used.add(cleaned);
    return cleaned;
  }
  for (let index = 2; index < 999; index += 1) {
    const next = `${cleaned}-${index}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
  const next = `${cleaned}-${Date.now().toString(36)}`;
  used.add(next);
  return next;
}

export function inferRhToolboxUserParamsFromNodeInfoList(
  fields: any[],
  existingMappings: RhToolboxMappingLike[] = [],
): RhToolboxUserParam[] {
  const mapped = new Set(existingMappings.map(rhMappingSignature).filter((item) => item !== '::'));
  const usedKeys = new Set(existingMappings.map((row) => cleanId(row.key, '')).filter(Boolean));
  const out: RhToolboxUserParam[] = [];

  for (const field of Array.isArray(fields) ? fields : []) {
    if (!isRhToolboxNodeInfoUserParamField(field)) continue;
    const nodeId = getRhToolboxNodeInfoFieldNodeId(field);
    const name = getRhToolboxNodeInfoFieldName(field);
    const signature = `${nodeId}::${name}`;
    if (mapped.has(signature)) continue;
    const kind = inferRhToolboxNodeInfoParamKind(field);
    const meta = rhNodeInfoFieldMeta(field);
    const options = kind === 'select' ? getRhToolboxNodeInfoFieldOptions(field) : undefined;
    const param: RhToolboxUserParam = {
      key: uniqueRhUserParamKey(`node-${nodeId}-${name}`, usedKeys),
      label: getRhToolboxNodeInfoFieldLabel(field),
      kind,
      rhNodeId: nodeId,
      fieldName: name,
      defaultValue: getRhToolboxNodeInfoFieldDefaultValue(field, kind),
      options,
      min: kind === 'number' ? numberFromUnknown(meta.min) : undefined,
      max: kind === 'number' ? numberFromUnknown(meta.max) : undefined,
      step: kind === 'number' ? numberFromUnknown(meta.step) : undefined,
      required: false,
    };
    out.push(param);
    mapped.add(signature);
  }

  return out;
}

function sortByOrderThenTitle<T extends { order?: number; title?: string; name?: string; id: string }>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const ao = Number.isFinite(a.order) ? Number(a.order) : 9999;
    const bo = Number.isFinite(b.order) ? Number(b.order) : 9999;
    if (ao !== bo) return ao - bo;
    return String(a.title || a.name || a.id).localeCompare(String(b.title || b.name || b.id), 'zh-Hans-CN');
  });
}

export function normalizeRhToolboxManifest(manifest: Partial<RhToolboxManifest> | null | undefined): RhToolboxManifest {
  const rawCategories = Array.isArray(manifest?.categories) ? manifest!.categories : [];
  const categories: RhToolboxCategory[] = [];
  const categoryIds = new Set<string>();

  for (const [index, item] of rawCategories.entries()) {
    const id = cleanId((item as any)?.id, `${DEFAULT_CATEGORY_ID}-${index + 1}`);
    if (categoryIds.has(id)) continue;
    categoryIds.add(id);
    categories.push({
      id,
      name: cleanText((item as any)?.name, id),
      parentId: getRhToolboxCategoryMajorId(item as any),
      description: cleanText((item as any)?.description),
      order: Number.isFinite((item as any)?.order) ? Number((item as any).order) : index,
      icon: cleanText((item as any)?.icon),
    });
  }

  if (categories.length === 0) {
    categoryIds.add(DEFAULT_CATEGORY_ID);
    categories.push({ id: DEFAULT_CATEGORY_ID, name: '通用工具', parentId: 'image', order: 0, icon: 'Wrench' });
  }

  const rawTools = Array.isArray(manifest?.tools) ? manifest!.tools : [];
  const toolIds = new Set<string>();
  const tools: RhToolboxTool[] = [];

  for (const [index, item] of rawTools.entries()) {
    const raw = item as any;
    const id = cleanId(raw?.id, `tool-${index + 1}`);
    if (toolIds.has(id)) continue;
    toolIds.add(id);
    const categoryId = categoryIds.has(cleanId(raw?.categoryId, ''))
      ? cleanId(raw?.categoryId, '')
      : categories[0].id;
    const inputSchema = Array.isArray(raw?.inputSchema)
      ? raw.inputSchema
          .map((entry: any, entryIndex: number): RhToolboxInputMapping | null => {
            const rhNodeId = cleanRhNodeId(entry?.rhNodeId);
            const fieldName = cleanText(entry?.fieldName);
            if (!rhNodeId || !fieldName) return null;
            return {
              key: cleanId(entry?.key, `${normalizeKind(entry?.kind)}-${entryIndex + 1}`),
              label: cleanText(entry?.label),
              kind: normalizeKind(entry?.kind),
              rhNodeId,
              fieldName,
              required: entry?.required !== false,
              multiple: entry?.multiple === true,
              maxItems: Number.isFinite(entry?.maxItems) ? Math.max(1, Math.floor(Number(entry.maxItems))) : undefined,
              defaultValue: entry?.defaultValue == null ? undefined : String(entry.defaultValue),
              uploadAsset: entry?.uploadAsset !== false,
              order: Number.isFinite(entry?.order) ? Number(entry.order) : entryIndex,
            };
          })
          .filter(Boolean) as RhToolboxInputMapping[]
      : [];
    const outputSchema = Array.isArray(raw?.outputSchema)
      ? raw.outputSchema
          .map((entry: any, entryIndex: number): RhToolboxOutputMapping => ({
            key: cleanId(entry?.key, `output-${entryIndex + 1}`),
            label: cleanText(entry?.label),
            kind: normalizeKind(entry?.kind),
            role: ['append-output', 'replace-source', 'text-only', 'multi-output'].includes(entry?.role)
              ? entry.role
              : 'append-output',
          }))
      : [];
    const fixedParams = Array.isArray(raw?.fixedParams)
      ? raw.fixedParams
          .map((entry: any): RhToolboxFixedParam | null => {
            const rhNodeId = cleanRhNodeId(entry?.rhNodeId);
            const fieldName = cleanText(entry?.fieldName);
            if (!rhNodeId || !fieldName) return null;
            return {
              rhNodeId,
              fieldName,
              value: entry?.value ?? '',
              valueType: entry?.valueType,
            };
          })
          .filter(Boolean) as RhToolboxFixedParam[]
      : [];
    const userParams = Array.isArray(raw?.userParams)
      ? raw.userParams
          .map((entry: any, entryIndex: number): RhToolboxUserParam | null => {
            const rhNodeId = cleanRhNodeId(entry?.rhNodeId);
            const fieldName = cleanText(entry?.fieldName);
            const label = cleanText(entry?.label);
            if (!rhNodeId || !fieldName || !label) return null;
            const kind = normalizeUserParamKind(entry?.kind);
            return {
              key: cleanId(entry?.key, `param-${entryIndex + 1}`),
              label,
              kind,
              rhNodeId,
              fieldName,
              defaultValue: entry?.defaultValue,
              placeholder: cleanText(entry?.placeholder),
              options: Array.isArray(entry?.options)
                ? entry.options.filter((v: any) => typeof v === 'string' || typeof v === 'number').slice(0, 80)
                : undefined,
              min: Number.isFinite(entry?.min) ? Number(entry.min) : undefined,
              max: Number.isFinite(entry?.max) ? Number(entry.max) : undefined,
              step: Number.isFinite(entry?.step) ? Number(entry.step) : undefined,
              required: entry?.required === true,
            };
          })
          .filter(Boolean) as RhToolboxUserParam[]
      : [];
    const webappId = cleanText(raw?.webappId);
    const pollIntervalMs = Number.isFinite(raw?.runtime?.pollIntervalMs)
      ? Math.max(1000, Number(raw.runtime.pollIntervalMs))
      : RH_TOOLBOX_DEFAULT_POLL_INTERVAL_MS;
    const minMaxPolls = Math.ceil(RH_TOOLBOX_DEFAULT_POLL_TIMEOUT_MS / Math.max(1, pollIntervalMs));
    const maxPolls = Number.isFinite(raw?.runtime?.maxPolls)
      ? Math.max(minMaxPolls, Math.floor(Number(raw.runtime.maxPolls)))
      : minMaxPolls;
    let normalizedTool: RhToolboxTool = {
      id,
      title: cleanText(raw?.title, id),
      description: cleanText(raw?.description),
      categoryId,
      webappId,
      rhSite: raw?.rhSite === 'intl' ? 'intl' : 'cn',
      enabled: raw?.enabled === true && !!webappId,
      order: Number.isFinite(raw?.order) ? Number(raw.order) : index,
      capabilities: cleanCapabilities(raw?.capabilities),
      inputSchema: inputSchema.slice().sort((a, b) => {
        const ao = Number.isFinite(a.order) ? Number(a.order) : 9999;
        const bo = Number.isFinite(b.order) ? Number(b.order) : 9999;
        if (ao !== bo) return ao - bo;
        return a.key.localeCompare(b.key);
      }),
      outputSchema,
      fixedParams,
      userParams,
      runtime: {
        instanceType: cleanText(raw?.runtime?.instanceType),
        pollIntervalMs,
        maxPolls,
        fetchAppInfo: raw?.runtime?.fetchAppInfo !== false,
      },
      ui: raw?.ui && typeof raw.ui === 'object'
        ? {
            icon: cleanText(raw.ui.icon),
            showInNode: raw.ui.showInNode !== false,
            showInImageEditor: raw.ui.showInImageEditor === true,
            showInVideoEditor: raw.ui.showInVideoEditor === true,
            showInTextEditor: raw.ui.showInTextEditor === true,
            showInAudioEditor: raw.ui.showInAudioEditor === true,
          }
        : { showInNode: true },
      version: Number.isFinite(raw?.version) ? Number(raw.version) : 1,
    };

    // 早期制作器把智能翻译 WebApp 误推断成 image.cutout / image 输出。
    // 以已确认的 WebApp ID 收敛为唯一文本合同，使旧持久化清单升级后也能
    // 立即被文本节点、LLM/Vision 与输出素材节点作为共享能力调用。
    if (webappId === RH_SMART_TRANSLATION_WEBAPP_ID) {
      normalizedTool = {
        ...normalizedTool,
        title: '智能翻译',
        description: '自动识别中英文并互译，其他语言默认翻译为中文',
        order: 60,
        categoryId: categoryIds.has(RH_SMART_TRANSLATION_CATEGORY_ID)
          ? RH_SMART_TRANSLATION_CATEGORY_ID
          : normalizedTool.categoryId,
        capabilities: ['text.translate'],
        inputSchema: [{
          key: 'prompt',
          label: '待翻译文本',
          kind: 'text',
          rhNodeId: '5',
          fieldName: 'prompt',
          required: true,
          multiple: false,
          uploadAsset: false,
          order: 0,
        }],
        outputSchema: [{
          key: 'output-text',
          label: '翻译结果',
          kind: 'text',
          role: 'text-only',
        }],
        fixedParams: [],
        userParams: [],
        ui: {
          icon: 'Languages',
          showInNode: true,
          showInImageEditor: false,
          showInVideoEditor: false,
          showInTextEditor: true,
          showInAudioEditor: false,
        },
      };
    }
    tools.push(normalizedTool);
  }

  return {
    schema: 't8-rh-toolbox-manifest',
    version: Number.isFinite(manifest?.version) ? Number(manifest!.version) : 1,
    updatedAt: cleanText(manifest?.updatedAt),
    categories: sortByOrderThenTitle(categories as any) as RhToolboxCategory[],
    tools: sortByOrderThenTitle(tools),
  };
}

function compactRhToolboxIdentity(value: unknown): string {
  return String(value ?? '').trim().replace(/[\s\u200b-\u200f\ufeff]+/g, '').toLowerCase();
}

function rhToolboxToolIdentityKeys(tool: RhToolboxTool): string[] {
  const keys = new Set<string>();
  const id = compactRhToolboxIdentity(tool.id);
  const title = compactRhToolboxIdentity(tool.title);
  const webappId = compactRhToolboxIdentity(tool.webappId);
  const rhSite = tool.rhSite === 'intl' ? 'intl' : 'cn';
  if (id) keys.add(`id:${rhSite}:${id}`);
  if (title) keys.add(`title:${rhSite}:${title}`);
  if (webappId) keys.add(`webapp:${rhSite}:${webappId}`);
  return Array.from(keys);
}

function putRhToolboxToolByIdentity(
  toolMap: Map<string, RhToolboxTool>,
  identityToToolId: Map<string, string>,
  tool: RhToolboxTool,
) {
  const keys = rhToolboxToolIdentityKeys(tool);
  for (const key of keys) {
    const existingId = identityToToolId.get(key);
    if (existingId && existingId !== tool.id) {
      toolMap.delete(existingId);
    }
  }
  toolMap.set(tool.id, tool);
  for (const key of keys) identityToToolId.set(key, tool.id);
}

export function mergeRhToolboxManifests(
  baseManifest: Partial<RhToolboxManifest> | null | undefined,
  overlayManifest?: Partial<RhToolboxManifest> | null | undefined,
): RhToolboxManifest {
  const base = normalizeRhToolboxManifest(baseManifest);
  const overlayCategoryCount = Array.isArray(overlayManifest?.categories) ? overlayManifest!.categories.length : 0;
  const overlayToolCount = Array.isArray(overlayManifest?.tools) ? overlayManifest!.tools.length : 0;
  if (overlayCategoryCount === 0 && overlayToolCount === 0) return base;
  const overlay = normalizeRhToolboxManifest(overlayManifest);

  const categoryMap = new Map<string, RhToolboxCategory>();
  for (const category of base.categories) categoryMap.set(category.id, category);
  for (const category of overlay.categories) categoryMap.set(category.id, category);

  const toolMap = new Map<string, RhToolboxTool>();
  const identityToToolId = new Map<string, string>();
  for (const tool of base.tools) putRhToolboxToolByIdentity(toolMap, identityToToolId, tool);
  for (const tool of overlay.tools) putRhToolboxToolByIdentity(toolMap, identityToToolId, tool);

  const merged = normalizeRhToolboxManifest({
    schema: 't8-rh-toolbox-manifest',
    version: Math.max(base.version || 1, overlay.version || 1),
    updatedAt: overlay.updatedAt || base.updatedAt,
    categories: Array.from(categoryMap.values()),
    tools: Array.from(toolMap.values()),
  });
  return {
    ...merged,
    categories: sortByOrderThenTitle(merged.categories as any) as RhToolboxCategory[],
    tools: sortByOrderThenTitle(merged.tools),
  };
}

export function listRhToolboxTools(
  manifest: Partial<RhToolboxManifest> | null | undefined,
  options: { includeDisabled?: boolean } = {},
): RhToolboxTool[] {
  const normalized = normalizeRhToolboxManifest(manifest);
  return normalized.tools.filter((tool) => options.includeDisabled || tool.enabled !== false);
}

export function findRhToolboxToolById(
  manifest: Partial<RhToolboxManifest> | null | undefined,
  toolId: string,
  options: { includeDisabled?: boolean } = {},
): RhToolboxTool | undefined {
  return listRhToolboxTools(manifest, options).find((tool) => tool.id === toolId);
}

export function filterRhToolboxTools(
  manifest: Partial<RhToolboxManifest> | null | undefined,
  filters: {
    query?: string;
    majorCategoryId?: RhToolboxMajorCategoryId | typeof RH_TOOLBOX_ALL_CATEGORY_ID;
    categoryId?: string;
    capability?: string;
    kind?: RhToolboxMediaKind;
    includeDisabled?: boolean;
  } = {},
): RhToolboxTool[] {
  const q = String(filters.query || '').trim().toLowerCase();
  const normalized = normalizeRhToolboxManifest(manifest);
  const tools = normalized.tools.filter((tool) => filters.includeDisabled || tool.enabled !== false);
  return tools.filter((tool) => {
    const toolMajorCategoryId = getRhToolboxToolMajorCategory(tool, normalized.categories);
    if (filters.majorCategoryId && filters.majorCategoryId !== RH_TOOLBOX_ALL_CATEGORY_ID && toolMajorCategoryId !== filters.majorCategoryId) {
      return false;
    }
    if (filters.categoryId && filters.categoryId !== RH_TOOLBOX_ALL_CATEGORY_ID && tool.categoryId !== filters.categoryId) {
      return false;
    }
    if (filters.capability && !tool.capabilities.includes(filters.capability)) return false;
    if (filters.kind && !tool.inputSchema.some((input) => input.kind === filters.kind)) return false;
    if (!q) return true;
    const haystack = [
      tool.title,
      tool.description,
      tool.id,
      tool.capabilities.join(' '),
      tool.capabilities.map((cap) => RH_TOOLBOX_CAPABILITY_LABELS[cap] || '').join(' '),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

export function getRhToolboxToolMajorCategory(
  tool: Partial<RhToolboxTool> | null | undefined,
  categories: RhToolboxCategory[] = [],
): RhToolboxMajorCategoryId {
  const category = categories.find((item) => item.id === tool?.categoryId);
  if (category) return getRhToolboxCategoryMajorId(category);
  const capabilityMajor = (tool?.capabilities || [])
    .map((capability) => inferMajorCategoryFromText(capability))
    .find(Boolean);
  if (capabilityMajor) return capabilityMajor;
  const outputKinds = (tool?.outputSchema || []).map((output) => output.kind);
  const inputKinds = (tool?.inputSchema || []).map((input) => input.kind);
  const kinds = [...outputKinds, ...inputKinds];
  if (kinds.includes('video')) return 'video';
  if (kinds.includes('audio')) return 'audio';
  if (kinds.includes('text')) return 'text';
  return 'image';
}

export function buildRhToolboxQuickActions(
  manifest: Partial<RhToolboxManifest> | null | undefined,
  surface: RhToolboxQuickSurface,
  options: { includeDisabled?: boolean } = {},
): RhToolboxQuickAction[] {
  const uiFlag = RH_TOOLBOX_SURFACE_UI_FLAG[surface];
  const capabilityPrefix = RH_TOOLBOX_SURFACE_CAPABILITY_PREFIX[surface];
  return listRhToolboxTools(manifest, { includeDisabled: true })
    .filter((tool) => {
      const surfaceEnabled = tool.ui?.[uiFlag] === true;
      const capabilityEnabled = tool.capabilities.some((capability) => capability.startsWith(capabilityPrefix));
      return surfaceEnabled || capabilityEnabled;
    })
    .filter((tool) => options.includeDisabled || tool.enabled !== false)
    .map((tool) => {
      const enabled = tool.enabled !== false && !!tool.webappId;
      return {
        surface,
        toolId: tool.id,
        title: tool.title,
        label: tool.title,
        description: tool.description,
        enabled,
        reason: enabled ? undefined : '待维护者配置 WebApp ID 后启用',
        categoryId: tool.categoryId,
        capabilities: tool.capabilities,
        inputKinds: Array.from(new Set(tool.inputSchema.map((input) => input.kind))),
        outputKinds: Array.from(new Set(tool.outputSchema.map((output) => output.kind))),
      };
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

export function pickRhToolboxInputs(tool: RhToolboxTool, pools: RhToolboxInputPools): RhToolboxPickedInputs {
  const values: Record<string, string | string[]> = {};
  const missing: string[] = [];
  const kindPools: Record<RhToolboxMediaKind, string[]> = {
    text: (pools.texts || []).filter(Boolean),
    image: (pools.images || []).filter(Boolean),
    video: (pools.videos || []).filter(Boolean),
    audio: (pools.audios || []).filter(Boolean),
  };
  const cursors: Record<RhToolboxMediaKind, number> = { text: 0, image: 0, video: 0, audio: 0 };

  for (const input of tool.inputSchema) {
    const pool = kindPools[input.kind] || [];
    const start = cursors[input.kind] || 0;
    const maxItems = Math.max(1, input.maxItems || 1);
    const selected = input.multiple ? pool.slice(start, start + maxItems) : pool.slice(start, start + 1);
    cursors[input.kind] = start + Math.max(1, selected.length);
    if (selected.length > 0) {
      values[input.key] = input.multiple ? selected : selected[0];
      continue;
    }
    if (input.defaultValue != null && input.defaultValue !== '') {
      values[input.key] = input.defaultValue;
      continue;
    }
    if (input.required) {
      missing.push(input.label || input.key);
    }
  }

  return { values, missing };
}

export function rhToolboxFieldKey(nodeId: string, fieldName: string): string {
  return `${nodeId}::${fieldName}`;
}

function pushNodeInfo(
  out: RhToolboxNodeInfoItem[],
  item: RhToolboxNodeInfoItem,
  seen: Map<string, number>,
) {
  const key = rhToolboxFieldKey(item.nodeId, item.fieldName);
  const existingIndex = seen.get(key);
  if (existingIndex != null) {
    out[existingIndex] = item;
    return;
  }
  seen.set(key, out.length);
  out.push(item);
}

function coerceFieldValue(value: any, valueType?: string): string | number | boolean {
  if (valueType === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : String(value ?? '');
  }
  if (valueType === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  if (Array.isArray(value)) return String(value[0] ?? '');
  return value as any;
}

function hasOwnValue(record: Record<string, string | number | boolean>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeRhSelectComparable(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/：/g, ':')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function extractRhDimensions(value: unknown): string | undefined {
  const match = String(value ?? '').match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
  return match ? `${match[1]}x${match[2]}` : undefined;
}

function extractRhRatio(value: unknown): string | undefined {
  const match = String(value ?? '').replace(/：/g, ':').match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

function matchRhSelectOptionValue(
  param: RhToolboxUserParam,
  value: string | number | boolean,
): string | number | undefined {
  const options = param.options || [];
  if (options.length === 0) return value === true || value === false ? String(value) : value;
  const direct = options.find((option) => option === value || String(option) === String(value ?? '').trim());
  if (direct != null) return direct;

  const normalizedValue = normalizeRhSelectComparable(value);
  const normalized = options.find((option) => normalizeRhSelectComparable(option) === normalizedValue);
  if (normalized != null) return normalized;

  const dimensions = extractRhDimensions(value);
  if (dimensions) {
    const byDimensions = options.find((option) => normalizeRhSelectComparable(option).includes(dimensions.toLowerCase()));
    if (byDimensions != null) return byDimensions;
  }

  const ratio = extractRhRatio(value);
  if (ratio) {
    const byRatio = options.find((option) => normalizeRhSelectComparable(option).includes(ratio));
    if (byRatio != null) return byRatio;
  }

  return undefined;
}

function semanticKeysForUserParam(param: RhToolboxUserParam): string[] {
  const keys = [
    param.key,
    param.fieldName,
    `${param.rhNodeId}-${param.fieldName}`,
    rhToolboxFieldKey(param.rhNodeId, param.fieldName),
  ].filter(Boolean);
  const haystack = `${param.key} ${param.label} ${param.fieldName}`.toLowerCase();
  if (/aspect|ratio|比例/.test(haystack)) keys.push('aspect_ratio', 'aspectRatio', 'ratio');
  if (/扩图|选择尺寸|target.*size|output.*size|outpaint|uncrop|尺寸/.test(haystack)) {
    keys.push('expand_size', 'target_size', 'output_size');
  }
  if (/resolution|分辨率|尺寸|size/.test(haystack)) keys.push('resolution', 'size', 'aspectRatio', 'aspect_ratio', 'ratio');
  if (/(^|[^a-z])width([^a-z]|$)|宽度|自定义\(宽\)|\b宽\b/.test(haystack)) keys.push('width', 'w');
  if (/(^|[^a-z])height([^a-z]|$)|高度|自定义\(高\)|\b高\b/.test(haystack)) keys.push('height', 'h');
  if (/longest|long\s*side|最长边|长边/.test(haystack)) keys.push('longest_side', 'longestSide');
  return Array.from(new Set(keys));
}

function readRhToolboxUserParamValue(
  param: RhToolboxUserParam,
  userParamValues: Record<string, string | number | boolean>,
): string | number | boolean | undefined {
  for (const key of semanticKeysForUserParam(param)) {
    if (!hasOwnValue(userParamValues, key)) continue;
    const value = userParamValues[key];
    if (param.kind === 'select') {
      const matched = matchRhSelectOptionValue(param, value);
      if (matched != null) return matched;
      continue;
    }
    return value;
  }
  return undefined;
}

export function buildRhToolboxNodeInfoList(
  tool: RhToolboxTool,
  options: {
    inputValues?: Record<string, string | string[]>;
    userParamValues?: Record<string, string | number | boolean>;
  } = {},
): RhToolboxNodeInfoItem[] {
  const out: RhToolboxNodeInfoItem[] = [];
  const seen = new Map<string, number>();
  const inputValues = options.inputValues || {};
  const userParamValues = options.userParamValues || {};

  for (const input of tool.inputSchema) {
    const raw = inputValues[input.key] ?? input.defaultValue ?? '';
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value == null || value === '') continue;
    pushNodeInfo(out, {
      nodeId: input.rhNodeId,
      fieldName: input.fieldName,
      fieldValue: String(value),
      valueType: input.kind,
    }, seen);
  }

  for (const param of tool.userParams || []) {
    const explicit = readRhToolboxUserParamValue(param, userParamValues);
    const raw = explicit ?? param.defaultValue;
    if (raw == null || raw === '') {
      if (!param.required) continue;
    }
    pushNodeInfo(out, {
      nodeId: param.rhNodeId,
      fieldName: param.fieldName,
      fieldValue: coerceFieldValue(raw ?? '', param.kind),
      valueType: param.kind,
    }, seen);
  }

  for (const fixed of tool.fixedParams || []) {
    pushNodeInfo(out, {
      nodeId: fixed.rhNodeId,
      fieldName: fixed.fieldName,
      fieldValue: coerceFieldValue(fixed.value, fixed.valueType),
      valueType: fixed.valueType,
    }, seen);
  }

  return out;
}

export function classifyRhToolboxOutputs(urls: string[]): RhToolboxOutputClassification {
  const cleanUrls = (Array.isArray(urls) ? urls : []).map((url) => String(url || '').trim()).filter(Boolean);
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const audioUrls: string[] = [];
  const textOutputs: string[] = [];

  for (const url of cleanUrls) {
    if (IMAGE_RE.test(url)) imageUrls.push(url);
    else if (VIDEO_RE.test(url)) videoUrls.push(url);
    else if (AUDIO_RE.test(url)) audioUrls.push(url);
    else if (TEXT_RE.test(url) || !/^https?:\/\//i.test(url)) textOutputs.push(url);
    else imageUrls.push(url);
  }

  return { urls: cleanUrls, imageUrls, videoUrls, audioUrls, textOutputs };
}
