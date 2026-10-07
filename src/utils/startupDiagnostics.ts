import type { CanvasStartupStage } from './canvasStartupReadiness';

declare const __APP_VERSION__: string;
const startedAt = Date.now();
const events: Array<{ component: 'renderer'; phase: string; elapsedMs: number; phaseMs?: number; delayMs?: number }> = [];
let previousStage: string | null = null;
let stageStartedAt = startedAt;

function record(phase: string, timing: { phaseMs?: number; delayMs?: number } = {}) {
  const event = { component: 'renderer' as const, phase, elapsedMs: Math.max(0, Date.now() - startedAt), ...timing };
  if (events.length >= 512) return;
  events.push(event);
  try { window.t8pc?.startupDiagnostics?.record(event); } catch { /* Logging is never a readiness gate. */ }
}

export function recordRendererStartupStage(stage: CanvasStartupStage) {
  if (previousStage === stage) return;
  const now = Date.now();
  record(stage, { phaseMs: Math.max(0, now - stageStartedAt) });
  previousStage = stage;
  stageStartedAt = now;
}

export function observeRendererStartup() {
  let previousTick = Date.now();
  const resetTick = () => { previousTick = Date.now(); };
  const onError = () => record('renderer-error');
  const onRejection = () => record('renderer-rejection');
  const timer = window.setInterval(() => {
    const now = Date.now();
    const delayMs = Math.max(0, now - previousTick - 1000);
    previousTick = now;
    if (!document.hidden && delayMs >= 2000) record('event-loop-delay', { delayMs });
  }, 1000);
  const stopTimer = window.setTimeout(() => window.clearInterval(timer), 15 * 60 * 1000);
  document.addEventListener('visibilitychange', resetTick);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.clearInterval(timer); window.clearTimeout(stopTimer);
    document.removeEventListener('visibilitychange', resetTick);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export async function saveStartupDiagnostics(): Promise<{ success: boolean; canceled?: boolean; code?: string }> {
  if (window.t8pc?.startupDiagnostics?.save) return window.t8pc.startupDiagnostics.save();
  // Browser-only mode has no Electron/backend log access. Label this explicitly.
  const header = { schema: 't8-startup-diagnostics-v1', session: 'renderer-only', appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown', startedAt: new Date(startedAt).toISOString() };
  const text = [header, ...events].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `t8-startup-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return { success: true };
}
