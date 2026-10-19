export interface CanvasWriteAuthority {
  activeCanvasId: string | null;
  loadedCanvasId: string | null;
  loaded: boolean;
  revision: unknown;
}

export function authoritativeCanvasRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

export function requireAuthoritativeCanvasRevision(value: unknown): number {
  const revision = authoritativeCanvasRevision(value);
  if (revision === null) {
    throw new Error('服务端返回的画布 revision 无效，已阻止编辑和保存');
  }
  return revision;
}

export function hasCanvasWriteAuthority(input: CanvasWriteAuthority): boolean {
  return Boolean(
    input.loaded
    && input.activeCanvasId
    && input.loadedCanvasId === input.activeCanvasId
    && authoritativeCanvasRevision(input.revision) !== null
  );
}

export class StaleCanvasLoadError extends Error {
  constructor() { super('Canvas load response is older than an acknowledged revision'); }
}

/** A load that crossed an acknowledged write gets one fresh read, never a
 * lower durable baseline. Repeated stale responses stay read-only. */
export async function readCurrentCanvasAuthority<T extends { revision?: unknown }>(options: {
  load: () => Promise<T>;
  minimumRevision: () => number;
  cancelled: () => boolean;
}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const document = await options.load();
    if (options.cancelled()) throw new Error('Canvas load superseded');
    const revision = requireAuthoritativeCanvasRevision(document.revision);
    const minimum = options.minimumRevision();
    if (!Number.isSafeInteger(minimum) || minimum < 0) throw new Error('Invalid known canvas revision');
    if (revision >= minimum) return document;
  }
  throw new StaleCanvasLoadError();
}
