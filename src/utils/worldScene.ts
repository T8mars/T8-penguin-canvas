export const WORLD_SCENE_SCHEMA = 't8-world-scene-v1' as const;
export type WorldSceneFormat = 'spz' | 'ply' | 'splat' | 'ksplat';
export type WorldCamera = { position: [number, number, number]; target: [number, number, number]; fov: number };
export interface WorldSceneSource {
  id: string; url: string; name: string; format: WorldSceneFormat;
  assetId?: string; assetEntityUid?: string; contentRevision?: number; contentHash?: string;
}
export interface WorldSceneView { id: string; name: string; sourceId?: string; camera: WorldCamera }
export interface WorldSceneProject {
  schema: typeof WORLD_SCENE_SCHEMA; sources: WorldSceneSource[]; activeSourceId: string;
  camera: WorldCamera | null; views: WorldSceneView[];
  cameras: Record<string, WorldCamera>;
}
export function worldSceneFormat(value: string): WorldSceneFormat | null {
  const ext = value.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ext === 'spz' || ext === 'ply' || ext === 'splat' || ext === 'ksplat' ? ext : null;
}
export function normalizeWorldCamera(value: unknown): WorldCamera | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as WorldCamera;
  const triple = (p: unknown): p is [number, number, number] => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e10);
  if (!triple(v.position) || !triple(v.target) || typeof v.fov !== 'number' || !Number.isFinite(v.fov)) return null;
  if (v.position.every((n, i) => n === v.target[i])) return null;
  return { position: [...v.position], target: [...v.target], fov: Math.min(120, Math.max(15, v.fov)) };
}
export function normalizeWorldScene(value: unknown): WorldSceneProject {
  const raw = value && typeof value === 'object' ? value as Partial<WorldSceneProject> : {};
  const sources: WorldSceneSource[] = [];
  const ids = new Set<string>();
  for (const source of Array.isArray(raw.sources) ? raw.sources : []) {
    if (!source || typeof source.id !== 'string' || !source.id || ids.has(source.id) || typeof source.url !== 'string' || !source.url) continue;
    const format = worldSceneFormat(`file.${source.format}`) || worldSceneFormat(source.name || source.url);
    if (!format || !/^(?:\/(?!\/)|https?:\/\/)/i.test(source.url)) continue;
    ids.add(source.id); sources.push({ id: source.id, url: source.url, format, name: String(source.name || source.id).slice(0, 180),
      ...(typeof source.assetId === 'string' && source.assetId ? { assetId: source.assetId } : {}),
      ...(typeof source.assetEntityUid === 'string' && source.assetEntityUid ? { assetEntityUid: source.assetEntityUid } : {}),
      ...(Number.isSafeInteger(source.contentRevision) && source.contentRevision! > 0 ? { contentRevision: source.contentRevision } : {}),
      ...(typeof source.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(source.contentHash) ? { contentHash: source.contentHash } : {}) });
  }
  const views: WorldSceneView[] = [];
  const viewIds = new Set<string>();
  for (const view of Array.isArray(raw.views) ? raw.views : []) {
    const camera = normalizeWorldCamera(view?.camera);
    if (!camera || typeof view.id !== 'string' || !view.id || viewIds.has(view.id)) continue;
    viewIds.add(view.id); views.push({ id: view.id, name: String(view.name || view.id).slice(0, 80), camera,
      ...(typeof view.sourceId === 'string' ? { sourceId: view.sourceId } : {}) });
  }
  const activeSourceId = typeof raw.activeSourceId === 'string' && raw.activeSourceId ? raw.activeSourceId : sources[0]?.id || '';
  const camera = normalizeWorldCamera(raw.camera);
  const cameras = Object.fromEntries(Object.entries(raw.cameras && typeof raw.cameras === 'object' ? raw.cameras : {})
    .flatMap(([id, value]) => { const c = normalizeWorldCamera(value); return c ? [[id, c]] : []; }));
  if (activeSourceId && camera) Object.defineProperty(cameras, activeSourceId, { value: camera, enumerable: true, writable: true, configurable: true });
  return { schema: WORLD_SCENE_SCHEMA, sources, activeSourceId, camera, views, cameras };
}

export function collectUpstreamWorldScenes(nodeId: string, value: unknown): WorldSceneSource[] {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const source = data.worldSceneSource as WorldSceneSource | undefined;
  if (source && typeof source === 'object') {
    return normalizeWorldScene({ sources: [source] }).sources.map((item) => ({ ...item, id: `upstream:${nodeId}:${item.id}` }));
  }
  const values = typeof data.worldSceneUrl === 'string' && data.worldSceneUrl ? [data.worldSceneUrl]
    : Array.isArray(data.modelUrls) && data.modelUrls.length ? data.modelUrls : [data.modelUrl];
  return values.flatMap((url, index) => {
    if (typeof url !== 'string' || !url) return [];
    const name = Array.isArray(data.fileNames) ? data.fileNames[index] : data.fileName;
    const format = worldSceneFormat(`file.${data.worldSceneFormat}`) || worldSceneFormat(typeof name === 'string' ? name : '') || worldSceneFormat(url);
    if (!format) return [];
    // Legacy nodes have no stable slot/asset receipt. Keep their old identity
    // for compatibility; new imports always propagate worldSceneSource's UUID.
    return [{ id: `upstream:${nodeId}:${index}`, url, format, name: typeof name === 'string' && name ? name : `scene-${index + 1}.${format}` }];
  });
}
