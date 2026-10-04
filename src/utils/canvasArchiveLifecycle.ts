export interface CanvasArchiveHold { release: () => void; revision?: number }
type Guard = (canvasId: string) => Promise<CanvasArchiveHold>;
let currentGuard: Guard | null = null;
export function registerCanvasArchiveGuard(guard: Guard) {
  currentGuard = guard;
  return () => { if (currentGuard === guard) currentGuard = null; };
}
export async function prepareCanvasArchive(canvasId: string) {
  if (!currentGuard) throw new Error('canvas_archive_not_ready');
  return currentGuard(canvasId);
}
