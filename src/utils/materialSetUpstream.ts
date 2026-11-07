import { makeMaterialSetItemId, valueOfMaterialSetItem, type MaterialSetItem, type MaterialSetKind } from './materialSet.ts';

export interface MaterialSetUpstreamMaterial {
  id: string;
  sourceNodeId: string;
  kind: MaterialSetKind;
  url: string;
  label?: string;
}

export function materialSetUpstreamKey(source: NonNullable<MaterialSetItem['upstreamSource']>): string {
  return JSON.stringify([source.sourceNodeId, source.materialId]);
}

/** Reconcile known upstream occurrences, keeping local/unknown historical items
 * and their order. Only explicit collection adopts matching historical entries. */
export function syncMaterialSetUpstream(
  existing: MaterialSetItem[],
  incoming: MaterialSetUpstreamMaterial[],
  options: { adoptLegacy?: boolean; excluded?: string[] } = {},
): MaterialSetItem[] {
  const excluded = new Set(options.excluded || []);
  const sources = incoming.map((material) => ({
    material,
    source: { materialId: material.id, sourceNodeId: material.sourceNodeId },
  })).filter(({ source }) => !excluded.has(materialSetUpstreamKey(source)));
  const remaining = new Map(sources.map((entry) => [materialSetUpstreamKey(entry.source), entry]));
  const fromSource = (entry: typeof sources[number], previous?: MaterialSetItem): MaterialSetItem => ({
    ...previous,
    id: previous?.id || makeMaterialSetItemId(entry.material.kind),
    kind: entry.material.kind,
    ...(entry.material.kind === 'text' ? { text: entry.material.url } : { url: entry.material.url }),
    name: previous?.name || entry.material.label || entry.material.url.split('/').pop(),
    origin: 'upstream',
    upstreamSource: entry.source,
  });
  const result = existing.flatMap((item) => {
    if (item.upstreamSource) {
      const key = materialSetUpstreamKey(item.upstreamSource), entry = remaining.get(key);
      if (!entry) return [];
      remaining.delete(key);
      return [fromSource(entry, item)];
    }
    if (options.adoptLegacy && item.origin !== 'local') {
      const entry = [...remaining.values()].find(({ material }) => material.kind === item.kind && material.url === valueOfMaterialSetItem(item));
      if (entry) {
        remaining.delete(materialSetUpstreamKey(entry.source));
        return [fromSource(entry, item)];
      }
    }
    return [item];
  });
  return [...result, ...[...remaining.values()].map((entry) => fromSource(entry))];
}
