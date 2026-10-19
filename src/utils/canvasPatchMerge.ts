const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type CanvasPatchMergeConflictKind =
  | 'edit-delete'
  | 'delete-edit'
  | 'same-field'
  | 'edge-delete-node'
  | 'dangling-edge';

export interface CanvasPatchMergeConflict {
  kind: CanvasPatchMergeConflictKind;
  path: string;
}

export interface CanvasPatchMergeResult<T> {
  value: T;
  conflicts: CanvasPatchMergeConflict[];
}

export interface CanvasPatchGraphMergeResult<TNode, TEdge> {
  nodes: TNode[];
  edges: TEdge[];
  conflicts: CanvasPatchMergeConflict[];
}

export interface CanvasPatchPendingEnvelope {
  snapshot: string;
  baseSnapshot: string;
  baseRevision: number;
  conflicted: boolean;
  conflicts: CanvasPatchMergeConflict[];
}

export interface CanvasPatchPendingActivation<TPending extends CanvasPatchPendingEnvelope> {
  lastSavedSnapshot: string;
  pending: TPending | null;
  blocked: boolean;
  shouldScheduleCas: boolean;
}

export interface CanvasPatchAutosavePendingReconciliation<TPending extends CanvasPatchPendingEnvelope> {
  pending: TPending | null;
  cancelTimer: boolean;
  shouldReturn: boolean;
}

export interface CanvasPatchAutosaveToken<TPending extends CanvasPatchPendingEnvelope> {
  generation: number;
  snapshot: string;
  pendingIdentity: TPending;
}

type CanvasPatchAutosaveResponseInput<TPending extends CanvasPatchPendingEnvelope> = {
  token: CanvasPatchAutosaveToken<TPending>;
  currentGeneration: number;
  current: TPending;
  pending: TPending | null;
  active: boolean;
} & (
  | { outcome: 'success'; savedRevision: number }
  | { outcome: 'conflict' }
);

export interface CanvasPatchAutosaveResponseReconciliation<TPending extends CanvasPatchPendingEnvelope> {
  acceptedSnapshot: string | null;
  acceptedRevision: number | null;
  tokenMatches: boolean;
  currentSnapshotMatches: boolean;
  pendingIdentityMatches: boolean;
  pending: TPending | null;
  shouldScheduleCas: boolean;
}

export interface CanvasPatchMutationCell<T> {
  value: T;
  epoch: number;
}

export type CanvasPatchMutationAction<T> = T | ((current: T) => T);

