import { describe, expect, it } from 'bun:test';
import { AntigravityProvider, parseAgyUsageOutput } from '../src/providers/antigravityProvider';
import { MonitorConfig } from '../src/types';

const sampleOutput = `Quota:
Gemini Models          Weekly Limit Remaining     57%   2026-12-01 23:48 +07
Gemini Models          Five Hour Limit Remaining  93%   2026-11-26 14:39 +07
Claude and GPT models  Weekly Limit Remaining     49%   2026-12-02 15:45 +07
Claude and GPT models  Five Hour Limit Remaining  100%  2026-11-26 14:41 +07`;

const cfg: MonitorConfig = {
  pollingIntervalSeconds: 300,
  displayMode: 'remaining',
  statusBarProviders: ['agy-gemini', 'claude', 'codex'],
};

describe('AntigravityProvider & parseAgyUsageOutput', () => {
  it('parses Weekly and Five Hour limits and computes tighter remainingPct', () => {
    const pools = parseAgyUsageOutput(sampleOutput);
    expect(pools).toHaveLength(2);

    const gemini = pools.find((p) => p.id === 'agy-gemini')!;
    expect(gemini.weeklyPct).toBe(57);
    expect(gemini.weeklyReset).toBe('2026-12-01 23:48 +07');
    expect(gemini.fiveHourPct).toBe(93);
    expect(gemini.fiveHourReset).toBe('2026-11-26 14:39 +07');
    expect(gemini.remainingPct).toBe(93);

    const claude = pools.find((p) => p.id === 'agy-claude')!;
    expect(claude.weeklyPct).toBe(49);
    expect(claude.fiveHourPct).toBe(100);
    expect(claude.remainingPct).toBe(100);
  });

  it('returns 0% remainingPct if Weekly limit hits 0% even when 5h is 100%', () => {
    const pools = parseAgyUsageOutput(
      'Gemini Models          Weekly Limit Remaining     0%    2026-12-01 23:48 +07\n' +
        'Gemini Models          Five Hour Limit Remaining  100%  2026-11-26 14:39 +07'
    );
    expect(pools[0].remainingPct).toBe(0);
  });

  it('returns live Exact snapshot when agy /usage succeeds', async () => {
    const provider = new AntigravityProvider({
      fetchUsageOutput: async () => sampleOutput,
    });
    const snap = await provider.fetchSnapshot(cfg);
    expect(snap.status).toBe('live');
    expect(snap.sourceKind).toBe('Exact');
    expect(snap.pools).toHaveLength(2);
  });

  it('falls back to cached snapshot when a later fetch fails, or unavailable on first failure', async () => {
    let shouldFail = true;
    const provider = new AntigravityProvider({
      fetchUsageOutput: async () => {
        if (shouldFail) {
          throw new Error('timeout');
        }
        return sampleOutput;
      },
    });

    const first = await provider.fetchSnapshot(cfg);
    expect(first.status).toBe('unavailable');
    expect(first.pools).toHaveLength(0);

    shouldFail = false;
    const live = await provider.fetchSnapshot(cfg);
    expect(live.status).toBe('live');

    shouldFail = true;
    const cached = await provider.fetchSnapshot(cfg);
    expect(cached.status).toBe('live');
    expect(cached.note).toContain('Showing cached data');
  });
});
