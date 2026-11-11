import { useMemo } from 'react';
import { useNodeConnections, useNodesData } from '@xyflow/react';
import { selectSourceHandleData } from '../../utils/sourceHandleData';
export function useSeedance25DraftSource(id: string) {
  const connections = useNodeConnections({ id, handleType: 'target' });
  const ids = useMemo(() => [...new Set(connections.map(c => c.source))], [connections]);
  const nodes = useNodesData(ids);
  return useMemo(() => nodes.flatMap(node => selectSourceHandleData(node.data, new Set(connections.filter(c => c.source === node.id).map(c => c.sourceHandle)))
    .filter(data => data.seedance25DraftTaskIdResult).map(data => ({ id: String(data.seedance25DraftTaskIdResult), model: String(data.seedance25DraftSourceModel || ''), sourceNodeId: node.id }))), [nodes, connections]);
}
