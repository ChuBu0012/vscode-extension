import * as fs from 'fs/promises';
import * as path from 'path';
import { HistoryPoint, ProviderSnapshot, averageRemainingPct } from '../types';

export const DEFAULT_MAX_HISTORY_LINES = 2000;

function isValidHistoryPoint(val: unknown): val is HistoryPoint {
  if (!val || typeof val !== 'object') {
    return false;
  }
  const candidate = val as Partial<HistoryPoint>;
  if (typeof candidate.timestamp !== 'string' || !Number.isFinite(Date.parse(candidate.timestamp))) {
    return false;
  }
  if (!Array.isArray(candidate.providers)) {
    return false;
  }
  return candidate.providers.every(
    (p) =>
      p !== null &&
      typeof p === 'object' &&
      typeof p.id === 'string' &&
      typeof p.remainingPct === 'number' &&
      Number.isFinite(p.remainingPct) &&
      typeof p.usedTokens === 'number' &&
      Number.isFinite(p.usedTokens) &&
      (p.pools === undefined || Array.isArray(p.pools))
  );
}

export class HistoryStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageDir: string,
    private readonly maxLines = DEFAULT_MAX_HISTORY_LINES
  ) {
    this.filePath = path.join(storageDir, 'history.ndjson');
  }

  async appendSnapshot(snapshots: ProviderSnapshot[]): Promise<void> {
    const task = this.writeQueue.then(() => this.performAppend(snapshots));
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  async clear(): Promise<void> {
    const task = this.writeQueue.then(async () => {
      await fs.rm(this.filePath, { force: true });
    });
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  private async performAppend(snapshots: ProviderSnapshot[]): Promise<void> {
    const live = snapshots.filter(
      (s) =>
        s.status === 'live' &&
        s.pools.some((p) => typeof p.remainingPct === 'number' || typeof p.balanceAmount === 'number')
    );
    if (live.length === 0) {
      return;
    }
    await fs.mkdir(this.storageDir, { recursive: true });
    const entry: HistoryPoint = {
      timestamp: new Date().toISOString(),
      providers: live.map((s) => {
        const primaryBalPool = s.pools.find((p) => typeof p.balanceAmount === 'number');
        const hasNumericPct = s.pools.some((p) => typeof p.remainingPct === 'number');
        return {
          id: s.id,
          remainingPct: hasNumericPct ? averageRemainingPct(s.pools) : 0,
          usedTokens: 0,
          balanceAmount: primaryBalPool?.balanceAmount,
          balanceCurrency: primaryBalPool?.balanceCurrency,
          pools: s.pools.map((p) => ({
            id: p.id,
            name: p.name,
            remainingPct: p.remainingPct,
            fiveHourPct: p.fiveHourPct,
            weeklyPct: p.weeklyPct,
            balanceAmount: p.balanceAmount,
            balanceCurrency: p.balanceCurrency,
          })),
        };
      }),
    };
    await fs.appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    await this.compactIfNeeded();
  }

  private async compactIfNeeded(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      if (lines.length <= this.maxLines) {
        return;
      }
      const trimmed = lines.slice(-this.maxLines).join('\n') + '\n';
      const tmpPath = `${this.filePath}.tmp`;
      await fs.writeFile(tmpPath, trimmed, 'utf8');
      try {
        await fs.rename(tmpPath, this.filePath);
      } catch {
        // Fallback for Windows file-locking edge cases
        await fs.writeFile(this.filePath, trimmed, 'utf8');
        await fs.rm(tmpPath, { force: true });
      }
    } catch {
      // Best-effort compaction; do not break snapshot recording
    }
  }

  async readRecent(limit = 500): Promise<HistoryPoint[]> {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), this.maxLines));
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const slice = lines.slice(-safeLimit);
      const points: HistoryPoint[] = [];
      for (const line of slice) {
        try {
          const parsed: unknown = JSON.parse(line);
          if (isValidHistoryPoint(parsed)) {
            points.push(parsed);
          }
        } catch {
          // Ignore malformed line
        }
      }
      return points;
    } catch {
      return [];
    }
  }
}
