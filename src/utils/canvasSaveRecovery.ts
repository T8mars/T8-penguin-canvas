import type { CanvasPatchMergeConflict, CanvasPatchPendingEnvelope } from './canvasPatchMerge';

export const CANVAS_SAVE_RECOVERY_LIMIT = 2;

export function isRevisionOnlyCanvasConflict(pending: CanvasPatchPendingEnvelope | null): pending is CanvasPatchPendingEnvelope {
  return Boolean(pending?.conflicted && pending.conflicts.length > 0
    && pending.conflicts.every((item) => item.kind === 'same-field' && item.path === 'revision'));
}

/** Read/rebase only. All writes remain in Canvas's existing serialized CAS queue. */
export async function recoverCanvasRevisionConflict<T>(options: {
  canvasId: string;
  attempts: Map<string, number>;
  manual?: boolean;
  cancelled: () => boolean;
  readPending: () => CanvasPatchPendingEnvelope | null;
  load: () => Promise<T>;
  commit: (document: T, baseline: string) => { conflicts: CanvasPatchMergeConflict[] };
}): Promise<'reconciled' | 'blocked' | 'limited' | 'superseded'> {
  const pending = options.readPending();
  if (!isRevisionOnlyCanvasConflict(pending)) return 'blocked';
  const baseline = JSON.parse(pending.baseSnapshot);
  if (!baseline || !Array.isArray(baseline.nodes) || !Array.isArray(baseline.edges)
    || !Number.isSafeInteger(pending.baseRevision) || pending.baseRevision < 1) {
    throw new Error('Canvas save recovery requires its original valid baseline');
  }
  if (options.manual) options.attempts.delete(options.canvasId);
  const attempts = options.attempts.get(options.canvasId) || 0;
  if (attempts >= CANVAS_SAVE_RECOVERY_LIMIT) return 'limited';
  options.attempts.set(options.canvasId, attempts + 1);
  const document = await options.load();
  if (options.cancelled()) return 'superseded';
  // A Patch/mailbox may have superseded the failed PUT during this GET. Never
  // rebase that newer state on the retired request's baseline.
  const latest = options.readPending();
  if (!isRevisionOnlyCanvasConflict(latest)
    || latest.baseSnapshot !== pending.baseSnapshot || latest.baseRevision !== pending.baseRevision) return 'superseded';
  const result = options.commit(document, latest.baseSnapshot);
  if (result.conflicts.length > 0) return 'blocked';
  return 'reconciled';
}
