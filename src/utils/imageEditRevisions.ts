/** Read-only lineage over existing canvas output nodes, not another run ledger. */
export interface ImageEditLineage {
  schema: 't8-image-edit-lineage-v1'; id: string; rootUrl: string; parentUrl: string;
  operation: string; createdAt: number;
  parentRevisionId?: string;
}
export interface ImageEditRevision { id: string; url: string; operation: string; createdAt: number; lineage?: ImageEditLineage }
export function readImageEditLineage(value: unknown): ImageEditLineage | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as ImageEditLineage;
  if (v.schema !== 't8-image-edit-lineage-v1' || !v.id || typeof v.id !== 'string'
    || typeof v.rootUrl !== 'string' || !v.rootUrl || typeof v.parentUrl !== 'string' || !v.parentUrl
    || typeof v.operation !== 'string' || !Number.isFinite(v.createdAt)) return null;
  return { schema: v.schema, id: v.id, rootUrl: v.rootUrl, parentUrl: v.parentUrl, operation: v.operation.slice(0, 80), createdAt: v.createdAt,
    ...(typeof v.parentRevisionId === 'string' ? { parentRevisionId: v.parentRevisionId } : {}) };
}
export function collectImageEditRevisions(nodes: readonly { data?: unknown }[], currentUrl: string): ImageEditRevision[] {
  const candidates: ImageEditRevision[] = [];
  for (const node of nodes) {
    const data = node.data as Record<string, unknown> | undefined;
    const lineage = readImageEditLineage(data?.imageEditLineage);
    const url = data?.directImageUrl || data?.imageUrl;
    if (lineage && typeof url === 'string' && url) candidates.push({ id: lineage.id, url, lineage, operation: lineage.operation, createdAt: lineage.createdAt });
  }
  const rootUrl = candidates.find((revision) => revision.url === currentUrl)?.lineage?.rootUrl || currentUrl;
  const byId = new Map<string, ImageEditRevision>();
  for (const revision of candidates) if (revision.lineage?.rootUrl === rootUrl) byId.set(revision.id, revision);
  const candidatesByUrl = new Map<string, ImageEditRevision[]>();
  for (const revision of byId.values()) candidatesByUrl.set(revision.url, [...(candidatesByUrl.get(revision.url) || []), revision]);
  const children = new Map<string, ImageEditRevision[]>(), indegree = new Map<string, number>();
  for (const revision of byId.values()) {
    const parent = revision.lineage?.parentRevisionId ? byId.get(revision.lineage.parentRevisionId)
      : candidatesByUrl.get(revision.lineage?.parentUrl || '')?.find((item) => item.id !== revision.id);
    indegree.set(revision.id, parent ? 1 : 0);
    if (parent) children.set(parent.id, [...(children.get(parent.id) || []), revision]);
  }
  const ready = Array.from(byId.values()).filter((revision) => !indegree.get(revision.id)).sort((a, b) => a.createdAt - b.createdAt);
  const ordered: ImageEditRevision[] = [], emitted = new Set<string>();
  // Creation clocks can tie or move backwards. A derived edit must still
  // follow its parent when reopening a reordered/imported canvas document.
  for (let index = 0; index < ready.length; index++) {
    const revision = ready[index]; ordered.push(revision); emitted.add(revision.id);
    for (const child of children.get(revision.id) || []) { indegree.set(child.id, 0); ready.push(child); }
  }
  // Imported malformed cycles keep their references instead of hanging or deleting edits.
  for (const revision of byId.values()) if (!emitted.has(revision.id)) ordered.push(revision);
  return [{ id: 'original', url: rootUrl, operation: 'original', createdAt: 0 }, ...ordered];
}
export function createImageEditLineage(rootUrl: string, parentUrl: string, operation: string, parentRevisionId?: string): ImageEditLineage {
  return { schema: 't8-image-edit-lineage-v1', id: crypto.randomUUID(), rootUrl, parentUrl, operation, createdAt: Date.now(),
    ...(parentRevisionId ? { parentRevisionId } : {}) };
}
