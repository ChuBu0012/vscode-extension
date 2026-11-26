import { describe, expect, it } from 'bun:test';
import { DeepSeekProvider, parseDeepSeekBalanceResponse } from '../src/providers/deepSeekProvider';
import { SecretStore } from '../src/secrets';
import { MonitorConfig } from '../src/types';

const baseConfig: MonitorConfig = {
  pollingIntervalSeconds: 300,
  displayMode: 'remaining',
  statusBarProviders: ['deepseek'],
};

function makeSecretStore(val?: string): SecretStore {
  return {
    get: async () => val,
    set: async () => {},
    delete: async () => {},
  };
}

describe('DeepSeekProvider & parseDeepSeekBalanceResponse', () => {
  it('parses USD balance without percentage when no budget cap is set', () => {
    const pools = parseDeepSeekBalanceResponse({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '12.50' }],
    });
    expect(pools).toHaveLength(1);
    expect(pools[0].balanceAmount).toBe(12.5);
    expect(pools[0].balanceCurrency).toBe('USD');
    expect(pools[0].remainingPct).toBeUndefined();
  });

  it('computes remainingPct when optional budgetCapUsd is provided', () => {
    const pools = parseDeepSeekBalanceResponse(
      { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '5.00' }] },
      20
    );
    expect(pools[0].remainingPct).toBe(25);
    expect(pools[0].budgetCapAmount).toBe(20);
  });

  it('returns not_connected when key is missing', async () => {
    const provider = new DeepSeekProvider({ secretStore: makeSecretStore() });
    const snap = await provider.fetchSnapshot(baseConfig);
    expect(snap.status).toBe('not_connected');
    expect(snap.requiresConnect).toBe(true);
  });

  it('returns live snapshot when API succeeds and handles 401', async () => {
    const liveProvider = new DeepSeekProvider({
      secretStore: makeSecretStore('ds-key'),
      fetchBalance: async () => ({
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '8.40' }],
      }),
    });
    const live = await liveProvider.fetchSnapshot({ ...baseConfig, budgets: { deepseek: 10 } });
    expect(live.status).toBe('live');
    expect(live.pools[0].balanceAmount).toBe(8.4);
    expect(live.pools[0].remainingPct).toBe(84);

    const badProvider = new DeepSeekProvider({
      secretStore: makeSecretStore('bad'),
      fetchBalance: async () => {
        const err = new Error('HTTP 401');
        (err as { status?: number }).status = 401;
        throw err;
      },
    });
    const bad = await badProvider.fetchSnapshot(baseConfig);
    expect(bad.status).toBe('unavailable');
    expect(bad.requiresConnect).toBe(true);
  });
});
