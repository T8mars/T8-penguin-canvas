import type { Node } from '@xyflow/react';

export type VolcengineAssetKind = 'image' | 'video' | 'audio';
export type VolcengineAssetStatus = 'active' | 'processing' | 'failed';
export type VolcengineAssetImportJobStatus = 'submitted' | 'processing' | 'active' | 'failed';

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

export interface VolcengineAssetImportJob {
  id: string;
  profileId: string;
  projectName: string;
  kind: 'Image' | 'Video' | 'Audio';
  name: string;
  assetId: string;
  assetUri: string;
  status: VolcengineAssetImportJobStatus;
  requestId: string;
  error: string;
  createdAt: string;
  updatedAt: string;
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

export function normalizeVolcengineAssetStatus(value: unknown): VolcengineAssetStatus {
  const status = text(value, 32).toLowerCase();
  if (status === 'active' || status === 'success' || status === 'completed') return 'active';
  if (status === 'failed' || status === 'error') return 'failed';
  return 'processing';
}

function normalizeTags(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.map((item) => text(item, 32)).filter(Boolean))].slice(0, 12);
}

export function normalizePersistedVolcengineAssets(value: unknown): VolcengineAssetItem[] {
  const items = Array.isArray(value) ? value : [];
  return items.map((item: any) => {
    const id = text(item?.id ?? item?.assetId, 256);
    return {
      id,
      name: text(item?.name, 128) || id,
      kind: normalizeKind(item?.kind),
      status: normalizeVolcengineAssetStatus(item?.status ?? 'Active'),
      assetUri: legacyAssetUri(item?.assetUri, id),
      previewUrl: '',
      tags: normalizeTags(item?.tags),
    };
  }).filter((item) => item.id && item.assetUri).slice(0, 15);
}

export function normalizeVolcengineAssetImportJob(value: unknown): VolcengineAssetImportJob | null {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const id = text(raw.id, 128);
  const projectName = text(raw.projectName, 128);
  const assetId = text(raw.assetId, 256);
  const statusValue = text(raw.status, 24).toLowerCase();
  if (!/^volcjob-[a-z0-9-]+$/i.test(id) || !projectName) return null;
  const status: VolcengineAssetImportJobStatus = statusValue === 'active' || statusValue === 'failed' || statusValue === 'submitted'
    ? statusValue
    : 'processing';
  const rawKind = text(raw.kind, 16);
  return {
    id,
    profileId: text(raw.profileId, 128) || 'volcengine',
    projectName,
    kind: rawKind === 'Video' || rawKind === 'Audio' ? rawKind : 'Image',
    name: text(raw.name, 128),
    assetId,
    assetUri: assetId ? `asset://${assetId}` : '',
    status,
    requestId: text(raw.requestId, 160),
    error: status === 'failed' ? text(raw.error, 500) : '',
    createdAt: text(raw.createdAt, 64),
    updatedAt: text(raw.updatedAt, 64),
  };
}

export function normalizeVolcengineAssetImportJobs(payload: unknown): VolcengineAssetImportJob[] {
  const root = (payload && typeof payload === 'object' ? payload : {}) as any;
  const values: unknown[] = Array.isArray(root.jobs) ? root.jobs : Array.isArray(root.data?.jobs) ? root.data.jobs : [];
  return values.map(normalizeVolcengineAssetImportJob).filter((job): job is VolcengineAssetImportJob => Boolean(job));
}

function legacyAssetUri(value: unknown, assetId: string) {
  const uri = text(value, 512);
  if (/^asset:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/i.test(uri)) return `asset://${uri.slice('asset://'.length)}`;
  return assetId ? `asset://${assetId}` : '';
}

export function migrateLegacyVolcengineAssetNodes(nodes: Node[]): { nodes: Node[]; changed: boolean } {
  let changed = false;
  const migrated = nodes.map((node) => {
    if (node.type !== 'volc-asset') return node;
    changed = true;
    const data = (node.data || {}) as Record<string, any>;
    const assetId = text(data.assetId, 256);
    const selectedAssets = Array.isArray(data.selectedAssets) && data.selectedAssets.length > 0
      ? data.selectedAssets.map((item: any) => {
          const id = text(item?.id ?? item?.assetId, 256);
          return {
            id,
            name: text(item?.name, 128) || id,
            kind: normalizeKind(item?.kind ?? data.kind),
            status: normalizeVolcengineAssetStatus(item?.status ?? data.status ?? 'Active'),
            assetUri: legacyAssetUri(item?.assetUri, id),
            tags: normalizeTags(item?.tags),
          };
        }).filter((item: any) => item.id && item.assetUri).slice(0, 15)
      : assetId ? [{
          id: assetId,
          name: text(data.name, 128) || assetId,
          kind: normalizeKind(data.kind),
          status: normalizeVolcengineAssetStatus(data.status ?? 'Active'),
          assetUri: legacyAssetUri(data.assetUri, assetId),
          tags: normalizeTags(data.tags),
        }] : [];
    return {
      ...node,
      type: 'volcengine-assets',
      data: {
        ...data,
        volcengineAssetsProfileId: text(data.volcengineAssetsProfileId ?? data.profileId, 128) || 'volcengine',
        volcengineAssetsProjectName: text(data.volcengineAssetsProjectName ?? data.projectName, 128),
        volcengineAssetsGroupId: text(data.volcengineAssetsGroupId ?? data.groupId, 256),
        volcengineAssetsPageNumber: Math.max(1, Number(data.volcengineAssetsPageNumber) || 1),
        ...buildVolcengineAssetsNodeOutput(selectedAssets as VolcengineAssetItem[]),
      },
    } as Node;
  });
  return { nodes: migrated, changed };
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
      status: normalizeVolcengineAssetStatus(item?.Status ?? item?.status),
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
    .filter((item) => /^asset:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/i.test(item.assetUri))
    .slice(0, 15)
    .map(({ id, name, kind, status, assetUri, tags }) => ({ id, name, kind, status, assetUri, tags: normalizeTags(tags) }));
  const urls = (kind: VolcengineAssetKind) => selectedAssets
    .filter((item) => item.status === 'active' && item.kind === kind)
    .map((item) => item.assetUri);
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
