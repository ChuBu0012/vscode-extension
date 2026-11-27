import { describe, expect, it } from 'bun:test';
import {
  FIVE_HOUR_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  computePoolPacing,
  computeWindowPacing,
} from '../src/pacing';

describe('pacing', () => {
  it('computes on_pace, moderate, and fast pacing against elapsed window ratio', () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);
    // Weekly window half elapsed (3.5 days left of 7 days)
    const weeklyReset = now + WEEKLY_WINDOW_MS * 0.5;

    const onPace = computeWindowPacing('weekly', 60, weeklyReset, WEEKLY_WINDOW_MS, now);
    expect(onPace?.level).toBe('on_pace');
    expect(onPace?.label).toBe('Weekly: On pace');

    const moderate = computeWindowPacing('weekly', 38, weeklyReset, WEEKLY_WINDOW_MS, now);
    expect(moderate?.level).toBe('moderate');
    expect(moderate?.label).toBe('Weekly: Elevated');

    const fast = computeWindowPacing('weekly', 15, weeklyReset, WEEKLY_WINDOW_MS, now);
    expect(fast?.level).toBe('fast');
    expect(fast?.label).toContain('Weekly: Fast');
    expect(fast?.label).toContain('left');
  });

  it('guards early-window small usage and handles depleted or invalid windows', () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);
    const fiveHReset = now + FIVE_HOUR_WINDOW_MS - 60_000; // 1m into 5h window (~0.33% elapsed)

    const earlySmall = computeWindowPacing('5h', 95, fiveHReset, FIVE_HOUR_WINDOW_MS, now);
    expect(earlySmall?.level).toBe('on_pace');

    const depleted = computeWindowPacing('5h', 0, now + 3600_000, FIVE_HOUR_WINDOW_MS, now);
    expect(depleted?.level).toBe('fast');
    expect(depleted?.label).toBe('5h: Depleted');

    expect(computeWindowPacing('5h', 80, now - 1000, FIVE_HOUR_WINDOW_MS, now)).toBeNull();
  });

  it('computePoolPacing surfaces the highest concern across 5h and weekly windows', () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);
    const fiveHReset = now + FIVE_HOUR_WINDOW_MS * 0.5;
    const weeklyReset = now + WEEKLY_WINDOW_MS * 0.5;

    // 5h is healthy (70% left at 50% elapsed -> 0.6x on_pace), Weekly is tight (10% left at 50% elapsed -> 1.8x fast)
    const picked = computePoolPacing(
      { fiveHourPct: 70, weeklyPct: 10 },
      fiveHReset,
      weeklyReset,
      now
    );
    expect(picked?.window).toBe('weekly');
    expect(picked?.level).toBe('fast');
  });
});
