import { execFile } from 'child_process';
import { promisify } from 'util';
import { isAllowedCustomHttpUrl } from '../configValidation';
import { SecretStore } from '../secrets';
import { CustomProviderConfig, ModelPoolSnapshot, ProviderSnapshot } from '../types';

const execFileAsync = promisify(execFile);
const BLOCKED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function extractJsonPath(root: unknown, dotPath: string): unknown {
  if (!dotPath || root === null || root === undefined) {
    return undefined;
  }
  let current: unknown = root;
  for (const rawSeg of dotPath.split('.')) {
    const seg = rawSeg.trim();
    if (!seg || BLOCKED_SEGMENTS.has(seg)) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }
      current = current[idx];
    } else if (current && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, seg)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

export interface CustomRunnerDeps {
  secretStore?: SecretStore;
  fetchHttp?: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  runCli?: (cmd: string, args: string[], timeoutMs: number) => Promise<string>;
}

async function defaultRunCli(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  const isWin = process.platform === 'win32';
  const useShell = isWin && /\.(cmd|bat)$/i.test(cmd);
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: timeoutMs,
    windowsHide: true,
    shell: useShell,
  });
  return stdout;
}

export async function fetchCustomProviderSnapshot(
  cfg: CustomProviderConfig,
  deps?: CustomRunnerDeps
): Promise<ProviderSnapshot> {
  const providerId = `custom:${cfg.id}`;
  try {
    let secretVal: string | undefined;
    if (cfg.secretKey && deps?.secretStore) {
      secretVal = (await deps.secretStore.get(cfg.secretKey))?.trim();
      if (!secretVal) {
        return {
          id: providerId,
          shortCode: cfg.shortCode,
          name: cfg.name,
          status: 'not_connected',
          sourceKind: 'Not connected',
          pools: [],
          requiresConnect: true,
          note: `Connect secret "${cfg.secretKey}" to enable ${cfg.name}`,
        };
      }
    }

    let payload: unknown;
    if (cfg.kind === 'http') {
      if (!cfg.url || !isAllowedCustomHttpUrl(cfg.url)) {
        throw new Error('Custom HTTP URL must use https:// or localhost');
      }
      const headers: Record<string, string> = { Accept: 'application/json' };
      let injectedViaTemplate = false;
      if (cfg.headers) {
        for (const [k, v] of Object.entries(cfg.headers)) {
          if (secretVal && v.includes('{{SECRET}}')) {
            headers[k] = v.replace(/\{\{SECRET\}\}/g, secretVal);
            injectedViaTemplate = true;
          } else {
            headers[k] = v;
          }
        }
      }
      if (secretVal && !injectedViaTemplate && !headers['Authorization'] && !headers['authorization']) {
        headers['Authorization'] = `Bearer ${secretVal}`;
      }

      const controller = new AbortController();
      const timeout = cfg.timeoutMs ?? 10000;
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const doFetch = deps?.fetchHttp ?? ((u, init) => fetch(u, init));
        const res = await doFetch(cfg.url, {
          method: cfg.method ?? 'GET',
          headers,
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        payload = await res.json();
      } finally {
        clearTimeout(timer);
      }
    } else {
      if (!cfg.command) {
        throw new Error('Custom CLI provider requires a command');
      }
      const runCli = deps?.runCli ?? defaultRunCli;
      const stdout = await runCli(cfg.command, cfg.args ?? [], cfg.timeoutMs ?? 10000);
      payload = JSON.parse(stdout.trim());
    }

    const rawVal = extractJsonPath(payload, cfg.valuePath);
    const numVal = typeof rawVal === 'number' ? rawVal : typeof rawVal === 'string' ? Number(rawVal) : NaN;
    if (!Number.isFinite(numVal)) {
      throw new Error(`Value not found at path "${cfg.valuePath}"`);
    }

    const rawReset = cfg.resetPath ? extractJsonPath(payload, cfg.resetPath) : undefined;
    const resetStr = typeof rawReset === 'string' ? rawReset : undefined;

    const pool: ModelPoolSnapshot = {
      id: `${cfg.id}-main`,
      name: cfg.name,
      fiveHourReset: resetStr,
    };

    if (cfg.valueType === 'percentage') {
      pool.remainingPct = Math.max(0, Math.min(100, Math.round(numVal)));
    } else if (cfg.valueType === 'used_percentage') {
      pool.remainingPct = Math.max(0, Math.min(100, Math.round(100 - numVal)));
    } else {
      const bal = Math.max(0, numVal);
      pool.balanceAmount = bal;
      pool.balanceCurrency = 'USD';
      if (cfg.budgetCapUsd && cfg.budgetCapUsd > 0) {
        pool.budgetCapAmount = cfg.budgetCapUsd;
        pool.remainingPct = Math.max(0, Math.min(100, Math.round((bal / cfg.budgetCapUsd) * 100)));
      }
    }

    return {
      id: providerId,
      shortCode: cfg.shortCode,
      name: cfg.name,
      status: 'live',
      sourceKind: 'Exact',
      pools: [pool],
    };
  } catch (err) {
    return {
      id: providerId,
      shortCode: cfg.shortCode,
      name: cfg.name,
      status: 'unavailable',
      sourceKind: 'Unavailable',
      pools: [],
      note: err instanceof Error ? err.message : 'Custom provider failed',
    };
  }
}
