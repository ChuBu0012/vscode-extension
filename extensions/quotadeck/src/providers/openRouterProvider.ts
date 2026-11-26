import { SecretStore, providerSecretKey } from '../secrets';
import { ModelPoolSnapshot, MonitorConfig, ProviderSnapshot, QuotaProvider } from '../types';

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

export interface OpenRouterKeyResponse {
  data?: {
    label?: string | null;
    limit?: number | null;
    limit_remaining?: number | null;
    usage?: number | null;
    is_free_tier?: boolean | null;
  } | null;
}

export interface OpenRouterCreditsResponse {
  data?: {
    total_credits?: number | null;
    total_usage?: number | null;
  } | null;
}

export function parseOpenRouterResponse(
  keyData: OpenRouterKeyResponse,
  creditsData?: OpenRouterCreditsResponse | null,
  budgetCapUsd?: number
): ModelPoolSnapshot[] {
  const info = keyData?.data;
  if (!info || typeof info !== 'object') {
    return [];
  }

  const label = info.label?.trim() ? `OpenRouter (${info.label.trim()})` : 'OpenRouter Credits';
  const usage = typeof info.usage === 'number' && Number.isFinite(info.usage) ? Math.max(0, info.usage) : 0;
  const keyLimit = typeof info.limit === 'number' && Number.isFinite(info.limit) && info.limit > 0 ? info.limit : undefined;

  if (keyLimit !== undefined) {
    const remainingUsd =
      typeof info.limit_remaining === 'number' && Number.isFinite(info.limit_remaining)
        ? Math.max(0, info.limit_remaining)
        : Math.max(0, keyLimit - usage);
    const remainingPct = Math.max(0, Math.min(100, Math.round((remainingUsd / keyLimit) * 100)));
    return [
      {
        id: 'openrouter-main',
        name: label,
        remainingPct,
        balanceAmount: remainingUsd,
        balanceCurrency: 'USD',
        budgetCapAmount: keyLimit,
      },
    ];
  }

  const totalCredits = creditsData?.data?.total_credits;
  const totalUsage = creditsData?.data?.total_usage;
  if (typeof totalCredits === 'number' && Number.isFinite(totalCredits)) {
    const remainingUsd = Math.max(0, totalCredits - (typeof totalUsage === 'number' && Number.isFinite(totalUsage) ? totalUsage : 0));
    const cap = budgetCapUsd && budgetCapUsd > 0 ? budgetCapUsd : (totalCredits > 0 ? totalCredits : undefined);
    const remainingPct = cap ? Math.max(0, Math.min(100, Math.round((remainingUsd / cap) * 100))) : undefined;
    return [
      {
        id: 'openrouter-main',
        name: label,
        remainingPct,
        balanceAmount: remainingUsd,
        balanceCurrency: 'USD',
        budgetCapAmount: cap,
      },
    ];
  }

  if (budgetCapUsd && budgetCapUsd > 0) {
    const remainingUsd = Math.max(0, budgetCapUsd - usage);
    const remainingPct = Math.max(0, Math.min(100, Math.round((remainingUsd / budgetCapUsd) * 100)));
    return [
      {
        id: 'openrouter-main',
        name: label,
        remainingPct,
        balanceAmount: remainingUsd,
        balanceCurrency: 'USD',
        budgetCapAmount: budgetCapUsd,
      },
    ];
  }

  return [
    {
      id: 'openrouter-main',
      name: label,
      balanceAmount: usage,
      balanceCurrency: 'USD',
    },
  ];
}

async function defaultFetchJson<T>(url: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`OpenRouter HTTP ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface OpenRouterProviderOptions {
  secretStore?: SecretStore;
  fetchJson?: <T>(url: string, apiKey: string) => Promise<T>;
}

export class OpenRouterProvider implements QuotaProvider {
  readonly id = 'openrouter';
  private readonly secretStore?: SecretStore;
  private readonly fetchJson: <T>(url: string, apiKey: string) => Promise<T>;
  private cachedSnapshot: ProviderSnapshot | null = null;
  private inFlight: Promise<ProviderSnapshot> | null = null;

  constructor(options?: OpenRouterProviderOptions) {
    this.secretStore = options?.secretStore;
    this.fetchJson = options?.fetchJson ?? defaultFetchJson;
  }

  async fetchSnapshot(config: MonitorConfig): Promise<ProviderSnapshot> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.performFetch(config).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performFetch(config: MonitorConfig): Promise<ProviderSnapshot> {
    const apiKey = (await this.secretStore?.get(providerSecretKey(this.id)))?.trim();
    if (!apiKey) {
      this.cachedSnapshot = null;
      return {
        id: this.id,
        shortCode: 'OR',
        name: 'OpenRouter',
        status: 'not_connected',
        sourceKind: 'Not connected',
        pools: [],
        requiresConnect: true,
        note: 'Connect your OpenRouter API key to track credits',
      };
    }

    try {
      const keyData = await this.fetchJson<OpenRouterKeyResponse>(OPENROUTER_KEY_URL, apiKey);
      let creditsData: OpenRouterCreditsResponse | null = null;
      if (keyData?.data?.limit === null || keyData?.data?.limit === undefined) {
        try {
          creditsData = await this.fetchJson<OpenRouterCreditsResponse>(OPENROUTER_CREDITS_URL, apiKey);
        } catch {
          // /credits requires a provisioning key; ignore if standard API key cannot access it
        }
      }

      const pools = parseOpenRouterResponse(keyData, creditsData, config.budgets?.openrouter);
      if (pools.length === 0) {
        throw new Error('OpenRouter returned empty key metadata');
      }

      const snap: ProviderSnapshot = {
        id: this.id,
        shortCode: 'OR',
        name: 'OpenRouter',
        status: 'live',
        sourceKind: 'Exact',
        pools,
      };
      this.cachedSnapshot = snap;
      return snap;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        this.cachedSnapshot = null;
        return {
          id: this.id,
          shortCode: 'OR',
          name: 'OpenRouter',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          requiresConnect: true,
          note: 'Invalid or revoked OpenRouter API key',
        };
      }
      if (this.cachedSnapshot) {
        return this.cachedSnapshot;
      }
      return {
        id: this.id,
        shortCode: 'OR',
        name: 'OpenRouter',
        status: 'unavailable',
        sourceKind: 'Unavailable',
        pools: [],
        note: err instanceof Error ? err.message : 'OpenRouter unavailable',
      };
    }
  }
}
