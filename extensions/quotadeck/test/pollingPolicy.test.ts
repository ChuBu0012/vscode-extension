import { describe, expect, it } from 'bun:test';
import {
  computeNextPollDelayMs,
  computeQuotaSignature,
  computeSmartPollDelay,
  findEarliestResetMs,
  hasQuotaOrBalanceDrop,
} from '../src/pollingPolicy';
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

  it('detects true quota or balance drops without triggering on upward resets', () => {
    const base: ProviderSnapshot[] = [
      {
        id: 'claude',
        shortCode: 'CL',
        name: 'Claude Code',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'claude-main', name: 'Claude (Pro)', remainingPct: 80, fiveHourPct: 80, weeklyPct: 90 }],
      },
      {
        id: 'deepseek',
        shortCode: 'DS',
        name: 'DeepSeek',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'deepseek-main', name: 'DeepSeek', balanceAmount: 10.0, balanceCurrency: 'USD' }],
      },
    ];
    const droppedPct: ProviderSnapshot[] = [
      { ...base[0], pools: [{ ...base[0].pools[0], remainingPct: 75, fiveHourPct: 75 }] },
      base[1],
    ];
    const droppedBal: ProviderSnapshot[] = [
      base[0],
      { ...base[1], pools: [{ ...base[1].pools[0], balanceAmount: 9.8 }] },
    ];
    const resetUp: ProviderSnapshot[] = [
      { ...base[0], pools: [{ ...base[0].pools[0], remainingPct: 100, fiveHourPct: 100 }] },
      base[1],
    ];

    expect(hasQuotaOrBalanceDrop(base, droppedPct)).toBe(true);
    expect(hasQuotaOrBalanceDrop(base, droppedBal)).toBe(true);
    expect(hasQuotaOrBalanceDrop(base, resetUp)).toBe(false);
    expect(hasQuotaOrBalanceDrop(base, base)).toBe(false);
  });

  it('computeSmartPollDelay switches to active 1m burst, preserves 30s floor, and honors fixed mode', () => {
    const now = Date.parse('2026-11-27T04:00:00Z');
    const active = computeSmartPollDelay({
      baseIntervalSeconds: 300,
      smartEnabled: true,
      activeBurstRemaining: 3,
      unchangedStreak: 0,
      nowMs: now,
      earliestResetMs: null,
    });
    expect(active.delayMs).toBe(60_000);
    expect(active.status.mode).toBe('active');
    expect(active.status.activeRemainingCooldown).toBe(3);

    const fastBase = computeSmartPollDelay({
      baseIntervalSeconds: 30,
      smartEnabled: true,
      activeBurstRemaining: 2,
      unchangedStreak: 0,
      nowMs: now,
      earliestResetMs: null,
    });
    expect(fastBase.delayMs).toBe(30_000);

    const idle = computeSmartPollDelay({
      baseIntervalSeconds: 300,
      smartEnabled: true,
      activeBurstRemaining: 0,
      unchangedStreak: 1,
      nowMs: now,
      earliestResetMs: null,
    });
    expect(idle.delayMs).toBe(600_000);
    expect(idle.status.mode).toBe('idle');

    const fixed = computeSmartPollDelay({
      baseIntervalSeconds: 30,
      smartEnabled: false,
      activeBurstRemaining: 3,
      unchangedStreak: 4,
      nowMs: now,
      earliestResetMs: null,
    });
    expect(fixed.delayMs).toBe(30_000);
    expect(fixed.status.mode).toBe('fixed');
  });
});
