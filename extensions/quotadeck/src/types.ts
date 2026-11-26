export type ProviderStatus = 'live' | 'coming_soon' | 'unavailable';

export interface ModelPoolSnapshot {
  id: string;
  name: string;
  remainingPct: number;
  displayMode?: 'remaining' | 'used';
  weeklyPct?: number;
  weeklyReset?: string;
  fiveHourPct?: number;
  fiveHourReset?: string;
}

export interface ProviderSnapshot {
  id: string;
  shortCode: string;
  name: string;
  status: ProviderStatus;
  sourceKind: 'Exact' | 'Coming soon' | 'Unavailable';
  pools: ModelPoolSnapshot[];
  note?: string;
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
export type StatusBarProviderKey = 'agy-gemini' | 'agy-claude' | 'claude' | 'codex';

export interface MonitorConfig {
  pollingIntervalSeconds: number;
  displayMode: QuotaDisplayMode;
  statusBarProviders: StatusBarProviderKey[];
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
  if (pools.length === 0) {
    return 0;
  }
  const sum = pools.reduce((acc, p) => acc + p.remainingPct, 0);
  return Math.round(sum / pools.length);
}