export interface CanvasPatchFlight {
  requestId: number;
  scopeKey: string;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function childPath(path: string, key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Three-way JSON merge used after a confirmed server Patch wins its CAS.
 * Later local intent is retained on conflicts, but every destructive or
 * same-field collision is returned to the caller so it can block persistence.
 */
export function mergeCanvasPatchValueWithConflicts<T = unknown>(
  base: unknown,
  local: unknown,
  authoritative: unknown,
  path = '$',
  depth = 0,
): CanvasPatchMergeResult<T> {
  if (jsonValuesEqual(local, base)) return { value: authoritative as T, conflicts: [] };
  if (jsonValuesEqual(authoritative, base) || jsonValuesEqual(local, authoritative)) {
    return { value: local as T, conflicts: [] };
  }
  if (local === undefined || authoritative === undefined) {
    return {
      value: local as T,
      conflicts: [{
        kind: local === undefined ? 'delete-edit' : 'edit-delete',
        path,
      }],
    };
  }
  if (depth >= 24 || !isPlainJsonObject(local) || !isPlainJsonObject(authoritative)) {
    return { value: local as T, conflicts: [{ kind: 'same-field', path }] };
  }

  const baseObject = isPlainJsonObject(base) ? base : {};
  const merged: Record<string, unknown> = {};
  const conflicts: CanvasPatchMergeConflict[] = [];
  const keys = new Set([...Object.keys(baseObject), ...Object.keys(authoritative), ...Object.keys(local)]);
  for (const key of keys) {
    if (UNSAFE_MERGE_KEYS.has(key)) continue;
    const result = mergeCanvasPatchValueWithConflicts(
      baseObject[key],
      local[key],
      authoritative[key],
      childPath(path, key),
      depth + 1,
    );
    if (result.value !== undefined) merged[key] = result.value;
    conflicts.push(...result.conflicts);
  }
  return { value: merged as T, conflicts };
}

export function mergeCanvasPatchEntitiesWithConflicts<T extends { id: string }>(
  base: T[],
  local: T[],
  authoritative: T[],
  path: string,
): CanvasPatchMergeResult<T[]> {
  const baseById = new Map(base.map((entity) => [entity.id, entity]));
  const localById = new Map(local.map((entity) => [entity.id, entity]));
  const authoritativeById = new Map(authoritative.map((entity) => [entity.id, entity]));
  const orderedIds = [...new Set([
    ...authoritative.map((entity) => entity.id),
    ...local.map((entity) => entity.id),
    ...base.map((entity) => entity.id),
  ])];
  const value: T[] = [];
  const conflicts: CanvasPatchMergeConflict[] = [];
  for (const id of orderedIds) {
    const baseEntity = baseById.get(id);
    const localEntity = localById.get(id);
    const remoteEntity = authoritativeById.get(id);
    const uid = (value: T | undefined) => (value as { entityUid?: unknown } | undefined)?.entityUid;
    // A reused display ID is not the same entity. Never attach an unsaved
    // prompt/output to a replacement node or edge through a field-wise merge.
    if (localEntity && remoteEntity
      && typeof uid(localEntity) === 'string' && typeof uid(remoteEntity) === 'string'
      && (baseEntity
        ? typeof uid(baseEntity) === 'string' && (uid(baseEntity) !== uid(localEntity) || uid(baseEntity) !== uid(remoteEntity))
        : uid(localEntity) !== uid(remoteEntity))
      && !jsonValuesEqual(localEntity, baseEntity) && !jsonValuesEqual(remoteEntity, baseEntity)
      && !jsonValuesEqual(localEntity, remoteEntity)) {
      value.push(localEntity);
      conflicts.push({ kind: 'same-field', path: `${path}[${JSON.stringify(id)}].entityUid` });
      continue;
    }
    const result = mergeCanvasPatchValueWithConflicts<T | undefined>(
      baseById.get(id),
      localById.get(id),
      authoritativeById.get(id),
      `${path}[${JSON.stringify(id)}]`,
    );
    if (result.value && typeof result.value === 'object') value.push(result.value);
    conflicts.push(...result.conflicts);
  }
  return { value, conflicts };
}

export function mergeCanvasPatchGraph<
  TNode extends { id: string },
  TEdge extends { id: string; source: string; target: string },
>(input: {
  baseNodes: TNode[];
  localNodes: TNode[];
  authoritativeNodes: TNode[];
  baseEdges: TEdge[];
  localEdges: TEdge[];
  authoritativeEdges: TEdge[];
}): CanvasPatchGraphMergeResult<TNode, TEdge> {
  const nodeResult = mergeCanvasPatchEntitiesWithConflicts(
    input.baseNodes,
    input.localNodes,
    input.authoritativeNodes,
    'nodes',
  );
  const edgeResult = mergeCanvasPatchEntitiesWithConflicts(
    input.baseEdges,
    input.localEdges,
    input.authoritativeEdges,
    'edges',
  );
  const nodes = [...nodeResult.value];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const localNodeById = new Map(input.localNodes.map((node) => [node.id, node]));
  const baseEdgeById = new Map(input.baseEdges.map((edge) => [edge.id, edge]));
  const localEdgeById = new Map(input.localEdges.map((edge) => [edge.id, edge]));
  const conflicts = [...nodeResult.conflicts, ...edgeResult.conflicts];
  const edges: TEdge[] = [];

  for (const edge of edgeResult.value) {
    const missingEndpointIds = [...new Set([edge.source, edge.target].filter((id) => !nodeById.has(id)))];
    if (missingEndpointIds.length === 0) {
      edges.push(edge);
      continue;
    }
    const localEdgeChanged = !jsonValuesEqual(localEdgeById.get(edge.id), baseEdgeById.get(edge.id));
    let repaired = localEdgeChanged;
    for (const nodeId of missingEndpointIds) {
      const localNode = localNodeById.get(nodeId);
      if (!localNode || !localEdgeChanged) {
        repaired = false;
        conflicts.push({ kind: 'dangling-edge', path: `edges[${JSON.stringify(edge.id)}]` });
        continue;
      }
      if (!nodeById.has(nodeId)) {
        nodes.push(localNode);
        nodeById.set(nodeId, localNode);
      }
      conflicts.push({
        kind: 'edge-delete-node',
        path: `edges[${JSON.stringify(edge.id)}].${edge.source === nodeId ? 'source' : 'target'}`,
      });
    }
    if (repaired && nodeById.has(edge.source) && nodeById.has(edge.target)) edges.push(edge);
  }

  return { nodes, edges, conflicts };
}

/** Compatibility helper for callers that have already handled conflicts. */
export function mergeCanvasPatchValue(base: unknown, local: unknown, authoritative: unknown): unknown {
  return mergeCanvasPatchValueWithConflicts(base, local, authoritative).value;
}

/** Compatibility helper for callers that have already handled conflicts. */
export function mergeCanvasPatchEntities<T extends { id: string }>(base: T[], local: T[], authoritative: T[]): T[] {
  return mergeCanvasPatchEntitiesWithConflicts(base, local, authoritative, 'entities').value;
}

export function activateCanvasPatchPending<TPending extends CanvasPatchPendingEnvelope>(input: {
  authoritativeSnapshot: string;
  authoritativeRevision: number;
  pending: TPending | null;
}): CanvasPatchPendingActivation<TPending> {
  if (!input.pending) {
    return {
      lastSavedSnapshot: input.authoritativeSnapshot,
      pending: null,
      blocked: false,
      shouldScheduleCas: false,
    };
  }
  if (input.pending.conflicted) {
    return {
      lastSavedSnapshot: input.authoritativeSnapshot,
      pending: input.pending,
      blocked: true,
      shouldScheduleCas: false,
    };
  }
  const pending = {
    ...input.pending,
    baseSnapshot: input.authoritativeSnapshot,
    baseRevision: input.authoritativeRevision,
  };
  return {
    lastSavedSnapshot: input.authoritativeSnapshot,
    pending,
    blocked: false,
    shouldScheduleCas: pending.snapshot !== input.authoritativeSnapshot,
  };
}

export function reconcileCanvasPatchAutosavePending<TPending extends CanvasPatchPendingEnvelope>(input: {
  authoritativeSnapshot: string;
  current: TPending;
  pending: TPending | null;
}): CanvasPatchAutosavePendingReconciliation<TPending> {
  if (input.pending?.conflicted) {
    return {
      pending: {
        ...input.current,
        baseSnapshot: input.pending.baseSnapshot,
        baseRevision: input.pending.baseRevision,
        conflicted: true,
        conflicts: input.pending.conflicts,
      },
      cancelTimer: true,
      shouldReturn: true,
    };
  }
  if (input.current.snapshot === input.authoritativeSnapshot) {
    return {
      pending: null,
      cancelTimer: true,
      shouldReturn: true,
    };
  }
  return {
    pending: input.pending,
    cancelTimer: false,
    shouldReturn: false,
  };
}

export function reconcileCanvasPatchAutosaveResponse<TPending extends CanvasPatchPendingEnvelope>(
  input: CanvasPatchAutosaveResponseInput<TPending>,
): CanvasPatchAutosaveResponseReconciliation<TPending> {
  const tokenMatches = input.currentGeneration === input.token.generation;
  const currentSnapshotMatches = input.current.snapshot === input.token.snapshot;
  const pendingIdentityMatches = input.pending === input.token.pendingIdentity;

  if (input.outcome === 'conflict') {
    // A newer authoritative document (for example a completed background
    // node.patch) may already have rebased the current pending edit while an
    // older PUT is still in flight. Its expected 409 belongs to the retired
    // token; it must not poison the newly-rebased pending state.
    if (!tokenMatches && input.pending && !pendingIdentityMatches && !input.pending.conflicted) {
      const pending = {
        ...input.current,
        baseSnapshot: input.pending.baseSnapshot,
        baseRevision: input.pending.baseRevision,
        conflicted: false,
        conflicts: input.pending.conflicts,
      };
      return {
        acceptedSnapshot: null,
        acceptedRevision: null,
        tokenMatches,
        currentSnapshotMatches,
        pendingIdentityMatches,
        pending,
        shouldScheduleCas: Boolean(input.active && pending.snapshot !== pending.baseSnapshot),
      };
    }
    const provenance = input.pending || input.token.pendingIdentity;
    const conflicts = provenance.conflicts.some((conflict) => conflict.kind === 'same-field' && conflict.path === 'revision')
      ? provenance.conflicts
      : [...provenance.conflicts, { kind: 'same-field' as const, path: 'revision' }];
    return {
      acceptedSnapshot: null,
      acceptedRevision: null,
      tokenMatches,
      currentSnapshotMatches,
      pendingIdentityMatches,
      pending: {
        ...input.current,
        baseSnapshot: provenance.baseSnapshot,
        baseRevision: provenance.baseRevision,
        conflicted: true,
        conflicts,
      },
      shouldScheduleCas: false,
    };
  }

  if (input.pending?.conflicted) {
    return {
      acceptedSnapshot: input.token.snapshot,
      acceptedRevision: input.savedRevision,
      tokenMatches,
      currentSnapshotMatches,
      pendingIdentityMatches,
      pending: {
        ...input.current,
        baseSnapshot: input.pending.baseSnapshot,
        baseRevision: input.pending.baseRevision,
        conflicted: true,
        conflicts: input.pending.conflicts,
      },
      shouldScheduleCas: false,
    };
  }

  const pending = currentSnapshotMatches
    ? null
    : {
      ...input.current,
      baseSnapshot: input.token.snapshot,
      baseRevision: input.savedRevision,
      conflicted: false,
      conflicts: [],
    };
  return {
    acceptedSnapshot: input.token.snapshot,
    acceptedRevision: input.savedRevision,
    tokenMatches,
    currentSnapshotMatches,
    pendingIdentityMatches,
    pending,
    shouldScheduleCas: Boolean(pending && input.active),
  };
}

export function advanceCanvasPatchMutation<T>(
  cell: CanvasPatchMutationCell<T>,
  action: CanvasPatchMutationAction<T>,
): CanvasPatchMutationCell<T> {
  const value = typeof action === 'function'
    ? (action as (current: T) => T)(cell.value)
    : action;
  return Object.is(value, cell.value)
    ? cell
    : { value, epoch: cell.epoch + 1 };
}

export function canvasPatchHistoryBarrier<T>(snapshot: T, patchId: string) {
  return {
    mode: 'reset' as const,
    snapshot,
    patchId,
    guidance: '该修改已进入审计记录；如需撤回，请使用“我的 Patch 记录”。',
  };
}

export function canvasPatchScopeKey(projectId: string, canvasId: string, open: boolean, tab: string) {
  return JSON.stringify([projectId, canvasId, open, tab]);
}

export function beginCanvasPatchSingleFlight(
  current: CanvasPatchFlight | null,
  scopeKey: string,
  requestId: number,
): { accepted: boolean; flight: CanvasPatchFlight } {
  if (current?.scopeKey === scopeKey) return { accepted: false, flight: current };
  return { accepted: true, flight: { requestId, scopeKey } };
}

export function endCanvasPatchSingleFlight(
  current: CanvasPatchFlight | null,
  completed: CanvasPatchFlight,
): CanvasPatchFlight | null {
  return current?.requestId === completed.requestId && current.scopeKey === completed.scopeKey
    ? null
    : current;
}
