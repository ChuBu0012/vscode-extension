import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore } from '../src/storage/historyStore';
import { ProviderSnapshot } from '../src/types';

function makeSnapshot(id: string, _usedTokens: number, remainingPct: number): ProviderSnapshot {
  return {
    id,
    shortCode: id.slice(0, 2).toUpperCase(),
    name: id,
    status: 'live',
    sourceKind: 'Exact',
    pools: [{ id: `${id}-p`, name: 'Pool', remainingPct }],
  };
}

describe('HistoryStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'history-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when history file does not exist', async () => {
    const store = new HistoryStore(tmpDir);
    expect(await store.readRecent()).toEqual([]);
  });

  it('appends and reads recent snapshots safely, ignoring malformed lines', async () => {
    const store = new HistoryStore(tmpDir);
    await store.appendSnapshot([makeSnapshot('claude', 200, 80)]);

    const filePath = path.join(tmpDir, 'history.ndjson');
    await fs.appendFile(
      filePath,
      'not-json\n{"bad":true}\n{"timestamp":"bad-date","providers":[]}\n{"timestamp":"2026-01-01T00:00:00.000Z","providers":[null]}\n{"timestamp":"2026-01-01T00:00:00.000Z","providers":[{"id":"claude","remainingPct":"NaN","usedTokens":0}]}\n',
      'utf8'
    );
    await store.appendSnapshot([makeSnapshot('claude', 400, 60)]);

    const pts = await store.readRecent(10);
    expect(pts).toHaveLength(2);
    expect(pts[0].providers[0].remainingPct).toBe(80);
    expect(pts[1].providers[0].remainingPct).toBe(60);
  });

  it('compacts history file when exceeding maxLines and handles concurrent appends', async () => {
    const store = new HistoryStore(tmpDir, 5);
    await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        store.appendSnapshot([makeSnapshot('codex', (idx + 1) * 100, 90)])
      )
    );

    const pts = await store.readRecent(10);
    expect(pts).toHaveLength(5);

    const raw = await fs.readFile(path.join(tmpDir, 'history.ndjson'), 'utf8');
    const diskLines = raw.split('\n').filter(Boolean);
    expect(diskLines).toHaveLength(5);
  });

  it('records per-pool 5h/weekly and USD balance entries while keeping legacy compatibility', async () => {
    const store = new HistoryStore(tmpDir);
    await store.appendSnapshot([
      {
        id: 'claude',
        shortCode: 'CL',
        name: 'Claude Code',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'claude-main', name: 'Claude (Pro)', remainingPct: 60, fiveHourPct: 60, weeklyPct: 40 }],
      },
      {
        id: 'deepseek',
        shortCode: 'DS',
        name: 'DeepSeek',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'deepseek-main', name: 'DeepSeek Balance', balanceAmount: 12.5, balanceCurrency: 'USD' }],
      },
    ]);

    const pts = await store.readRecent(10);
    expect(pts).toHaveLength(1);
    expect(pts[0].providers).toHaveLength(2);
    expect(pts[0].providers[0].pools?.[0].fiveHourPct).toBe(60);
    expect(pts[0].providers[0].pools?.[0].weeklyPct).toBe(40);
    expect(pts[0].providers[1].balanceAmount).toBe(12.5);
    expect(pts[0].providers[1].balanceCurrency).toBe('USD');
  });
});
