import { describe, expect, it } from 'bun:test';
import { CodexProvider, parseCodexUsageResponse } from '../src/providers/codexProvider';
import { MonitorConfig } from '../src/types';

const defaultConfig: MonitorConfig = {
  pollingIntervalSeconds: 300,
  displayMode: 'remaining',
  statusBarProviders: ['agy-gemini', 'claude', 'codex'],
};

describe('CodexProvider & parseCodexUsageResponse', () => {
  it('parses primary and secondary rate_limit windows into remaining percentages', () => {
    const pools = parseCodexUsageResponse({
      plan_type: 'plus',
      rate_limit: {
        primary_window: { used_percent: 35, reset_at: 1795700000 },
        secondary_window: { used_percent: 60, reset_at: 1796200000 },
      },
    });

    expect(pools).toHaveLength(1);
    expect(pools[0].name).toBe('Codex (Plus)');
    expect(pools[0].fiveHourPct).toBe(65);
    expect(pools[0].weeklyPct).toBe(40);
    expect(pools[0].remainingPct).toBe(65);
  });

  it('handles free plan with null secondary_window and 100% used', () => {
    const pools = parseCodexUsageResponse({
      plan_type: 'free',
      rate_limit: {
        primary_window: { used_percent: 100, reset_at: 1797844513 },
        secondary_window: null,
      },
    });

    expect(pools).toHaveLength(1);
    expect(pools[0].name).toBe('Codex (Free)');
    expect(pools[0].fiveHourPct).toBe(0);
    expect(pools[0].weeklyPct).toBeUndefined();
    expect(pools[0].remainingPct).toBe(0);
  });

  it('returns live Exact snapshot when auth.json and wham/usage succeed', async () => {
    const provider = new CodexProvider({
      loadCredentials: async () => ({ accessToken: 'tok', accountId: 'acc-1' }),
      fetchUsageApi: async () => ({
        plan_type: 'pro',
        rate_limit: {
          primary_window: { used_percent: 20, reset_at: 1795700000 },
          secondary_window: { used_percent: 40, reset_at: 1796200000 },
        },
      }),
    });

    const snap = await provider.fetchSnapshot(defaultConfig);
    expect(snap.status).toBe('live');
    expect(snap.sourceKind).toBe('Exact');
    expect(snap.pools[0].remainingPct).toBe(80);
  });

  it('returns unavailable on missing credentials or 401, and falls back to cache on transient failure', async () => {
    const noCreds = new CodexProvider({ loadCredentials: async () => null });
    expect((await noCreds.fetchSnapshot(defaultConfig)).status).toBe('unavailable');

    let fail = false;
    const provider = new CodexProvider({
      loadCredentials: async () => ({ accessToken: 'tok' }),
      fetchUsageApi: async () => {
        if (fail) throw new Error('network error');
        return { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 25 } } };
      },
    });

    const ok = await provider.fetchSnapshot(defaultConfig);
    expect(ok.status).toBe('live');
    expect(ok.pools[0].remainingPct).toBe(75);

    fail = true;
    const cached = await provider.fetchSnapshot(defaultConfig);
    expect(cached.status).toBe('live');
    expect(cached.pools[0].remainingPct).toBe(75);
  });
});
