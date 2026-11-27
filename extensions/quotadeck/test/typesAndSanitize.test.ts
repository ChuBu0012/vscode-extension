import { describe, expect, it } from 'bun:test';
import {
  sanitizeLowBalanceUsd,
  sanitizeLowThresholdPct,
  sanitizePollingInterval,
} from '../src/configValidation';
import { averageRemainingPct } from '../src/types';

describe('types & configValidation', () => {
  it('averageRemainingPct handles empty and multi-pool arrays', () => {
    expect(averageRemainingPct([])).toBe(0);
    expect(
      averageRemainingPct([
        { id: 'a', name: 'A', remainingPct: 57 },
        { id: 'b', name: 'B', remainingPct: 49 },
      ])
    ).toBe(53);
  });

  it('sanitizePollingInterval rejects NaN/Infinity and clamps bounds', () => {
    expect(sanitizePollingInterval(NaN, 300)).toBe(300);
    expect(sanitizePollingInterval('abc', 300)).toBe(300);
    expect(sanitizePollingInterval(5, 300)).toBe(30);
    expect(sanitizePollingInterval(999999, 300)).toBe(3600);
    expect(sanitizePollingInterval(180, 300)).toBe(180);
  });

  it('sanitizeLowThresholdPct and sanitizeLowBalanceUsd validate bounds cleanly', () => {
    expect(sanitizeLowThresholdPct(NaN)).toBe(20);
    expect(sanitizeLowThresholdPct(0)).toBe(1);
    expect(sanitizeLowThresholdPct(95)).toBe(90);
    expect(sanitizeLowThresholdPct(35)).toBe(35);

    expect(sanitizeLowBalanceUsd(-5)).toBe(1);
    expect(sanitizeLowBalanceUsd('bad')).toBe(1);
    expect(sanitizeLowBalanceUsd(0)).toBe(0);
    expect(sanitizeLowBalanceUsd(2.556)).toBe(2.56);
  });
});
