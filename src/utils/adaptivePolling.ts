export interface AdaptivePollDecision {
  idleStreak: number;
  delayMs: number;
}

export function nextAdaptivePollDecision(input: {
  baseMs: number;
  maxMs: number;
  idleStreak: number;
  hadActivity: boolean;
  failed: boolean;
}): AdaptivePollDecision {
  const baseMs = Math.max(250, Math.trunc(Number(input.baseMs) || 0));
  const maxMs = Math.max(baseMs, Math.trunc(Number(input.maxMs) || baseMs));
  if (input.hadActivity) return { idleStreak: 0, delayMs: baseMs };
  const idleStreak = Math.min(12, Math.max(0, Math.trunc(Number(input.idleStreak) || 0)) + 1);
  const exponent = Math.min(4, idleStreak + (input.failed ? 1 : 0));
  return {
    idleStreak,
    delayMs: Math.min(maxMs, baseMs * (2 ** exponent)),
  };
}
