const listeners = new Set<(canvasId: string) => void>();

export function subscribeCanvasDeletion(listener: (canvasId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Only a successful, explicit delete may retire a draft. A missing catalog row
// or a failed/404 read is not proof of deletion (the catalog is paginated).
export function notifyCanvasDeleted(canvasId: string) {
  for (const listener of listeners) {
    try { listener(canvasId); }
    catch { console.warn('Canvas deletion listener failed'); }
  }
}
