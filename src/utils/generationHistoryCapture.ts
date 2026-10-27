import type { Node, Edge } from '@xyflow/react';
import contract from '../../backend/src/shared/generationHistoryInputContract.json';

export interface HistoryInputNode { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
export type HistoryInputCapture = {
  schema: string; purpose: 'prefill-only'; complete: true; credentialsOmitted: boolean;
  node: HistoryInputNode; upstreamNodes: HistoryInputNode[]; incomingEdges: Array<Record<string, unknown>>;
} | { schema: string; purpose: 'prefill-only'; complete: false; reason: 'input-incomplete-or-unsafe' };

// This graph is for restoring an editable draft, not for the existing automatic
// replay entry. No credentials are copied, and no value is silently truncated.
export function captureGenerationHistoryInput(nodes: Node[], edges: Edge[], nodeId: string, resolvedInput?: Record<string, unknown>): HistoryInputCapture {
  const failure: HistoryInputCapture = { schema: contract.schema, purpose: 'prefill-only', complete: false, reason: 'input-incomplete-or-unsafe' };
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const target = nodeMap.get(nodeId);
  if (!target) return failure;
  const visited = new Set([nodeId]), incoming = new Map<string, Edge[]>(), captured = new Map<string, Edge>();
  for (const edge of edges) incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge]);
  const queue = [nodeId];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const edge of incoming.get(queue[cursor]) || []) {
      if (!nodeMap.has(edge.source)) return failure;
      captured.set(edge.id, edge);
      if (!visited.has(edge.source)) { visited.add(edge.source); queue.push(edge.source); }
      if (visited.size > contract.maxNodes || captured.size > contract.maxEdges) return failure;
    }
  }
  let credentialsOmitted = false, remaining = contract.maxBytes;
  const seen = new WeakSet<object>();
  const encoder = new TextEncoder();
  const privateKeyPattern = new RegExp(contract.privateKeyPattern, 'i');
  const tokenCountPattern = new RegExp(contract.safeTokenCountPattern, 'i');
  const secretKey = (key: string) => {
    const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    return !tokenCountPattern.test(normalized) && privateKeyPattern.test(normalized);
  };
  const copy = (value: unknown, depth: number): unknown => {
    remaining -= 8;
    if (remaining < 0 || depth > contract.maxDepth) throw new Error('bounds');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('number'); return value; }
    if (typeof value === 'string') {
      remaining -= encoder.encode(value).byteLength;
      if (remaining < 0 || value.length > contract.maxStringChars
        || /\[redacted|%5bredacted%5d|base64 omitted|max depth|\[circular\]|^data:|^blob:|^file:|\b(?:sk|rk|pk)-(?:proj-)?[a-z0-9_-]{16,}|(?:authorization|cookie)\s*[:=]|\bbearer\s+|^[a-z]:[\\/]|^\\\\/i.test(value)) throw new Error('unsafe');
      try {
        const url = new URL(value);
        if (url.username || url.password || [...url.searchParams.keys()].some(key => secretKey(key) || /^(sig|expires|key)$/i.test(key))) throw new Error('signed-url');
      } catch (error) { if (error instanceof Error && error.message === 'signed-url') throw error; }
      return value;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('json');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('json');
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      if (value.length > contract.maxArrayItems) throw new Error('array');
      result = Array.from(value, item => copy(item, depth + 1));
    } else {
      const entries = Object.entries(value);
      if (entries.length > contract.maxObjectKeys) throw new Error('keys');
      const data: Record<string, unknown> = {};
      for (const [key, item] of entries) {
        remaining -= encoder.encode(key).byteLength;
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('key');
        if (secretKey(key)) { credentialsOmitted ||= item != null && item !== ''; continue; }
        if (item !== undefined) data[key] = copy(item, depth + 1);
      }
      result = data;
    }
    seen.delete(value); return result;
  };
  const originalId = (node: Node) => String((node as Node & { __runReplayOriginalNodeId?: string }).__runReplayOriginalNodeId || node.id);
  const captureNode = (node: Node): HistoryInputNode => {
    // Never recycle a previously restored/user-supplied derived capture.
    const { historyResolvedInput: _stale, ...data } = node.data;
    if (node.type === 'video') {
      for (const key of ['klingV4Pending', 'klingV4AcceptanceUnknown']) delete data[key];
      if (node === target) delete data.klingV4Result;
    }
    if (node.type === 'code-animation') {
      // The resolved input is the immutable request. Prior videos/storyboards
      // belong to result history and must not recursively inflate the archive.
      for (const key of ['motionVersions', 'motionPending', 'motionSelectedVersionId', 'motionAcceptanceUnknown']) delete data[key];
      // A downstream run still needs the selected animation's actual input
      // assets/storyboard. Only this node's own prior result is redundant.
      if (node === target) for (const key of ['motionAssetRefs', 'sourceAssetId', 'sourceAssetIds', 'videoUrl', 'videoUrls', 'outputs', 'metadata']) delete data[key];
      else {
        // Rich auxiliary metadata remains on the stable asset. Keep the exact
        // port payload and aggregate refs without nesting them a second time.
        delete data.metadata;
        const outputs = data.outputs as Record<string, any> | undefined;
        if (outputs?.video) {
          const { metadata: _metadata, motionAssetRefs: _refs, ...video } = outputs.video;
          data.outputs = { ...outputs, video };
        }
      }
    }
    return { id: originalId(node), type: node.type || 'placeholder', position: { x: node.position.x, y: node.position.y },
      data: { ...data, ...(node === target && resolvedInput !== undefined ? { historyResolvedInput: resolvedInput } : {}) } };
  };
  try {
    const raw = { schema: contract.schema, purpose: 'prefill-only', complete: true,
      node: captureNode(target), upstreamNodes: queue.slice(1).map(id => captureNode(nodeMap.get(id)!)),
      incomingEdges: [...captured.values()].map(edge => ({ id: edge.id,
        source: originalId(nodeMap.get(edge.source)!), target: originalId(nodeMap.get(edge.target)!),
        ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
        ...(edge.targetHandle !== undefined ? { targetHandle: edge.targetHandle } : {}), ...(edge.data !== undefined ? { data: edge.data } : {}),
      })),
    };
    const result = { ...(copy(raw, 0) as Omit<Extract<HistoryInputCapture, { complete: true }>, 'credentialsOmitted'>), credentialsOmitted };
    return encoder.encode(JSON.stringify(result)).byteLength <= contract.maxBytes ? result : failure;
  } catch { return failure; }
}
