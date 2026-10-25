import { getProjectAsset, listGenerationHistory } from '../services/api';
import type { GenerationHistoryQuery } from '../types/generationHistory';
import { createMotionVersion, MOTION_INPUT_SCHEMA, motionVersions, type MotionInput, type MotionResult, type MotionVersion } from './motionVideo';

/** Rebuild versions from the shared Run input archive and committed AssetRefs. */
export async function loadMotionHistory(scope: Pick<GenerationHistoryQuery, 'projectId' | 'canvasId' | 'nodeId' | 'nodeEntityUid'>, cursor?: string, signal?: AbortSignal) {
  const query = { ...scope, kind: 'video' as const, limit: 20 };
  const page = await listGenerationHistory({ ...query, cursor }, { signal });
  const versions: MotionVersion[] = [];
  for (const summary of page.groups) {
    if (summary.nodeType !== 'code-animation' || summary.nodeEntityUid !== scope.nodeEntityUid) continue;
    const detail = await listGenerationHistory({ ...query, groupId: summary.id, includeInput: true }, { signal });
    const group = detail.groups.find(item => item.id === summary.id);
    if (!group) continue;
    const archive = group.inputArchive;
    if (archive?.status !== 'available') continue;
    const input = archive.snapshot.node.data.historyResolvedInput as MotionInput | undefined;
    if (input?.schema !== MOTION_INPUT_SCHEMA || !input.request || !Array.isArray(input.ancestorQuality)) continue;
    const outputs = [...group.outputs];
    let current = group;
    while (current.hasMoreOutputs) {
      const offset = current.outputOffset + current.outputs.length;
      if (offset <= current.outputOffset) throw Error('Motion history pagination did not advance');
      const next = await listGenerationHistory({ ...query, groupId: group.id, outputOffset: offset }, { signal });
      const nextGroup = next.groups.find(item => item.id === group.id);
      if (!nextGroup || nextGroup.outputOffset !== offset) throw Error('Motion history output page is unavailable');
      outputs.push(...nextGroup.outputs); current = nextGroup;
    }
    const videos = outputs.filter(item => item.kind === 'video' && item.mediaUrl).sort((a, b) => a.outputOrdinal - b.outputOrdinal);
    if (!videos.length) continue;
    const asset = await getProjectAsset(videos[0].assetId, { signal });
    const result = asset.metadata?.motionResult as MotionResult | undefined;
    if (!result || result.model !== input.request.model) continue;
    const version = createMotionVersion(input, result, videos.map(item => item.mediaUrl!), videos.map(item => item.assetId), group.createdAt);
    versions.push(...motionVersions([version]));
  }
  return { versions, nextCursor: page.nextCursor };
}
