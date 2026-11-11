import type { GenerationHistoryOutput } from '../types/generationHistory';
import type { AssetRef, CanvasPatch } from '../types/project';
import { createUploadDataFromItems } from './mediaCollection';
import { frozenAssetMediaUrl } from './frozenAssetMedia';

export function createGenerationHistoryPlacementPatch(asset: AssetRef, input: {
  projectId: string; canvasId: string; baseRevision: number;
  position: { x: number; y: number }; id: string;
}): CanvasPatch {
  if (asset.projectId !== input.projectId || !asset.sourceUrl || !['image', 'video', 'audio', 'model3d'].includes(asset.kind)
    || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1) throw new Error('历史素材放置参数无效');
  const kind = asset.kind as 'image' | 'video' | 'audio' | 'model3d';
  return {
    schema: 't8-canvas-patch-v1', id: input.id, baseRevision: input.baseRevision,
    summary: '从生成历史放到画布', diagnosticsResolved: [], requiresConfirmation: true,
    operations: [{ opId: `${input.id}-add`, actorId: '', sessionId: '', clientSeq: 0, timestamp: 1,
      projectId: input.projectId, canvasId: input.canvasId, baseRevision: input.baseRevision,
      type: 'node.add', payload: { node: {
        id: `history-${input.id}`, type: 'upload', position: input.position,
        data: { ...createUploadDataFromItems(kind, [{ kind, url: asset.sourceUrl, name: asset.filename, mime: asset.mimeType, size: Number(asset.metadata?.size || 0) }]),
          // The generic legacy migration deliberately clears unresolved top-
          // level sourceAssetEntityUid. Retain this verified fixed reference as
          // a namespaced pointer, without bypassing that migration's barriers.
          historyAssetRef: { assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash || null },
          ...(kind === 'model3d' && asset.metadata?.tripoResult ? {
            tripoTaskId: (asset.metadata.tripoResult as any).tripoTaskId || '',
            tripoPartNames: (asset.metadata.tripoResult as any).tripoPartNames || [],
          } : {}), historyPlacement: true },
      } },
    }],
  };
}

/** Validate only. Canvas insertion remains an explicit caller action. A HEAD
 * request uses the host's verified-media handler, not stale index availability.
 * This is not an atomic immutable placement/persistence receipt. */
export async function prepareGenerationHistoryPlacement(
  output: GenerationHistoryOutput,
  projectId: string,
  dependencies: {
    isCurrentScope: () => boolean;
    getAsset: (id: string) => Promise<AssetRef>;
    request: (url: string, init: RequestInit) => Promise<Pick<Response, 'ok'>>;
  },
): Promise<AssetRef> {
  const assertScope = () => {
    if (!dependencies.isCurrentScope()) throw new Error('画布已切换，请重新选择素材');
  };
  assertScope();
  const mediaUrl = `/api/project-assets/${encodeURIComponent(output.assetId)}/media`;
  if (output.availability !== 'available' || output.mediaUrl !== mediaUrl) {
    throw new Error('素材已变化或不可用，请刷新历史记录');
  }
  const asset = await dependencies.getAsset(output.assetId);
  assertScope();
  if (asset.id !== output.assetId || asset.projectId !== projectId || asset.availability !== 'available'
    || (output.contentHash && asset.contentHash !== output.contentHash)) {
    throw new Error('素材已变化或不可用，请刷新历史记录');
  }
  const frozenMediaUrl = frozenAssetMediaUrl(asset);
  const response = await dependencies.request(frozenMediaUrl, {
    method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
  });
  assertScope();
  if (!response.ok) throw new Error('文件暂不可用，请确认本地文件仍在原位置后重试');
  return { ...asset, sourceUrl: frozenMediaUrl };
}
