/** Group membership is an implicit member -> group output dependency. */
export function hasUpstreamFeedbackCycle(
  nodeId: string,
  edges: Array<{source:string;target:string}>,
  nodes: Array<{id:string;type?:string;data?:Record<string,unknown>}> = [],
): boolean {
  const outgoing = new Map<string,string[]>();
  const add = (source:string,target:string) => outgoing.set(source,[...(outgoing.get(source)||[]),target]);
  edges.forEach(edge=>add(edge.source,edge.target));
  nodes.filter(node=>node.type==='groupBox').forEach(group=>{
    if(Array.isArray(group.data?.memberIds))group.data.memberIds.forEach(member=>{if(typeof member==='string')add(member,group.id);});
  });
  const visited=new Set<string>(),queue=[...(outgoing.get(nodeId)||[])];
  while(queue.length){
    const next=queue.pop()!;if(next===nodeId)return true;if(visited.has(next))continue;
    visited.add(next);queue.push(...(outgoing.get(next)||[]));
  }
  return false;
}
