import { SecretStore, providerSecretKey } from '../secrets';
import { ModelPoolSnapshot, MonitorConfig, ProviderSnapshot, QuotaProvider, effectiveRemainingPct } from '../types';

const CLINE_ME_URL = 'https://api.cline.bot/api/v1/users/me';
const CLINE_LIMITS_URL = 'https://api.cline.bot/api/v1/users/me/plan/usage-limits';

export interface ClineWindowData {
  remaining_pct?: number | null;
  remainingPct?: number | null;
  utilization?: number | null;
  used_percent?: number | null;
  resets_at?: string | null;
  resetsAt?: string | null;
}

export interface ClineUsageLimitsResponse {
  five_hour?: ClineWindowData | null;
  fiveHour?: ClineWindowData | null;
  seven_day?: ClineWindowData | null;
  weekly?: ClineWindowData | null;
  monthly?: ClineWindowData | null;
}

export interface ClineBalanceResponse {
  balance?: number | null;
  balanceUsd?: number | null;
}

function extractRemainingPct(win?: ClineWindowData | null): number | undefined {
  if (!win || typeof win !== 'object') {
    return undefined;
  }
  const direct = win.remainingPct ?? win.remaining_pct;
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return Math.max(0, Math.min(100, Math.round(direct)));
  }
  const used = win.utilization ?? win.used_percent;
  if (typeof used === 'number' && Number.isFinite(used)) {
    return Math.max(0, Math.min(100, Math.round(100 - used)));
  }
  return undefined;
}

export function parseClineUsageResponse(
  limits?: ClineUsageLimitsResponse | null,
  balanceData?: ClineBalanceResponse | null,
  budgetCapUsd?: number
): ModelPoolSnapshot[] {
  const fiveWin = limits?.fiveHour ?? limits?.five_hour;
  const weekWin = limits?.weekly ?? limits?.seven_day ?? limits?.monthly;

  const fiveHourPct = extractRemainingPct(fiveWin);
  const weeklyPct = extractRemainingPct(weekWin);
  const rawBalance = balanceData?.balanceUsd ?? balanceData?.balance;
  const balanceAmount =
    typeof rawBalance === 'number' && Number.isFinite(rawBalance) ? Math.max(0, rawBalance) : undefined;

  if (fiveHourPct === undefined && weeklyPct === undefined && balanceAmount === undefined) {
    return [];
  }

  let remainingPct: number | undefined;
  let budgetCapAmount: number | undefined;
  if (fiveHourPct !== undefined || weeklyPct !== undefined) {
    remainingPct = effectiveRemainingPct(weeklyPct, fiveHourPct);
  } else if (balanceAmount !== undefined && budgetCapUsd && budgetCapUsd > 0) {
    budgetCapAmount = budgetCapUsd;
    remainingPct = Math.max(0, Math.min(100, Math.round((balanceAmount / budgetCapUsd) * 100)));
  }

  return [
    {
      id: 'cline-main',
      name: fiveHourPct !== undefined || weeklyPct !== undefined ? 'ClinePass' : 'Cline Credits',
      remainingPct,
      fiveHourPct,
      fiveHourReset: fiveWin?.resetsAt ?? fiveWin?.resets_at ?? undefined,
      weeklyPct,
      weeklyReset: weekWin?.resetsAt ?? weekWin?.resets_at ?? undefined,
      balanceAmount,
      balanceCurrency: balanceAmount !== undefined ? 'USD' : undefined,
      budgetCapAmount,
    },
  ];
}

async function defaultFetchJson<T>(url: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`Cline HTTP ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface ClineProviderOptions {
  secretStore?: SecretStore;
  fetchJson?: <T>(url: string, token: string) => Promise<T>;
}

export class ClineProvider implements QuotaProvider {
  readonly id = 'cline';
  private readonly secretStore?: SecretStore;
  private readonly fetchJson: <T>(url: string, token: string) => Promise<T>;
  private cachedSnapshot: ProviderSnapshot | null = null;
  private inFlight: Promise<ProviderSnapshot> | null = null;

  constructor(options?: ClineProviderOptions) {
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
    const token = (await this.secretStore?.get(providerSecretKey(this.id)))?.trim();
    if (!token) {
      this.cachedSnapshot = null;
      return {
        id: this.id,
        shortCode: 'CN',
        name: 'Cline',
        status: 'not_connected',
        sourceKind: 'Not connected',
        pools: [],
        requiresConnect: true,
        note: 'Connect your Cline token to track limits or balance',
      };
    }

    try {
      let limitsData: ClineUsageLimitsResponse | null = null;
      let balanceData: ClineBalanceResponse | null = null;

      try {
        limitsData = await this.fetchJson<ClineUsageLimitsResponse>(CLINE_LIMITS_URL, token);
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) {
          throw err;
        }
      }

      try {
        const me = await this.fetchJson<{ id?: string }>(CLINE_ME_URL, token);
        if (me?.id) {
          balanceData = await this.fetchJson<ClineBalanceResponse>(
            `https://api.cline.bot/api/v1/users/${encodeURIComponent(me.id)}/balance`,
            token
          );
        }
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) {
          throw err;
        }
      }

      const pools = parseClineUsageResponse(limitsData, balanceData, config.budgets?.cline);
      if (pools.length === 0) {
        throw new Error('Cline returned no quota limits or balance');
      }

      const snap: ProviderSnapshot = {
        id: this.id,
        shortCode: 'CN',
        name: 'Cline',
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
          shortCode: 'CN',
          name: 'Cline',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          requiresConnect: true,
          note: 'Invalid or expired Cline token',
        };
      }
      if (this.cachedSnapshot) {
        return this.cachedSnapshot;
      }
      return {
        id: this.id,
        shortCode: 'CN',
        name: 'Cline',
        status: 'unavailable',
        sourceKind: 'Unavailable',
        pools: [],
        note: err instanceof Error ? err.message : 'Cline unavailable',
      };
    }
  }
}
