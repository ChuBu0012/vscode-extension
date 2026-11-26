import { describe, expect, it } from 'bun:test';
import { ClineProvider, parseClineUsageResponse } from '../src/providers/clineProvider';
import { SecretStore } from '../src/secrets';
import { MonitorConfig } from '../src/types';

const baseConfig: MonitorConfig = {
  pollingIntervalSeconds: 300,
  displayMode: 'remaining',
  statusBarProviders: ['cline'],
};

describe('ClineProvider & parseClineUsageResponse', () => {
  it('parses 5h and weekly utilization into remaining percentages', () => {
    const pools = parseClineUsageResponse({
      five_hour: { utilization: 30, resets_at: '2026-11-26T18:00:00Z' },
      weekly: { remainingPct: 60, resetsAt: '2026-12-01T00:00:00Z' },
    });
    expect(pools).toHaveLength(1);
    expect(pools[0].fiveHourPct).toBe(70);
    expect(pools[0].weeklyPct).toBe(60);
    expect(pools[0].remainingPct).toBe(70);
  });

  it('supports pay-as-you-go balance with optional budget cap', () => {
    const pools = parseClineUsageResponse(null, { balanceUsd: 4.5 }, 10);
    expect(pools[0].name).toBe('Cline Credits');
    expect(pools[0].balanceAmount).toBe(4.5);
    expect(pools[0].remainingPct).toBe(45);
  });

  it('returns not_connected when token is missing and live when endpoints succeed', async () => {
    const unauth = new ClineProvider({
      secretStore: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    });
    expect((await unauth.fetchSnapshot(baseConfig)).status).toBe('not_connected');

    const secretStore: SecretStore = {
      get: async () => 'cline-tok',
      set: async () => {},
      delete: async () => {},
    };
    const liveProv = new ClineProvider({
      secretStore,
      fetchJson: async (url) => {
        if (url.includes('usage-limits')) {
          return { five_hour: { remainingPct: 80 }, seven_day: { remainingPct: 90 } } as never;
        }
        if (url.endsWith('/users/me')) {
          return { id: 'usr_1' } as never;
        }
        return { balanceUsd: 12 } as never;
      },
    });
    const snap = await liveProv.fetchSnapshot(baseConfig);
    expect(snap.status).toBe('live');
    expect(snap.pools[0].remainingPct).toBe(80);
    expect(snap.pools[0].balanceAmount).toBe(12);
  });
});
