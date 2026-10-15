import { fileNameFromUrl, type MediaKind } from './mediaCollection.ts';
import { normalizeMoodboard, type MoodboardLayout } from './materialMoodboard.ts';

export type MaterialSetKind = 'text' | 'image' | 'video' | 'audio';

export interface MaterialSetItem {
  id: string;
  kind: MaterialSetKind;
  url?: string;
  text?: string;
  name?: string;
  size?: number;
  mime?: string;
}

export type MaterialSetBuckets = Record<MaterialSetKind, MaterialSetItem[]>;

export const MATERIAL_SET_SCHEMA = 't8-material-set';

export interface MaterialSetBackup {
  schema: typeof MATERIAL_SET_SCHEMA;
  version: 1;
  title?: string;
  materialSetKind: MaterialSetKind;
  materialSetItems: MaterialSetItem[];
  exportedAt: string;
  materialMoodboard?: MoodboardLayout;
}

const KINDS: MaterialSetKind[] = ['text', 'image', 'video', 'audio'];

export function isMaterialSetKind(value: any): value is MaterialSetKind {
  return value === 'text' || value === 'image' || value === 'video' || value === 'audio';
}

export function makeMaterialSetItemId(kind: MaterialSetKind): string {
  return `ms-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function valueOfMaterialSetItem(item: MaterialSetItem): string {
  return item.kind === 'text' ? (item.text || '') : (item.url || '');
}

export function normalizeMaterialSetItem(raw: any, fallbackKind?: MaterialSetKind): MaterialSetItem | null {
  const kind = isMaterialSetKind(raw?.kind) ? raw.kind : fallbackKind;
  if (!kind) return null;
  const value = kind === 'text' ? String(raw?.text ?? raw?.url ?? '').trim() : String(raw?.url ?? '').trim();
  if (!value) return null;
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : makeMaterialSetItemId(kind),
    kind,
    ...(kind === 'text' ? { text: value } : { url: value }),
    name: typeof raw?.name === 'string' && raw.name ? raw.name : kind === 'text' ? value.slice(0, 24) : fileNameFromUrl(value),
    size: typeof raw?.size === 'number' ? raw.size : undefined,
    mime: typeof raw?.mime === 'string' ? raw.mime : undefined,
  };
}

export function normalizeMaterialSetItems(items: any[], kind: MaterialSetKind): MaterialSetItem[] {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeMaterialSetItem(item, kind))
    .filter(Boolean) as MaterialSetItem[];
}

function pushUnique(
  bucket: MaterialSetItem[],
  seen: Set<string>,
  kind: MaterialSetKind,
  value: any,
  meta?: Partial<MaterialSetItem>,
) {
  if (typeof value !== 'string') return;
  const s = value.trim();
  if (!s) return;
  const key = `${kind}:${s}`;
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push({
    id: makeMaterialSetItemId(kind),
    kind,
    ...(kind === 'text' ? { text: s } : { url: s }),
    name: meta?.name || (kind === 'text' ? s.slice(0, 24) : fileNameFromUrl(s)),
    size: meta?.size,
    mime: meta?.mime,
  });
}

export function collectMaterialSetBucketsFromData(data: any): MaterialSetBuckets {
  const buckets: MaterialSetBuckets = { text: [], image: [], video: [], audio: [] };
  const seen = new Set<string>();
  if (!data) return buckets;

  const explicitKind = isMaterialSetKind(data.materialSetKind) ? data.materialSetKind : undefined;
  if (explicitKind && Array.isArray(data.materialSetItems) && data.materialSetItems.length > 0) {
    for (const raw of data.materialSetItems) {
      const item = normalizeMaterialSetItem(raw, explicitKind);
      if (item) buckets[item.kind].push(item);
    }
    return buckets;
  }

  const names = Array.isArray(data.fileNames) ? data.fileNames : [];
  const sizes = Array.isArray(data.fileSizes) ? data.fileSizes : [];
  const mimes = Array.isArray(data.mimes) ? data.mimes : [];

  const textArrayFields = ['textSegments', 'segments', 'texts'];
  const textArrayField = textArrayFields.find((field) => Array.isArray(data[field]) && data[field].length > 0);
  if (textArrayField) {
    data[textArrayField].forEach((text: any, index: number) => {
      pushUnique(buckets.text, seen, 'text', text, { name: `文本 ${index + 1}` });
    });
  } else {
    pushUnique(buckets.text, seen, 'text', data.outputText);
    pushUnique(buckets.text, seen, 'text', data.reply);
    pushUnique(buckets.text, seen, 'text', data.prompt);
    pushUnique(buckets.text, seen, 'text', data.text);
  }

  const pushMedia = (kind: Exclude<MaterialSetKind, 'text'>, value: any, index = 0) => {
    pushUnique(buckets[kind], seen, kind, value, {
      name: names[index],
      size: sizes[index],
      mime: mimes[index],
    });
  };

  pushMedia('image', data.imageUrl, 0);
  for (const field of ['imageUrls', 'urls', 'generatedImages'] as const) {
    const arr = data[field];
    if (Array.isArray(arr)) arr.forEach((url: any, index: number) => pushMedia('image', url, index));
  }
  if (typeof data.firstFrameUrl === 'string') pushMedia('image', data.firstFrameUrl, 0);
  if (typeof data.lastFrameUrl === 'string') pushMedia('image', data.lastFrameUrl, 1);

  pushMedia('video', data.videoUrl, 0);
  if (Array.isArray(data.videoUrls)) data.videoUrls.forEach((url: any, index: number) => pushMedia('video', url, index));

  pushMedia('audio', data.audioUrl, 0);
  pushMedia('audio', data.audioUrl_1, 1);
  if (Array.isArray(data.audioUrls)) data.audioUrls.forEach((url: any, index: number) => pushMedia('audio', url, index));

  return buckets;
}

export function materialSetItemsToData(kind: MaterialSetKind, rawItems: MaterialSetItem[]): Record<string, any> {
  const items = normalizeMaterialSetItems(rawItems, kind);
  const values = items.map(valueOfMaterialSetItem).filter(Boolean);
  const first = values[0] || '';
  const base: Record<string, any> = {
    materialSetKind: kind,
    materialSetItems: items,
    text: '',
    prompt: '',
    outputText: '',
    textSegments: [],
    segments: [],
    texts: [],
    imageUrl: '',
    imageUrls: [],
    urls: [],
    generatedImages: [],
    videoUrl: '',
    videoUrls: [],
    audioUrl: '',
    audioUrl_1: '',
    audioUrls: [],
    fileName: items[0]?.name || '',
    fileNames: items.map((item) => item.name || (item.url ? fileNameFromUrl(item.url) : '')),
    fileSize: items[0]?.size || 0,
    fileSizes: items.map((item) => item.size || 0),
    mime: items[0]?.mime || '',
    mimes: items.map((item) => item.mime || ''),
  };

  if (kind === 'text') {
    base.text = values.join('\n\n');
    base.prompt = base.text;
    base.outputText = base.text;
    base.textSegments = values;
    base.segments = values;
    base.texts = values;
  } else if (kind === 'image') {
    base.imageUrl = first;
    base.imageUrls = values;
    base.urls = values;
  } else if (kind === 'video') {
    base.videoUrl = first;
    base.videoUrls = values;
  } else if (kind === 'audio') {
    base.audioUrl = first;
    base.audioUrls = values;
  }

  return base;
}

export function createMaterialSetBackup(
  kind: MaterialSetKind,
  rawItems: MaterialSetItem[],
  title = '',
  moodboard?: unknown,
): MaterialSetBackup {
  return {
    schema: MATERIAL_SET_SCHEMA,
    version: 1,
    title: title.trim() || `${kind}-material-set`,
    materialSetKind: kind,
    materialSetItems: normalizeMaterialSetItems(rawItems, kind),
    exportedAt: new Date().toISOString(),
    ...(moodboard ? { materialMoodboard: normalizeMoodboard(moodboard, rawItems) } : {}),
  };
}

export function parseMaterialSetBackup(raw: any): MaterialSetBackup | null {
  const body = raw && typeof raw === 'object' ? raw : {};
  const kind = isMaterialSetKind(body.materialSetKind) ? body.materialSetKind : undefined;
  if (body.schema !== MATERIAL_SET_SCHEMA || !kind) return null;
  const items = normalizeMaterialSetItems(body.materialSetItems, kind);
  if (items.length === 0) return null;
  return {
    schema: MATERIAL_SET_SCHEMA,
    version: 1,
    title: typeof body.title === 'string' ? body.title.slice(0, 120) : '',
    materialSetKind: kind,
    materialSetItems: items,
    exportedAt: typeof body.exportedAt === 'string' ? body.exportedAt : new Date().toISOString(),
    ...(body.materialMoodboard ? { materialMoodboard: normalizeMoodboard(body.materialMoodboard, items) } : {}),
  };
}

export function materialSetItemFromMedia(kind: Exclude<MediaKind, 'model3d'>, item: { url: string; name?: string; size?: number; mime?: string }): MaterialSetItem {
  return {
    id: makeMaterialSetItemId(kind),
    kind,
    url: item.url,
    name: item.name || fileNameFromUrl(item.url),
    size: item.size,
    mime: item.mime,
  };
}

export function materialSetItemFromText(text: string): MaterialSetItem | null {
  const value = text.trim();
  if (!value) return null;
  return {
    id: makeMaterialSetItemId('text'),
    kind: 'text',
    text: value,
    name: value.slice(0, 24),
  };
}

export function nonEmptyMaterialSetKinds(buckets: MaterialSetBuckets): MaterialSetKind[] {
  return KINDS.filter((kind) => buckets[kind].length > 0);
}
