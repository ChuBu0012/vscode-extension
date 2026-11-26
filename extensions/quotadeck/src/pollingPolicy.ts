import { parseAgyResetTimestamp } from './timeFormat';
import { ProviderSnapshot } from './types';

const MAX_BACKOFF_MS = 30 * 60 * 1000;

export function computeQuotaSignature(snapshots: ProviderSnapshot[]): string {
  return snapshots
    .map((s) => {
      const pools = s.pools
        .map((p) => `${p.id}:${p.remainingPct}:${p.fiveHourPct ?? ''}:${p.weeklyPct ?? ''}`)
        .join(',');
      return `${s.id}=${s.status}[${pools}]`;
    })
    .join('|');
}

export function findEarliestResetMs(snapshots: ProviderSnapshot[], nowMs: number): number | null {
  let earliest: number | null = null;
  for (const s of snapshots) {
    if (s.status !== 'live') {
      continue;
    }
    for (const p of s.pools) {
      for (const raw of [p.fiveHourReset, p.weeklyReset]) {
        if (!raw) {
          continue;
        }
        const parsed = parseAgyResetTimestamp(raw);
        if (parsed !== null && parsed > nowMs) {
          if (earliest === null || parsed < earliest) {
            earliest = parsed;
          }
        }
      }
    }
  }
  return earliest;
}

export function computeNextPollDelayMs(
  baseIntervalSeconds: number,
  unchangedStreak: number,
  nowMs: number,
  earliestResetMs: number | null
): number {
  const baseMs = Math.max(30, baseIntervalSeconds) * 1000;
  const multiplier = unchangedStreak <= 0 ? 1 : unchangedStreak === 1 ? 2 : 4;
  const maxMs = Math.max(baseMs, MAX_BACKOFF_MS);
  let delayMs = Math.min(baseMs * multiplier, maxMs);

  if (earliestResetMs !== null && earliestResetMs > nowMs) {
    const msUntilReset = earliestResetMs - nowMs;
    if (msUntilReset + 2000 < delayMs) {
      delayMs = Math.max(5000, msUntilReset + 2000);
    }
  }

  return delayMs;
}
