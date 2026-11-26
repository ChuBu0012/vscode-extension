import * as vscode from 'vscode';
import { formatResetCountdown } from '../timeFormat';
import { MonitorConfig, ProviderSnapshot, QuotaDisplayMode, StatusBarProviderKey } from '../types';

function renderBlockBar(pct: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const DEFAULT_SB_KEYS: StatusBarProviderKey[] = ['agy-gemini', 'claude', 'codex'];

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

    const agy = snapshots.find((s) => s.id === 'agy' && s.status === 'live' && s.pools.length > 0);
    const geminiPool = agy?.pools.find((p) => p.id === 'agy-gemini') ?? agy?.pools[0];
    const agyClaudePool = agy?.pools.find((p) => p.id === 'agy-claude');

    const claude = snapshots.find((s) => s.id === 'claude' && s.status === 'live' && s.pools.length > 0);
    const claudePool = claude?.pools[0];

    const codex = snapshots.find((s) => s.id === 'codex' && s.status === 'live' && s.pools.length > 0);
    const codexPool = codex?.pools[0];

    const fmtVal = (remaining: number): number => (isUsed ? 100 - remaining : remaining);

    const statusParts: string[] = [];
    const pctsForWarning: number[] = [];

    if (geminiPool && enabledKeys.has('agy-gemini')) {
      statusParts.push(`AGY: G ${fmtVal(geminiPool.remainingPct)}%`);
      pctsForWarning.push(geminiPool.remainingPct);
    }
    if (agyClaudePool && enabledKeys.has('agy-claude')) {
      statusParts.push(`AGY-C ${fmtVal(agyClaudePool.remainingPct)}%`);
      pctsForWarning.push(agyClaudePool.remainingPct);
    }
    if (claudePool && enabledKeys.has('claude')) {
      statusParts.push(`CL ${fmtVal(claudePool.remainingPct)}%`);
      pctsForWarning.push(claudePool.remainingPct);
    }
    if (codexPool && enabledKeys.has('codex')) {
      statusParts.push(`CX ${fmtVal(codexPool.remainingPct)}%`);
      pctsForWarning.push(codexPool.remainingPct);
    }

    if (statusParts.length === 0) {
      this.lastSummaryText = 'AI: --';
      this.lastIcon = '$(pulse)';
      this.item.text = `${this.lastIcon} ${this.lastSummaryText}`;
      this.item.backgroundColor = undefined;
    } else {
      this.lastSummaryText = statusParts.join(' | ') + (isUsed ? ' (used)' : '');
      const minPct = Math.min(...pctsForWarning);
      if (minPct <= 20) {
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

    const appendPoolSection = (
      title: string,
      pool: { fiveHourPct?: number; fiveHourReset?: string; weeklyPct?: number; weeklyReset?: string }
    ) => {
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
    };

    if (geminiPool || agyClaudePool || claudePool || codexPool) {
      md.appendMarkdown(`**AI Usage** · Showing *${unit}*\n\n`);
      if (statusParts.length === 0) {
        md.appendMarkdown('*All providers are hidden from the Status Bar. Toggle them in the Dashboard.*\n\n');
      }
      if (geminiPool) {
        appendPoolSection(`Antigravity · ${geminiPool.name}`, geminiPool);
      }
      if (agyClaudePool && enabledKeys.has('agy-claude')) {
        appendPoolSection(`Antigravity · ${agyClaudePool.name}`, agyClaudePool);
      }
      if (claudePool) {
        appendPoolSection(`Claude Code · ${claudePool.name}`, claudePool);
      }
      if (codexPool) {
        appendPoolSection(`Codex · ${codexPool.name}`, codexPool);
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
