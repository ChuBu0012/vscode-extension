import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ModelPoolSnapshot,
  MonitorConfig,
  ProviderSnapshot,
  QuotaProvider,
  effectiveRemainingPct,
} from '../types';

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export interface CodexRateLimitWindow {
  used_percent?: number | null;
  limit_window_seconds?: number | null;
  reset_after_seconds?: number | null;
  reset_at?: number | null;
}

export interface CodexUsageApiResponse {
  plan_type?: string | null;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: CodexRateLimitWindow | null;
    secondary_window?: CodexRateLimitWindow | null;
  } | null;
}

export interface CodexCredentials {
  accessToken: string;
  accountId?: string;
}

function toRemainingPct(usedPercent: unknown): number | undefined {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function toIsoFromEpochSeconds(epochSec: unknown): string | undefined {
  if (typeof epochSec !== 'number' || !Number.isFinite(epochSec) || epochSec <= 0) {
    return undefined;
  }
  return new Date(epochSec * 1000).toISOString();
}

export function parseCodexUsageResponse(data: CodexUsageApiResponse): ModelPoolSnapshot[] {
  const primary = data.rate_limit?.primary_window;
  const secondary = data.rate_limit?.secondary_window;

  const primaryPct = toRemainingPct(primary?.used_percent);
  const secondaryPct = toRemainingPct(secondary?.used_percent);

  if (primaryPct === undefined && secondaryPct === undefined) {
    return [];
  }

  const plan = data.plan_type
    ? `Codex (${data.plan_type.charAt(0).toUpperCase() + data.plan_type.slice(1)})`
    : 'Codex Plan';

  return [
    {
      id: 'codex-main',
      name: plan,
      remainingPct: effectiveRemainingPct(secondaryPct, primaryPct),
      fiveHourPct: primaryPct,
      fiveHourReset: toIsoFromEpochSeconds(primary?.reset_at),
      weeklyPct: secondaryPct,
      weeklyReset: toIsoFromEpochSeconds(secondary?.reset_at),
    },
  ];
}

async function defaultLoadCredentials(): Promise<CodexCredentials | null> {
  try {
    const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
    const authPath = path.join(codexHome, 'auth.json');
    const raw = await fs.readFile(authPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      tokens?: {
        access_token?: string;
        account_id?: string;
      };
    };
    const token = parsed?.tokens?.access_token;
    if (!token) {
      return null;
    }
    return {
      accessToken: token,
      accountId: parsed.tokens?.account_id,
    };
  } catch {
    return null;
  }
}

async function defaultFetchUsageApi(creds: CodexCredentials): Promise<CodexUsageApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'codex-cli',
    };
    if (creds.accountId) {
      headers['ChatGPT-Account-Id'] = creds.accountId;
    }

    const res = await fetch(CODEX_USAGE_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`Codex usage HTTP ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as CodexUsageApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

export interface CodexProviderOptions {
  loadCredentials?: () => Promise<CodexCredentials | null>;
  fetchUsageApi?: (creds: CodexCredentials) => Promise<CodexUsageApiResponse>;
}

export class CodexProvider implements QuotaProvider {
  readonly id = 'codex';
  private readonly loadCredentials: () => Promise<CodexCredentials | null>;
  private readonly fetchUsageApi: (creds: CodexCredentials) => Promise<CodexUsageApiResponse>;
  private cachedSnapshot: ProviderSnapshot | null = null;
  private inFlight: Promise<ProviderSnapshot> | null = null;

  constructor(options?: CodexProviderOptions) {
    this.loadCredentials = options?.loadCredentials ?? defaultLoadCredentials;
    this.fetchUsageApi = options?.fetchUsageApi ?? defaultFetchUsageApi;
  }

  async fetchSnapshot(_config: MonitorConfig): Promise<ProviderSnapshot> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.performFetch().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async performFetch(): Promise<ProviderSnapshot> {
    try {
      const creds = await this.loadCredentials();
      if (!creds) {
        return {
          id: this.id,
          shortCode: 'CX',
          name: 'Codex',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          note: 'Sign in to Codex to enable usage tracking',
        };
      }

      const data = await this.fetchUsageApi(creds);
      const pools = parseCodexUsageResponse(data);
      if (pools.length === 0) {
        throw new Error('Codex usage API returned no rate limit windows');
      }

      const snapshot: ProviderSnapshot = {
        id: this.id,
        shortCode: 'CX',
        name: 'Codex',
        status: 'live',
        sourceKind: 'Exact',
        pools,
      };
      this.cachedSnapshot = snapshot;
      return snapshot;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        return {
          id: this.id,
          shortCode: 'CX',
          name: 'Codex',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          note: 'Codex OAuth token expired — open Codex to refresh',
        };
      }
      if (this.cachedSnapshot) {
        return this.cachedSnapshot;
      }
      return {
        id: this.id,
        shortCode: 'CX',
        name: 'Codex',
        status: 'unavailable',
        sourceKind: 'Unavailable',
        pools: [],
        note: err instanceof Error ? err.message : 'Codex usage unavailable',
      };
    }
  }
}
