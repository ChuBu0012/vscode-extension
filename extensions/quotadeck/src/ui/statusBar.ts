import * as vscode from 'vscode';
import { formatResetCountdown } from '../timeFormat';
import {
  ModelPoolSnapshot,
  MonitorConfig,
  ProviderSnapshot,
  QuotaDisplayMode,
  StatusBarProviderKey,
  formatCurrency,
} from '../types';

function renderBlockBar(pct: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const DEFAULT_SB_KEYS: StatusBarProviderKey[] = ['agy-gemini', 'claude', 'codex'];

export function resolveStatusBarKey(providerId: string, poolId: string): string | null {
  if (providerId === 'agy') {
    if (poolId === 'agy-gemini') return 'agy-gemini';
    if (poolId === 'agy-claude') return 'agy-claude';
    return null;
  }
  if (providerId === 'claude' && poolId === 'claude-main') return 'claude';
  if (providerId === 'codex' && poolId === 'codex-main') return 'codex';
  if (providerId === 'openrouter' && poolId === 'openrouter-main') return 'openrouter';
  if (providerId === 'deepseek' && poolId === 'deepseek-main') return 'deepseek';
  if (providerId === 'cline' && poolId === 'cline-main') return 'cline';
  if (providerId.startsWith('custom:')) return providerId;
  return null;
}

function getStatusBarTag(sbKey: string, shortCode: string): string {
  if (sbKey === 'agy-gemini') return 'AGY: G';
  if (sbKey === 'agy-claude') return 'AGY-C';
  if (sbKey === 'claude') return 'CL';
  if (sbKey === 'codex') return 'CX';
  if (sbKey === 'openrouter') return 'OR';
  if (sbKey === 'deepseek') return 'DS';
  if (sbKey === 'cline') return 'CN';
  return shortCode.toUpperCase();
}

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private lastSummaryText = 'AI: --';
  private lastIcon = '$(pulse)';

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'quotadeck.openDashboard';
    this.item.text = '$(pulse) AI: --';
    this.item.tooltip = 'Click to open QuotaDeck Dashboard';
    this.item.show();
  }

  setLoading(loading: boolean): void {
    this.item.text = loading ? `$(sync~spin) ${this.lastSummaryText}` : `${this.lastIcon} ${this.lastSummaryText}`;
  }

  update(snapshots: ProviderSnapshot[], config?: MonitorConfig): void {
    const mode: QuotaDisplayMode = config?.displayMode ?? 'remaining';
    const isUsed = mode === 'used';
    const unit = isUsed ? 'used' : 'left';
    const enabledKeys = new Set<StatusBarProviderKey>(config?.statusBarProviders ?? DEFAULT_SB_KEYS);
    const lowPct = typeof config?.lowThresholdPct === 'number' ? config.lowThresholdPct : 20;
    const lowBal = typeof config?.lowBalanceUsd === 'number' ? config.lowBalanceUsd : 1;

    const fmtVal = (remaining: number): number => (isUsed ? 100 - remaining : remaining);

    const statusParts: string[] = [];
    let hasWarning = false;
    let hasAnyPctPart = false;
    const liveSnapshots = snapshots.filter((s) => s.status === 'live' && s.pools.length > 0);

    for (const snap of liveSnapshots) {
      for (const pool of snap.pools) {
        const sbKey = resolveStatusBarKey(snap.id, pool.id);
        if (!sbKey || !enabledKeys.has(sbKey)) {
          continue;
        }
        const tag = getStatusBarTag(sbKey, snap.shortCode);
        if (typeof pool.remainingPct === 'number') {
          hasAnyPctPart = true;
          statusParts.push(`${tag} ${fmtVal(pool.remainingPct)}%`);
          if (pool.remainingPct <= lowPct) {
            hasWarning = true;
          }
        } else if (typeof pool.balanceAmount === 'number') {
          statusParts.push(`${tag} ${formatCurrency(pool.balanceAmount, pool.balanceCurrency)}`);
          if (pool.balanceAmount <= lowBal) {
            hasWarning = true;
          }
        }
      }
    }

    if (statusParts.length === 0) {
      this.lastSummaryText = 'AI: --';
      this.lastIcon = '$(pulse)';
      this.item.text = `${this.lastIcon} ${this.lastSummaryText}`;
      this.item.backgroundColor = undefined;
    } else {
      this.lastSummaryText = statusParts.join(' | ') + (isUsed && hasAnyPctPart ? ' (used)' : '');
      if (hasWarning) {
        this.lastIcon = '$(warning)';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        this.lastIcon = '$(pulse)';
        this.item.backgroundColor = undefined;
      }
      this.item.text = `${this.lastIcon} ${this.lastSummaryText}`;
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = {
      enabledCommands: ['quotadeck.openDashboard', 'quotadeck.refresh'],
    };

    const appendPoolSection = (title: string, pool: ModelPoolSnapshot) => {
      const fiveH = typeof pool.fiveHourPct === 'number' ? fmtVal(pool.fiveHourPct) : null;
      const wk = typeof pool.weeklyPct === 'number' ? fmtVal(pool.weeklyPct) : null;
      const reset5h = pool.fiveHourReset ? formatResetCountdown(pool.fiveHourReset) : '';
      const resetWk = pool.weeklyReset ? formatResetCountdown(pool.weeklyReset) : '';

      md.appendMarkdown(`**${title}**\n\n`);
      if (fiveH !== null) {
        md.appendMarkdown(`\`${renderBlockBar(fiveH)}\` **${fiveH}% ${unit}** · 5h${reset5h ? `  ·  ${reset5h}` : ''}\n\n`);
      }
      if (wk !== null) {
        md.appendMarkdown(`\`${renderBlockBar(wk)}\` ${wk}% ${unit} · Weekly${resetWk ? `  ·  ${resetWk}` : ''}\n\n`);
      }
      if (fiveH === null && wk === null && typeof pool.remainingPct === 'number') {
        const val = fmtVal(pool.remainingPct);
        const balNote =
          typeof pool.balanceAmount === 'number' && typeof pool.budgetCapAmount === 'number'
            ? ` (${formatCurrency(pool.balanceAmount, pool.balanceCurrency)} / ${formatCurrency(pool.budgetCapAmount, pool.balanceCurrency)})`
            : '';
        md.appendMarkdown(`\`${renderBlockBar(val)}\` **${val}% ${unit}**${balNote}\n\n`);
      } else if (fiveH === null && wk === null && typeof pool.balanceAmount === 'number') {
        md.appendMarkdown(`**${formatCurrency(pool.balanceAmount, pool.balanceCurrency)}** remaining\n\n`);
      }
    };

    if (liveSnapshots.length > 0) {
      md.appendMarkdown(`**AI Usage** · Showing *${unit}*\n\n`);
      if (statusParts.length === 0) {
        md.appendMarkdown('*All providers are hidden from the Status Bar. Toggle them in the Dashboard.*\n\n');
      }
      for (const snap of liveSnapshots) {
        for (const pool of snap.pools) {
          if (snap.id === 'agy' && pool.id === 'agy-claude' && !enabledKeys.has('agy-claude')) {
            continue;
          }
          if (snap.id === 'claude' && pool.id !== 'claude-main') {
            continue;
          }
          appendPoolSection(`${snap.name} · ${pool.name}`, pool);
        }
      }
    } else {
      md.appendMarkdown('**AI Usage** — *Unavailable*\n\n');
    }

    md.appendMarkdown(
      '---\n[$(refresh) Refresh](command:quotadeck.refresh) &nbsp;&nbsp; [$(graph) Open Dashboard](command:quotadeck.openDashboard)'
    );
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
