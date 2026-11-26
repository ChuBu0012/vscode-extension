import * as vscode from 'vscode';
import { sanitizeBudgets, sanitizeCustomProviders, sanitizePollingInterval } from './configValidation';
import { MonitorConfig, QuotaDisplayMode, StatusBarProviderKey } from './types';

const DEFAULT_STATUS_BAR_PROVIDERS: StatusBarProviderKey[] = ['agy-gemini', 'claude', 'codex'];

export function readMonitorConfig(): MonitorConfig {
  const cfg = vscode.workspace.getConfiguration('quotadeck');
  const rawMode = cfg.get<unknown>('displayMode', 'remaining');
  const displayMode: QuotaDisplayMode = rawMode === 'used' ? 'used' : 'remaining';

  const rawProviders = cfg.get<unknown>('statusBarProviders', DEFAULT_STATUS_BAR_PROVIDERS);
  const statusBarProviders: StatusBarProviderKey[] = Array.isArray(rawProviders)
    ? rawProviders.filter((k): k is StatusBarProviderKey => typeof k === 'string' && k.trim().length > 0)
    : DEFAULT_STATUS_BAR_PROVIDERS;

  return {
    pollingIntervalSeconds: sanitizePollingInterval(cfg.get<unknown>('pollingIntervalSeconds', 300), 300),
    displayMode,
    statusBarProviders,
    budgets: sanitizeBudgets(cfg.get<unknown>('budgets', {})),
    customProviders: sanitizeCustomProviders(cfg.get<unknown>('customProviders', [])),
  };
}
