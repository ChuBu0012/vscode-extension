export type ProviderStatus = 'live' | 'coming_soon' | 'unavailable' | 'not_connected';

export interface ModelPoolSnapshot {
  id: string;
  name: string;
  remainingPct?: number;
  displayMode?: 'remaining' | 'used';
  weeklyPct?: number;
  weeklyReset?: string;
  fiveHourPct?: number;
  fiveHourReset?: string;
  balanceAmount?: number;
  balanceCurrency?: string;
  budgetCapAmount?: number;
}

export interface ProviderSnapshot {
  id: string;
  shortCode: string;
  name: string;
  status: ProviderStatus;
  sourceKind: 'Exact' | 'Coming soon' | 'Unavailable' | 'Not connected';
  pools: ModelPoolSnapshot[];
  note?: string;
  requiresConnect?: boolean;
}

export interface HistoryPoint {
  timestamp: string;
  providers: Array<{
    id: string;
    remainingPct: number;
    usedTokens: number;
  }>;
}

export type QuotaDisplayMode = 'remaining' | 'used';
export type StatusBarProviderKey = string;

export interface BudgetConfig {
  openrouter?: number;
  deepseek?: number;
  cline?: number;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  shortCode: string;
  kind: 'http' | 'cli';
  url?: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  secretKey?: string;
  valueType: 'percentage' | 'used_percentage' | 'balance_usd';
  valuePath: string;
  resetPath?: string;
  budgetCapUsd?: number;
}

export interface MonitorConfig {
  pollingIntervalSeconds: number;
  displayMode: QuotaDisplayMode;
  statusBarProviders: StatusBarProviderKey[];
  budgets?: BudgetConfig;
  customProviders?: CustomProviderConfig[];
}

export interface QuotaProvider {
  readonly id: string;
  fetchSnapshot(config: MonitorConfig): Promise<ProviderSnapshot>;
}

export function effectiveRemainingPct(
  weeklyPct?: number,
  fiveHourPct?: number
): number {
  if (weeklyPct === 0) {
    return 0;
  }
  if (typeof fiveHourPct === 'number') {
    return fiveHourPct;
  }
  if (typeof weeklyPct === 'number') {
    return weeklyPct;
  }
  return 0;
}

export function averageRemainingPct(pools: ModelPoolSnapshot[]): number {
  const numericPools = pools.filter((p) => typeof p.remainingPct === 'number' && Number.isFinite(p.remainingPct));
  if (numericPools.length === 0) {
    return 0;
  }
  const sum = numericPools.reduce((acc, p) => acc + (p.remainingPct ?? 0), 0);
  return Math.round(sum / numericPools.length);
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const upper = currency.toUpperCase();
  const symbol = upper === 'CNY' || upper === 'RMB' ? '¥' : upper === 'EUR' ? '€' : upper === 'GBP' ? '£' : '$';
  return `${symbol}${safe.toFixed(2)}`;
}
