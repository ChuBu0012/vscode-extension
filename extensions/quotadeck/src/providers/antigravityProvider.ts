import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { ModelPoolSnapshot, MonitorConfig, ProviderSnapshot, QuotaProvider, effectiveRemainingPct } from '../types';

const execFileAsync = promisify(execFile);

export function parseAgyUsageOutput(output: string): ModelPoolSnapshot[] {
  const poolsMap = new Map<string, ModelPoolSnapshot>();
  const lineRegex = /^(.+?)\s+(Weekly|Five Hour)\s+Limit\s+Remaining\s+(\d+)%\s+(.+)$/i;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = lineRegex.exec(line);
    if (!match) {
      continue;
    }
    const groupName = match[1].trim();
    const windowType = match[2].toLowerCase();
    const pct = Math.max(0, Math.min(100, Number(match[3])));
    const resetAt = match[4].trim();

    const id = groupName.toLowerCase().includes('gemini')
      ? 'agy-gemini'
      : groupName.toLowerCase().includes('claude')
        ? 'agy-claude'
        : `agy-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const existing = poolsMap.get(id) ?? {
      id,
      name: groupName,
      remainingPct: pct,
    };

    if (windowType === 'weekly') {
      existing.weeklyPct = pct;
      existing.weeklyReset = resetAt;
    } else {
      existing.fiveHourPct = pct;
      existing.fiveHourReset = resetAt;
    }

    existing.remainingPct = effectiveRemainingPct(existing.weeklyPct, existing.fiveHourPct);

    poolsMap.set(id, existing);
  }

  return Array.from(poolsMap.values());
}

async function defaultFetchUsageOutput(): Promise<string> {
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [
        'agy.cmd',
        'agy.exe',
        'agy',
        path.join(os.homedir(), '.local', 'bin', 'agy.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'bin', 'agy.cmd'),
        path.join(process.env.APPDATA || '', 'npm', 'agy.cmd'),
      ].filter(Boolean)
    : [
        'agy',
        path.join(os.homedir(), '.local', 'bin', 'agy'),
        '/opt/homebrew/bin/agy',
        '/usr/local/bin/agy',
      ];

  let lastErr: unknown;
  for (const bin of candidates) {
    try {
      const useShell = isWin && /\.(cmd|bat)$/i.test(bin);
      const { stdout } = await execFileAsync(
        bin,
        ['--dangerously-skip-permissions', '-p', '/usage', '--print-timeout', '15s'],
        { timeout: 18000, windowsHide: true, shell: useShell }
      );
      if (stdout && stdout.trim()) {
        return stdout;
      }
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT' || code === 'EACCES') {
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('agy CLI not found');
}

export interface AntigravityProviderOptions {
  fetchUsageOutput?: () => Promise<string>;
}

export class AntigravityProvider implements QuotaProvider {
  readonly id = 'agy';
  private readonly fetchUsageOutput: () => Promise<string>;
  private cachedSnapshot: ProviderSnapshot | null = null;
  private inFlight: Promise<ProviderSnapshot> | null = null;

  constructor(options?: AntigravityProviderOptions) {
    this.fetchUsageOutput = options?.fetchUsageOutput ?? defaultFetchUsageOutput;
  }

  async fetchSnapshot(_config: MonitorConfig): Promise<ProviderSnapshot> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runFetch();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async runFetch(): Promise<ProviderSnapshot> {
    try {
      const raw = await this.fetchUsageOutput();
      const pools = parseAgyUsageOutput(raw);
      if (pools.length === 0) {
        throw new Error('Could not parse quota lines from agy /usage output');
      }

      const snap: ProviderSnapshot = {
        id: this.id,
        shortCode: 'AG',
        name: 'Antigravity',
        status: 'live',
        sourceKind: 'Exact',
        pools,
      };
      this.cachedSnapshot = snap;
      return snap;
    } catch (err) {
      if (this.cachedSnapshot) {
        return {
          ...this.cachedSnapshot,
          note: `Showing cached data (${err instanceof Error ? err.message : 'agy CLI failed'})`,
        };
      }
      const errCode = (err as { code?: string })?.code;
      const isNotInstalled = errCode === 'ENOENT' || (err instanceof Error && err.message === 'agy CLI not found');
      return {
        id: this.id,
        shortCode: 'AG',
        name: 'Antigravity',
        status: isNotInstalled ? 'not_connected' : 'unavailable',
        sourceKind: 'Unavailable',
        pools: [],
        note: isNotInstalled ? 'agy CLI not installed' : (err instanceof Error ? err.message : 'agy CLI unavailable'),
      };
    }
  }
}
