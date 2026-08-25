export type VolcengineAssetKind = 'image' | 'video' | 'audio';
export type VolcengineAssetStatus = 'active' | 'processing' | 'failed';

export interface VolcengineAssetGroup {
  id: string;
  name: string;
  description: string;
}

export interface VolcengineAssetItem {
  id: string;
  name: string;
  kind: VolcengineAssetKind;
  status: VolcengineAssetStatus;
  assetUri: string;
  previewUrl: string;
  tags: string[];
}

function text(value: unknown, maxLength = 512) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function resultItems(payload: any): any[] {
  const result = payload?.Result ?? payload?.result ?? payload?.data ?? payload ?? {};
  const items = result?.Items ?? result?.items ?? result?.Assets ?? result?.assets ?? [];
  return Array.isArray(items) ? items : [];
}

function normalizeKind(value: unknown): VolcengineAssetKind {
  const kind = text(value, 32).toLowerCase();
  if (kind.includes('video')) return 'video';
  if (kind.includes('audio')) return 'audio';
  return 'image';
}

function normalizeStatus(value: unknown): VolcengineAssetStatus {
  const status = text(value, 32).toLowerCase();
  if (status === 'active' || status === 'success' || status === 'completed') return 'active';
  if (status === 'failed' || status === 'error') return 'failed';
  return 'processing';
}

function normalizeTags(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.map((item) => text(item, 32)).filter(Boolean))].slice(0, 12);
}

export function normalizeVolcengineAssetGroups(payload: unknown): VolcengineAssetGroup[] {
  return resultItems(payload).map((raw) => {
    const item = raw?.AssetGroup ?? raw?.assetGroup ?? raw;
    return {
      id: text(item?.Id ?? item?.id, 256),
      name: text(item?.Name ?? item?.name, 128),
      description: text(item?.Description ?? item?.description, 512),
    };
  }).filter((item) => item.id);
}

export function normalizeVolcengineAssetItems(
  payload: unknown,
  tagsById: Record<string, string[]> = {},
): VolcengineAssetItem[] {
  return resultItems(payload).map((raw) => {
    const item = raw?.Asset ?? raw?.asset ?? raw;
    const id = text(item?.Id ?? item?.AssetId ?? item?.id ?? item?.assetId, 256);
    return {
      id,
      name: text(item?.Name ?? item?.name, 128) || id,
      kind: normalizeKind(item?.AssetType ?? item?.Type ?? item?.assetType ?? item?.type),
      status: normalizeStatus(item?.Status ?? item?.status),
      assetUri: id ? `asset://${id}` : '',
      previewUrl: text(item?.PreviewUrl ?? item?.TosUrl ?? item?.URL ?? item?.Url ?? item?.previewUrl ?? item?.url, 4096),
      tags: normalizeTags(tagsById[id] ?? item?.Tags ?? item?.tags),
    };
  }).filter((item) => item.id);
}

function typedOutput(kind: VolcengineAssetKind, urls: string[]) {
  if (kind === 'video') return { videoUrl: urls[0] || '', videoUrls: urls };
  if (kind === 'audio') return { audioUrl: urls[0] || '', audioUrls: urls };
  return { imageUrl: urls[0] || '', imageUrls: urls };
}

export function buildVolcengineAssetsNodeOutput(assets: VolcengineAssetItem[]) {
  const selectedAssets = assets
    .filter((item) => item.status === 'active' && /^asset:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/i.test(item.assetUri))
    .slice(0, 15)
    .map(({ id, name, kind, status, assetUri, tags }) => ({ id, name, kind, status, assetUri, tags: normalizeTags(tags) }));
  const urls = (kind: VolcengineAssetKind) => selectedAssets.filter((item) => item.kind === kind).map((item) => item.assetUri);
  const image = typedOutput('image', urls('image'));
  const video = typedOutput('video', urls('video'));
  const audio = typedOutput('audio', urls('audio'));
  return {
    selectedAssets,
    outputs: { image, video, audio },
    ...image,
    ...video,
    ...audio,
  };
}
