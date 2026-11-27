import { BudgetConfig, CustomProviderConfig } from './types';

export const MIN_POLLING_SECONDS = 30;
export const MAX_POLLING_SECONDS = 3600;
export const DEFAULT_LOW_THRESHOLD_PCT = 20;
export const DEFAULT_LOW_BALANCE_USD = 1;

export function sanitizeLowThresholdPct(value: unknown, fallback = DEFAULT_LOW_THRESHOLD_PCT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(90, Math.round(value)));
}

export function sanitizeLowBalanceUsd(value: unknown, fallback = DEFAULT_LOW_BALANCE_USD): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.round(value * 100) / 100;
}

export function sanitizePollingInterval(value: unknown, fallback = 300): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(MIN_POLLING_SECONDS, Math.min(MAX_POLLING_SECONDS, Math.round(value)));
}

export function sanitizeBudgetCap(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export function sanitizeBudgets(raw: unknown): BudgetConfig {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  return {
    openrouter: sanitizeBudgetCap(obj.openrouter),
    deepseek: sanitizeBudgetCap(obj.deepseek),
    cline: sanitizeBudgetCap(obj.cline),
  };
}

export function isAllowedCustomHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') {
      return true;
    }
    if (parsed.protocol === 'http:') {
      const host = parsed.hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    }
    return false;
  } catch {
    return false;
  }
}

const VALID_CUSTOM_ID = /^[a-z0-9][a-z0-9-_]{0,31}$/;

export function sanitizeCustomProviders(raw: unknown): CustomProviderConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: CustomProviderConfig[] = [];
  const seenIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim().toLowerCase() : '';
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const valuePath = typeof obj.valuePath === 'string' ? obj.valuePath.trim() : '';
    const kind = obj.kind === 'http' || obj.kind === 'cli' ? obj.kind : null;
    if (!id || !VALID_CUSTOM_ID.test(id) || seenIds.has(id) || !name || !valuePath || !kind) {
      continue;
    }

    const rawShort = typeof obj.shortCode === 'string' && obj.shortCode.trim()
      ? obj.shortCode.trim().toUpperCase().slice(0, 4)
      : id.slice(0, 2).toUpperCase();

    const valueType = obj.valueType === 'percentage' || obj.valueType === 'used_percentage' || obj.valueType === 'balance_usd'
      ? obj.valueType
      : 'percentage';

    const headers: Record<string, string> = {};
    if (obj.headers && typeof obj.headers === 'object' && !Array.isArray(obj.headers)) {
      for (const [k, v] of Object.entries(obj.headers as Record<string, unknown>)) {
        if (typeof v === 'string') {
          headers[k] = v;
        }
      }
    }

    const args = Array.isArray(obj.args)
      ? obj.args.filter((a): a is string => typeof a === 'string')
      : undefined;

    const timeoutRaw = typeof obj.timeoutMs === 'number' && Number.isFinite(obj.timeoutMs)
      ? Math.max(1000, Math.min(15000, Math.round(obj.timeoutMs)))
      : 10000;

    seenIds.add(id);
    result.push({
      id,
      name,
      shortCode: rawShort,
      kind,
      url: typeof obj.url === 'string' ? obj.url.trim() : undefined,
      method: obj.method === 'POST' ? 'POST' : 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      command: typeof obj.command === 'string' ? obj.command.trim() : undefined,
      args,
      timeoutMs: timeoutRaw,
      secretKey: typeof obj.secretKey === 'string' && obj.secretKey.trim() ? obj.secretKey.trim() : undefined,
      valueType,
      valuePath,
      resetPath: typeof obj.resetPath === 'string' && obj.resetPath.trim() ? obj.resetPath.trim() : undefined,
      budgetCapUsd: sanitizeBudgetCap(obj.budgetCapUsd),
    });
  }

  return result;
}
