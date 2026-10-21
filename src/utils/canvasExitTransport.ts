/** Once the close save is acknowledged, the editor must not reconnect to a
 * stopped (or subsequently reused) backend while its native updater is closing.
 * The saving phase stays open so the original CAS queue can actually finish. */
export function isCanvasExitTransportClosed(): boolean {
  if (typeof document === 'undefined') return false;
  const hold = document.querySelector('[data-canvas-close-hold]');
  return Boolean(hold && hold.getAttribute('data-canvas-close-phase') !== 'saving');
}

export function canvasBackendFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isCanvasExitTransportClosed()) {
    return Promise.reject(new Error('CANVAS_EXIT_IN_PROGRESS'));
  }
  // Do not abort accepted requests. The real backend drain still owns them.
  return fetch(input, init);
}
