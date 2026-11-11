import { useMemo } from 'react';
import { useNodeConnections, useNodesData } from '@xyflow/react';
import { selectSourceHandleData } from '../../utils/sourceHandleData';

export function useUpstreamModels3d(nodeId: string) {
  const connections = useNodeConnections({ id: nodeId, handleType: 'target' });
  const ids = useMemo(() => [...new Set(connections.map(c => c.source))], [connections]);
  const sources = useNodesData(ids);
  return useMemo(() => {
    const modelUrls: string[] = [], tripoTaskIds: string[] = [], modelSourceIds: string[] = [];
    for (const source of sources) {
      const handles = new Set(connections.filter(c => c.source === source.id).map(c => c.sourceHandle));
      for (const data of selectSourceHandleData(source.data, handles)) {
        const raw = data as Record<string, any>;
        const list = raw.modelUrl || raw.directModelUrl ? [raw.modelUrl || raw.directModelUrl] : Array.isArray(raw.modelUrls) ? raw.modelUrls : Array.isArray(raw.directModelUrls) ? raw.directModelUrls : [];
        if (list.some((url: unknown) => typeof url === 'string' && url) && !modelSourceIds.includes(source.id)) modelSourceIds.push(source.id);
        for (const url of list) if (typeof url === 'string' && url && !modelUrls.includes(url)) modelUrls.push(url);
        const nativeId = raw.tripoTaskId || raw.outputMetadata?.tripoTaskId;
        if (typeof nativeId === 'string' && nativeId && !tripoTaskIds.includes(nativeId)) tripoTaskIds.push(nativeId);
      }
    }
    return { modelUrls, tripoTaskIds, modelSourceIds };
  }, [sources, connections]);
}
