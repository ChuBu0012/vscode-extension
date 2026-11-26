import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
  ModelPoolSnapshot,
  MonitorConfig,
  ProviderSnapshot,
  QuotaProvider,
  effectiveRemainingPct,
} from '../types';

const execFileAsync = promisify(execFile);

const CLAUDE_OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export interface ClaudeOAuthWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

export interface ClaudeUsageApiResponse {
  five_hour?: ClaudeOAuthWindow | null;
  seven_day?: ClaudeOAuthWindow | null;
  seven_day_sonnet?: ClaudeOAuthWindow | null;
  seven_day_opus?: ClaudeOAuthWindow | null;
}

interface ClaudeCredentials {
  accessToken: string;
  expiresAt?: number;
  subscriptionType?: string;
}

function toRemainingPct(utilization: unknown): number | undefined {
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(100 - utilization)));
}

export function parseClaudeUsageResponse(
  data: ClaudeUsageApiResponse,
  subscriptionType?: string
): ModelPoolSnapshot[] {
  const fiveHourPct = toRemainingPct(data.five_hour?.utilization);
  const weeklyPct = toRemainingPct(data.seven_day?.utilization);

  if (fiveHourPct === undefined && weeklyPct === undefined) {
    return [];
  }

  const label = subscriptionType
    ? `Claude (${subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1)})`
    : 'Claude Plan';

  const pools: ModelPoolSnapshot[] = [
    {
      id: 'claude-main',
      name: label,
      remainingPct: effectiveRemainingPct(weeklyPct, fiveHourPct),
      displayMode: 'used',
      fiveHourPct,
      fiveHourReset: data.five_hour?.resets_at ?? undefined,
      weeklyPct,
      weeklyReset: data.seven_day?.resets_at ?? undefined,
    },
  ];

  const sonnetWeekly = toRemainingPct(data.seven_day_sonnet?.utilization);
  if (sonnetWeekly !== undefined) {
    pools.push({
      id: 'claude-sonnet',
      name: 'Claude Sonnet (Weekly)',
      remainingPct: sonnetWeekly,
      displayMode: 'used',
      weeklyPct: sonnetWeekly,
      weeklyReset: data.seven_day_sonnet?.resets_at ?? undefined,
    });
  }

  const opusWeekly = toRemainingPct(data.seven_day_opus?.utilization);
  if (opusWeekly !== undefined) {
    pools.push({
      id: 'claude-opus',
      name: 'Claude Opus (Weekly)',
      remainingPct: opusWeekly,
      displayMode: 'used',
      weeklyPct: opusWeekly,
      weeklyReset: data.seven_day_opus?.resets_at ?? undefined,
    });
  }

  return pools;
}

async function readCredentialsFromMacKeychain(): Promise<ClaudeCredentials | null> {
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 5000 }
    );
    const parsed = JSON.parse(stdout.trim()) as {
      claudeAiOauth?: {
        accessToken?: string;
        expiresAt?: number;
        subscriptionType?: string;
      };
    };
    const token = parsed?.claudeAiOauth?.accessToken;
    if (!token) {
      return null;
    }
    return {
      accessToken: token,
      expiresAt: parsed.claudeAiOauth?.expiresAt,
      subscriptionType: parsed.claudeAiOauth?.subscriptionType,
    };
  } catch {
    return null;
  }
}

async function readCredentialsFromFile(): Promise<ClaudeCredentials | null> {
  try {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
    const credPath = path.join(claudeDir, '.credentials.json');
    const raw = await fs.readFile(credPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: string;
        expiresAt?: number;
        subscriptionType?: string;
      };
    };
    const token = parsed?.claudeAiOauth?.accessToken;
    if (!token) {
      return null;
    }
    return {
      accessToken: token,
      expiresAt: parsed.claudeAiOauth?.expiresAt,
      subscriptionType: parsed.claudeAiOauth?.subscriptionType,
    };
  } catch {
    return null;
  }
}

async function defaultLoadCredentials(): Promise<ClaudeCredentials | null> {
  if (process.platform === 'darwin') {
    const kc = await readCredentialsFromMacKeychain();
    if (kc && (!kc.expiresAt || Date.now() < kc.expiresAt)) {
      return kc;
    }
    const fileCreds = await readCredentialsFromFile();
    if (fileCreds) {
      return fileCreds;
    }
    return kc;
  }
  return readCredentialsFromFile();
}

async function defaultFetchUsageApi(accessToken: string): Promise<ClaudeUsageApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(CLAUDE_OAUTH_USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
        'User-Agent': 'claude-code/2.0.0',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`Claude OAuth usage HTTP ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as ClaudeUsageApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

export interface ClaudeCodeProviderOptions {
  loadCredentials?: () => Promise<ClaudeCredentials | null>;
  fetchUsageApi?: (accessToken: string) => Promise<ClaudeUsageApiResponse>;
}

export class ClaudeCodeProvider implements QuotaProvider {
  readonly id = 'claude';
  private readonly loadCredentials: () => Promise<ClaudeCredentials | null>;
  private readonly fetchUsageApi: (accessToken: string) => Promise<ClaudeUsageApiResponse>;
  private cachedSnapshot: ProviderSnapshot | null = null;
  private inFlight: Promise<ProviderSnapshot> | null = null;

  constructor(options?: ClaudeCodeProviderOptions) {
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
          shortCode: 'CL',
          name: 'Claude Code',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          note: 'Sign in to Claude Code to enable usage tracking',
        };
      }

      if (typeof creds.expiresAt === 'number' && creds.expiresAt > 0 && Date.now() >= creds.expiresAt) {
        return {
          id: this.id,
          shortCode: 'CL',
          name: 'Claude Code',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          note: 'Claude OAuth token expired — open Claude Code to refresh',
        };
      }

      const data = await this.fetchUsageApi(creds.accessToken);
      const pools = parseClaudeUsageResponse(data, creds.subscriptionType);
      if (pools.length === 0) {
        throw new Error('Claude usage API returned no quota windows');
      }

      const snapshot: ProviderSnapshot = {
        id: this.id,
        shortCode: 'CL',
        name: 'Claude Code',
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
          shortCode: 'CL',
          name: 'Claude Code',
          status: 'unavailable',
          sourceKind: 'Unavailable',
          pools: [],
          note: 'Claude OAuth token expired — open Claude Code to refresh',
        };
      }
      if (this.cachedSnapshot) {
        return this.cachedSnapshot;
      }
      return {
        id: this.id,
        shortCode: 'CL',
        name: 'Claude Code',
        status: 'unavailable',
        sourceKind: 'Unavailable',
        pools: [],
        note: err instanceof Error ? err.message : 'Claude usage unavailable',
      };
    }
  }
}
