export const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type PacingLevel = 'on_pace' | 'moderate' | 'fast';

export interface PacingSummary {
  window: '5h' | 'weekly';
  level: PacingLevel;
  ratio: number;
  label: string;
  detail: string;
}

function formatDurationShort(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  if (totalMin < 60) {
    return `${totalMin}m`;
  }
  const totalHours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (totalHours < 24) {
    return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export function computeWindowPacing(
  windowKind: '5h' | 'weekly',
  remainingPct: number,
  resetMs: number,
  windowMs: number,
  nowMs = Date.now()
): PacingSummary | null {
  if (!Number.isFinite(remainingPct) || !Number.isFinite(resetMs) || windowMs <= 0) {
    return null;
  }
  const rem = Math.max(0, Math.min(100, remainingPct));
  const used = 100 - rem;
  const msLeft = resetMs - nowMs;
  if (msLeft <= 0 || msLeft > windowMs * 1.05) {
    return null;
  }

  const windowName = windowKind === 'weekly' ? 'Weekly' : '5h';
  if (rem === 0) {
    return {
      window: windowKind,
      level: 'fast',
      ratio: 1,
      label: `${windowName}: Depleted`,
      detail: `0% left · resets in ${formatDurationShort(msLeft)}`,
    };
  }
  if (used <= 0) {
    return {
      window: windowKind,
      level: 'on_pace',
      ratio: 0,
      label: `${windowName}: On pace`,
      detail: `0% used in ${windowName} window`,
    };
  }

  const clampedMsLeft = Math.min(windowMs, Math.max(1, msLeft));
  const elapsedMs = Math.max(60_000, windowMs - clampedMsLeft);
  const elapsedPct = (elapsedMs / windowMs) * 100;

  if (elapsedPct < 3 && used <= 10) {
    return {
      window: windowKind,
      level: 'on_pace',
      ratio: 1,
      label: `${windowName}: On pace`,
      detail: `${Math.round(used)}% used early in ${windowName} window`,
    };
  }

  const effectiveElapsedPct = Math.max(3, elapsedPct);
  const ratio = Number((used / effectiveElapsedPct).toFixed(2));
  const ratePerMs = used / elapsedMs;
  const estMsToZero = rem / ratePerMs;
  const runsOutBeforeReset = estMsToZero < clampedMsLeft * 0.95;

  if (ratio >= 1.5) {
    return {
      window: windowKind,
      level: 'fast',
      ratio,
      label: runsOutBeforeReset ? `${windowName}: Fast · ~${formatDurationShort(estMsToZero)} left` : `${windowName}: Fast`,
      detail: `${Math.round(used)}% used in ${Math.round(elapsedPct)}% of ${windowName} window (${ratio}x pace)`,
    };
  }
  if (ratio >= 1.15) {
    return {
      window: windowKind,
      level: 'moderate',
      ratio,
      label: `${windowName}: Elevated`,
      detail: `${Math.round(used)}% used in ${Math.round(elapsedPct)}% of ${windowName} window (${ratio}x pace)`,
    };
  }

  return {
    window: windowKind,
    level: 'on_pace',
    ratio,
    label: `${windowName}: On pace`,
    detail: `${Math.round(used)}% used in ${Math.round(elapsedPct)}% of ${windowName} window (${ratio}x pace)`,
  };
}

const LEVEL_RANK: Record<PacingLevel, number> = {
  fast: 3,
  moderate: 2,
  on_pace: 1,
};

export function computePoolPacing(
  pool: { fiveHourPct?: number; weeklyPct?: number },
  fiveHourResetMs: number | null,
  weeklyResetMs: number | null,
  nowMs = Date.now()
): PacingSummary | null {
  const candidates: PacingSummary[] = [];
  if (typeof pool.weeklyPct === 'number' && typeof weeklyResetMs === 'number') {
    const weekly = computeWindowPacing('weekly', pool.weeklyPct, weeklyResetMs, WEEKLY_WINDOW_MS, nowMs);
    if (weekly) candidates.push(weekly);
  }
  if (typeof pool.fiveHourPct === 'number' && typeof fiveHourResetMs === 'number') {
    const fiveH = computeWindowPacing('5h', pool.fiveHourPct, fiveHourResetMs, FIVE_HOUR_WINDOW_MS, nowMs);
    if (fiveH) candidates.push(fiveH);
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => {
    const rankDiff = LEVEL_RANK[b.level] - LEVEL_RANK[a.level];
    if (rankDiff !== 0) return rankDiff;
    if (a.window !== b.window) return a.window === 'weekly' ? -1 : 1;
    return b.ratio - a.ratio;
  });
  return candidates[0];
}
