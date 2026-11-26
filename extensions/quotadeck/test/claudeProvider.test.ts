import { describe, expect, it } from 'bun:test';
import { ClaudeCodeProvider, parseClaudeUsageResponse } from '../src/providers/claudeProvider';
import { MonitorConfig } from '../src/types';

const defaultConfig: MonitorConfig = {
  pollingIntervalSeconds: 300,
  displayMode: 'remaining',
  statusBarProviders: ['agy-gemini', 'claude', 'codex'],
};

describe('ClaudeCodeProvider & parseClaudeUsageResponse', () => {
  it('parses five_hour and seven_day utilization into remaining percentages', () => {
    const pools = parseClaudeUsageResponse(
      {
        five_hour: { utilization: 45.0, resets_at: '2026-11-26T08:00:00Z' },
        seven_day: { utilization: 80.0, resets_at: '2026-11-27T10:00:00Z' },
      },
      'pro'
    );

    expect(pools).toHaveLength(1);
    expect(pools[0].name).toBe('Claude (Pro)');
    expect(pools[0].displayMode).toBe('used');
    expect(pools[0].fiveHourPct).toBe(55);
    expect(pools[0].weeklyPct).toBe(20);
    expect(pools[0].remainingPct).toBe(55);
    expect(pools[0].fiveHourReset).toBe('2026-11-26T08:00:00Z');
    expect(pools[0].weeklyReset).toBe('2026-11-27T10:00:00Z');
  });

  it('returns 0% remainingPct when weekly utilization reaches 100%', () => {
    const pools = parseClaudeUsageResponse({
      five_hour: { utilization: 10 },
      seven_day: { utilization: 100 },
    });
    expect(pools[0].remainingPct).toBe(0);
    expect(pools[0].weeklyPct).toBe(0);
  });

  it('returns live Exact snapshot when OAuth credentials and usage API succeed', async () => {
    const provider = new ClaudeCodeProvider({
      loadCredentials: async () => ({
        accessToken: 'test-token',
        expiresAt: Date.now() + 60_000,
        subscriptionType: 'pro',
      }),
      fetchUsageApi: async () => ({
        five_hour: { utilization: 30, resets_at: '2026-11-26T08:00:00Z' },
        seven_day: { utilization: 50, resets_at: '2026-11-27T10:00:00Z' },
      }),
    });

    const snap = await provider.fetchSnapshot(defaultConfig);
    expect(snap.status).toBe('live');
    expect(snap.sourceKind).toBe('Exact');
    expect(snap.pools[0].remainingPct).toBe(70);
  });

  it('returns not_connected when credentials are missing and unavailable when expired (401)', async () => {
    const noCreds = new ClaudeCodeProvider({
      loadCredentials: async () => null,
    });
    const s1 = await noCreds.fetchSnapshot(defaultConfig);
    expect(s1.status).toBe('not_connected');

    const expired = new ClaudeCodeProvider({
      loadCredentials: async () => ({ accessToken: 'tok', expiresAt: Date.now() + 60_000 }),
      fetchUsageApi: async () => {
        const err = new Error('HTTP 401');
        (err as { status?: number }).status = 401;
        throw err;
      },
    });
    const s2 = await expired.fetchSnapshot(defaultConfig);
    expect(s2.status).toBe('unavailable');
    expect(s2.note).toContain('expired');
  });

  it('falls back to cached snapshot on transient API failure', async () => {
    let fail = false;
    const provider = new ClaudeCodeProvider({
      loadCredentials: async () => ({ accessToken: 'tok', expiresAt: Date.now() + 60_000 }),
      fetchUsageApi: async () => {
        if (fail) {
          throw new Error('network timeout');
        }
        return {
          five_hour: { utilization: 25 },
          seven_day: { utilization: 40 },
        };
      },
    });

    const first = await provider.fetchSnapshot(defaultConfig);
    expect(first.status).toBe('live');
    expect(first.pools[0].remainingPct).toBe(75);

    fail = true;
    const second = await provider.fetchSnapshot(defaultConfig);
    expect(second.status).toBe('live');
    expect(second.pools[0].remainingPct).toBe(75);
  });
});
