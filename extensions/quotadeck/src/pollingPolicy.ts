import { parseAgyResetTimestamp } from './timeFormat';
import { ProviderSnapshot } from './types';

const MAX_BACKOFF_MS = 30 * 60 * 1000;
export const ACTIVE_BURST_SECONDS = 60;
export const ACTIVE_COOLDOWN_POLLS = 3;

export type PollModeKind = 'active' | 'auto' | 'idle' | 'fixed';

export interface PollStatusInfo {
  mode: PollModeKind;
  intervalSeconds: number;
  baseSeconds: number;
  smartEnabled: boolean;
  activeRemainingCooldown: number;
}

export function computeQuotaSignature(snapshots: ProviderSnapshot[]): string {
  return snapshots
    .map((s) => {
      const pools = s.pools
        .map((p) => `${p.id}:${p.remainingPct ?? ''}:${p.fiveHourPct ?? ''}:${p.weeklyPct ?? ''}:${p.balanceAmount ?? ''}`)
        .join(',');
      return `${s.id}=${s.status}[${pools}]`;
    })
    .join('|');
}

export function hasQuotaOrBalanceDrop(
  prevSnapshots: ProviderSnapshot[],
  nextSnapshots: ProviderSnapshot[]
): boolean {
  if (prevSnapshots.length === 0 || nextSnapshots.length === 0) {
    return false;
  }

  const prevPoolMap = new Map<string, { remainingPct?: number; fiveHourPct?: number; weeklyPct?: number; balanceAmount?: number }>();
  for (const s of prevSnapshots) {
    if (s.status !== 'live') continue;
    for (const p of s.pools) {
      prevPoolMap.set(`${s.id}:${p.id}`, p);
    }
  }

  for (const s of nextSnapshots) {
    if (s.status !== 'live') continue;
    for (const p of s.pools) {
      const prev = prevPoolMap.get(`${s.id}:${p.id}`);
      if (!prev) continue;
      if (typeof p.remainingPct === 'number' && typeof prev.remainingPct === 'number' && p.remainingPct < prev.remainingPct) {
        return true;
      }
      if (typeof p.fiveHourPct === 'number' && typeof prev.fiveHourPct === 'number' && p.fiveHourPct < prev.fiveHourPct) {
        return true;
      }
      if (typeof p.weeklyPct === 'number' && typeof prev.weeklyPct === 'number' && p.weeklyPct < prev.weeklyPct) {
        return true;
      }
      if (typeof p.balanceAmount === 'number' && typeof prev.balanceAmount === 'number' && p.balanceAmount < prev.balanceAmount) {
        return true;
      }
    }
  }

  return false;
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

export function computeSmartPollDelay(params: {
  baseIntervalSeconds: number;
  smartEnabled: boolean;
  activeBurstRemaining: number;
  unchangedStreak: number;
  nowMs: number;
  earliestResetMs: number | null;
}): { delayMs: number; status: PollStatusInfo } {
  const baseSeconds = Math.max(30, Math.round(params.baseIntervalSeconds));
  if (!params.smartEnabled) {
    const fixedMs = baseSeconds * 1000;
    return {
      delayMs: fixedMs,
      status: {
        mode: 'fixed',
        intervalSeconds: baseSeconds,
        baseSeconds,
        smartEnabled: false,
        activeRemainingCooldown: 0,
      },
    };
  }

  if (params.activeBurstRemaining > 0) {
    const activeSec = Math.min(baseSeconds, ACTIVE_BURST_SECONDS);
    let delayMs = activeSec * 1000;
    if (params.earliestResetMs !== null && params.earliestResetMs > params.nowMs) {
      const msUntilReset = params.earliestResetMs - params.nowMs;
      if (msUntilReset + 2000 < delayMs) {
        delayMs = Math.max(5000, msUntilReset + 2000);
      }
    }
    return {
      delayMs,
      status: {
        mode: 'active',
        intervalSeconds: Math.round(delayMs / 1000),
        baseSeconds,
        smartEnabled: true,
        activeRemainingCooldown: params.activeBurstRemaining,
      },
    };
  }

  const delayMs = computeNextPollDelayMs(
    baseSeconds,
    params.unchangedStreak,
    params.nowMs,
    params.earliestResetMs
  );
  const mode: PollModeKind = delayMs > baseSeconds * 1000 ? 'idle' : 'auto';
  return {
    delayMs,
    status: {
      mode,
      intervalSeconds: Math.round(delayMs / 1000),
      baseSeconds,
      smartEnabled: true,
      activeRemainingCooldown: 0,
    },
  };
}
