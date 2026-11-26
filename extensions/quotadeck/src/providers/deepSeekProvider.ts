import { SecretStore, providerSecretKey } from '../secrets';
import { ModelPoolSnapshot, MonitorConfig, ProviderSnapshot, QuotaProvider } from '../types';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';

export interface DeepSeekBalanceInfo {
  currency?: string;
  total_balance?: string;
  granted_balance?: string;
  topped_up_balance?: string;
}

export interface DeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: DeepSeekBalanceInfo[];
}

export function parseDeepSeekBalanceResponse(
  data: DeepSeekBalanceResponse,
  budgetCapUsd?: number
): ModelPoolSnapshot[] {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  if (infos.length === 0 && typeof data?.is_available !== 'boolean') {
    return [];
  }

  const preferred = infos.find((b) => (b.currency ?? '').toUpperCase() === 'USD') ?? infos[0];
  const parsed = preferred ? Number(preferred.total_balance) : 0;
  const balanceAmount = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  const currency = preferred?.currency?.trim().toUpperCase() || 'USD';

  let remainingPct: number | undefined;
  let budgetCapAmount: number | undefined;
  if (budgetCapUsd && budgetCapUsd > 0) {
    budgetCapAmount = budgetCapUsd;
    remainingPct = Math.max(0, Math.min(100, Math.round((balanceAmount / budgetCapUsd) * 100)));
  } else if (data?.is_available === false && balanceAmount <= 0) {
    remainingPct = 0;
  }

  return [
    {
      id: 'deepseek-main',
      name: 'DeepSeek Balance',
      remainingPct,
      balanceAmount,
      balanceCurrency: currency,
      budgetCapAmount,
    },
  ];
}

async function defaultFetchBalance(apiKey: string): Promise<DeepSeekBalanceResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(DEEPSEEK_BALANCE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`DeepSeek HTTP ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as DeepSeekBalanceResponse;
  } finally {
    clearTimeout(timer);
  }
}

export interface DeepSeekProviderOptions {
  secretStore?: SecretStore;
  fetchBalance?: (apiKey: string) => Promise<DeepSeekBalanceResponse>;
}

export class DeepSeekProvider implements QuotaProvider {
  readonly id = 'deepseek';
  private readonly secretStore?: SecretStore;
  private readonly fetchBalance: (apiKey: string) => Promise<DeepSeekBalanceResponse>;
  private cachedSnapshot: ProviderSnapshot | null = null;
  private inFlight: Promise<ProviderSnapshot> | null = null;

  constructor(options?: DeepSeekProviderOptions) {
    this.secretStore = options?.secretStore;
    this.fetchBalance = options?.fetchBalance ?? defaultFetchBalance;
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
        shortCode: 'DS',
        name: 'DeepSeek',
        status: 'not_connected',
        sourceKind: 'Not connected',
        pools: [],
        requiresConnect: true,
        note: 'Connect your DeepSeek API key to track balance',
      };
    }

    try {
      const data = await this.fetchBalance(apiKey);
      const pools = parseDeepSeekBalanceResponse(data, config.budgets?.deepseek);
      if (pools.length === 0) {
        throw new Error('DeepSeek returned no balance info');
      }

      const snap: ProviderSnapshot = {
        id: this.id,
        shortCode: 'DS',
        name: 'DeepSeek',
        status: 'live',
        sourceKind: 'Exact',
        pools,
        note: data.is_available === false ? 'DeepSeek account balance depleted' : undefined,
      };
      this.cachedSnapshot = snap;
      return snap;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        this.cachedSnapshot = null;
        return {
          id: this.id,
          shortCode: 'DS',
          name: 'DeepSeek',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          requiresConnect: true,
          note: 'Invalid or revoked DeepSeek API key',
        };
      }
      if (this.cachedSnapshot) {
        return this.cachedSnapshot;
      }
      return {
        id: this.id,
        shortCode: 'DS',
        name: 'DeepSeek',
        status: 'unavailable',
        sourceKind: 'Unavailable',
        pools: [],
        note: err instanceof Error ? err.message : 'DeepSeek unavailable',
      };
    }
  }
}
