import { describe, expect, it } from 'bun:test';
import { OpenRouterProvider, parseOpenRouterResponse } from '../src/providers/openRouterProvider';
import { SecretStore } from '../src/secrets';
import { MonitorConfig } from '../src/types';

const baseConfig: MonitorConfig = {
  pollingIntervalSeconds: 300,
  displayMode: 'remaining',
  statusBarProviders: ['openrouter'],
};

function makeSecretStore(initial?: Record<string, string>): SecretStore {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
  };
}

describe('OpenRouterProvider & parseOpenRouterResponse', () => {
  it('computes remainingPct and balance when key has a credit limit', () => {
    const pools = parseOpenRouterResponse({
      data: { label: 'dev-key', limit: 20, usage: 5, limit_remaining: 15 },
    });
    expect(pools).toHaveLength(1);
    expect(pools[0].name).toBe('OpenRouter (dev-key)');
    expect(pools[0].remainingPct).toBe(75);
    expect(pools[0].balanceAmount).toBe(15);
    expect(pools[0].budgetCapAmount).toBe(20);
  });

  it('uses /credits + optional budgetCap when key limit is null', () => {
    const pools = parseOpenRouterResponse(
      { data: { limit: null, usage: 2 } },
      { data: { total_credits: 25, total_usage: 5 } },
      40
    );
    expect(pools[0].balanceAmount).toBe(20);
    expect(pools[0].budgetCapAmount).toBe(40);
    expect(pools[0].remainingPct).toBe(50);
  });

  it('returns not_connected when API key is missing in SecretStore', async () => {
    const provider = new OpenRouterProvider({ secretStore: makeSecretStore() });
    const snap = await provider.fetchSnapshot(baseConfig);
    expect(snap.status).toBe('not_connected');
    expect(snap.requiresConnect).toBe(true);
  });

  it('returns live snapshot and falls back to cache on transient error', async () => {
    let fail = false;
    const provider = new OpenRouterProvider({
      secretStore: makeSecretStore({ 'quotadeck.key.openrouter': 'or-key-123' }),
      fetchJson: async () => {
        if (fail) throw new Error('network timeout');
        return { data: { limit: 10, usage: 3, limit_remaining: 7 } } as never;
      },
    });

    const live = await provider.fetchSnapshot(baseConfig);
    expect(live.status).toBe('live');
    expect(live.pools[0].remainingPct).toBe(70);

    fail = true;
    const cached = await provider.fetchSnapshot(baseConfig);
    expect(cached.status).toBe('live');
    expect(cached.pools[0].remainingPct).toBe(70);
  });

  it('clears cache and prompts reconnect on 401', async () => {
    const provider = new OpenRouterProvider({
      secretStore: makeSecretStore({ 'quotadeck.key.openrouter': 'bad-key' }),
      fetchJson: async () => {
        const err = new Error('HTTP 401');
        (err as { status?: number }).status = 401;
        throw err;
      },
    });
    const snap = await provider.fetchSnapshot(baseConfig);
    expect(snap.status).toBe('unavailable');
    expect(snap.requiresConnect).toBe(true);
  });
});
