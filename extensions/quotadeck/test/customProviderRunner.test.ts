import { describe, expect, it } from 'bun:test';
import { isAllowedCustomHttpUrl, sanitizeCustomProviders } from '../src/configValidation';
import { extractJsonPath, fetchCustomProviderSnapshot } from '../src/providers/customProviderRunner';

describe('CustomProviderRunner & validation', () => {
  it('enforces https or localhost URLs and blocks prototype pollution in extractJsonPath', () => {
    expect(isAllowedCustomHttpUrl('https://api.example.com/usage')).toBe(true);
    expect(isAllowedCustomHttpUrl('http://localhost:8080/usage')).toBe(true);
    expect(isAllowedCustomHttpUrl('http://127.0.0.1:11434/usage')).toBe(true);
    expect(isAllowedCustomHttpUrl('http://evil.example.com/usage')).toBe(false);
    expect(isAllowedCustomHttpUrl('file:///etc/passwd')).toBe(false);

    const obj = { data: { items: [{ left: 42 }] } };
    expect(extractJsonPath(obj, 'data.items.0.left')).toBe(42);
    expect(extractJsonPath(obj, '__proto__.polluted')).toBeUndefined();
    expect(extractJsonPath(obj, 'constructor.prototype')).toBeUndefined();
  });

  it('sanitizes customProviders config and executes HTTP + CLI providers', async () => {
    const sanitized = sanitizeCustomProviders([
      {
        id: 'my-gw',
        name: 'My Gateway',
        kind: 'http',
        url: 'https://gw.example.com/quota',
        secretKey: 'quotadeck.secret.my-gw',
        valueType: 'used_percentage',
        valuePath: 'usage.pct',
      },
      { id: 'bad id!', name: 'Bad', kind: 'http', valuePath: 'a' },
    ]);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].shortCode).toBe('MY');

    const missingSecret = await fetchCustomProviderSnapshot(sanitized[0], {
      secretStore: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    });
    expect(missingSecret.status).toBe('not_connected');

    let capturedAuth = '';
    const liveHttp = await fetchCustomProviderSnapshot(sanitized[0], {
      secretStore: { get: async () => 'sec-999', set: async () => {}, delete: async () => {} },
      fetchHttp: async (_u, init) => {
        capturedAuth = (init.headers as Record<string, string>)['Authorization'] ?? '';
        return { ok: true, status: 200, json: async () => ({ usage: { pct: 25 } }) };
      },
    });
    expect(capturedAuth).toBe('Bearer sec-999');
    expect(liveHttp.status).toBe('live');
    expect(liveHttp.pools[0].remainingPct).toBe(75);

    const liveCli = await fetchCustomProviderSnapshot(
      {
        id: 'local-cli',
        name: 'Local Tool',
        shortCode: 'LT',
        kind: 'cli',
        command: 'my-tool',
        valueType: 'balance_usd',
        valuePath: 'credits',
        budgetCapUsd: 20,
      },
      {
        runCli: async () => JSON.stringify({ credits: 10 }),
      }
    );
    expect(liveCli.status).toBe('live');
    expect(liveCli.pools[0].balanceAmount).toBe(10);
    expect(liveCli.pools[0].remainingPct).toBe(50);
  });
});
