import * as vscode from 'vscode';
import { sanitizePollingInterval } from './configValidation';
import { MonitorConfig, QuotaDisplayMode, StatusBarProviderKey } from './types';

const VALID_KEYS = new Set<StatusBarProviderKey>(['agy-gemini', 'agy-claude', 'claude', 'codex']);
const DEFAULT_STATUS_BAR_PROVIDERS: StatusBarProviderKey[] = ['agy-gemini', 'claude', 'codex'];

export function readMonitorConfig(): MonitorConfig {
  const cfg = vscode.workspace.getConfiguration('quotadeck');
  const rawMode = cfg.get<unknown>('displayMode', 'remaining');
  const displayMode: QuotaDisplayMode = rawMode === 'used' ? 'used' : 'remaining';

  const rawProviders = cfg.get<unknown>('statusBarProviders', DEFAULT_STATUS_BAR_PROVIDERS);
  const statusBarProviders: StatusBarProviderKey[] = Array.isArray(rawProviders)
    ? rawProviders.filter((k): k is StatusBarProviderKey => typeof k === 'string' && VALID_KEYS.has(k as StatusBarProviderKey))
    : DEFAULT_STATUS_BAR_PROVIDERS;

  return {
    pollingIntervalSeconds: sanitizePollingInterval(cfg.get<unknown>('pollingIntervalSeconds', 300), 300),
    displayMode,
    statusBarProviders,
  };
}
