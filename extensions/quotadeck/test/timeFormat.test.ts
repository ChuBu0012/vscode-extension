import { describe, expect, it } from 'bun:test';
import { formatResetCountdown, parseAgyResetTimestamp } from '../src/timeFormat';

describe('timeFormat', () => {
  it('parses agy reset timestamps with timezone offset', () => {
    const ms = parseAgyResetTimestamp('2026-11-26 14:39 +07');
    expect(ms).toBe(Date.parse('2026-11-26T14:39:00+07:00'));
  });

  it('formats countdowns for minutes, hours, and days in local time', () => {
    const base = Date.parse('2026-11-26T10:00:00+07:00');
    const fmt = (iso: string) => {
      const d = new Date(Date.parse(iso));
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    expect(formatResetCountdown('2026-11-26 10:42 +07', base)).toBe(
      `in 42m · ${fmt('2026-11-26T10:42:00+07:00')}`
    );
    expect(formatResetCountdown('2026-11-26T07:39:36Z', base)).toBe(
      `in 4h 39m · ${fmt('2026-11-26T07:39:36Z')}`
    );
  });
});
