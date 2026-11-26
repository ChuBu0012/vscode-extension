import { describe, expect, it } from 'bun:test';
import { computeNextPollDelayMs, computeQuotaSignature, findEarliestResetMs } from '../src/pollingPolicy';
import { ProviderSnapshot } from '../src/types';

const makeSnap = (fiveHourPct: number, weeklyPct: number, fiveHourReset?: string): ProviderSnapshot[] => [
  {
    id: 'agy',
    shortCode: 'AG',
    name: 'Antigravity',
    status: 'live',
    sourceKind: 'Exact',
    pools: [
      {
        id: 'agy-gemini',
        name: 'Gemini Models',
        remainingPct: fiveHourPct,
        fiveHourPct,
        weeklyPct,
        fiveHourReset,
      },
    ],
  },
];

describe('pollingPolicy', () => {
  it('detects quota changes via computeQuotaSignature', () => {
    const a = makeSnap(70, 51, '2026-11-26 14:39 +07');
    const b = makeSnap(70, 51, '2026-11-26 14:40 +07');
    const c = makeSnap(68, 51, '2026-11-26 14:39 +07');

    expect(computeQuotaSignature(a)).toBe(computeQuotaSignature(b));
    expect(computeQuotaSignature(a)).not.toBe(computeQuotaSignature(c));
  });

  it('applies 1x -> 2x -> 4x backoff capped at 30 minutes', () => {
    const now = Date.parse('2026-11-26T04:00:00Z');
    expect(computeNextPollDelayMs(300, 0, now, null)).toBe(300_000);
    expect(computeNextPollDelayMs(300, 1, now, null)).toBe(600_000);
    expect(computeNextPollDelayMs(300, 2, now, null)).toBe(1_200_000);
    expect(computeNextPollDelayMs(300, 5, now, null)).toBe(1_200_000);
    // Larger base (e.g. 600s) caps at 30m (1800s)
    expect(computeNextPollDelayMs(600, 2, now, null)).toBe(1_800_000);
  });

  it('wakes up shortly after earliest reset timestamp when reset occurs before backoff delay', () => {
    const now = Date.parse('2026-11-26T04:00:00Z');
    const snaps = makeSnap(70, 51, '2026-11-26 11:05:00 +07'); // 04:05:00Z -> +5 min
    const resetMs = findEarliestResetMs(snaps, now);
    expect(resetMs).toBe(Date.parse('2026-11-26T04:05:00Z'));

    // Streak 2 would normally wait 20m, but reset is in 5m -> wakes up at 5m + 2s
    expect(computeNextPollDelayMs(300, 2, now, resetMs)).toBe(302_000);
  });
});
