import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { formatResetCountdown, parseAgyResetTimestamp } from '../timeFormat';
import { HistoryPoint, MonitorConfig, ProviderSnapshot, averageRemainingPct } from '../types';

export interface DashboardCallbacks {
  onRefresh: () => Promise<void>;
  onClearHistory: () => Promise<void>;
  onUpdateConfig?: (key: 'displayMode' | 'statusBarProviders', value: unknown) => Promise<void>;
}

export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private latestSnapshots: ProviderSnapshot[] = [];
  private latestHistory: HistoryPoint[] = [];
  private latestConfig: MonitorConfig | undefined;

  constructor(
    private readonly callbacks: DashboardCallbacks,
    private readonly extensionUri?: vscode.Uri
  ) {}

  show(snapshots: ProviderSnapshot[], history: HistoryPoint[], config: MonitorConfig): void {
    this.latestSnapshots = snapshots;
    this.latestHistory = history;
    this.latestConfig = config;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'quotadeck.dashboard',
      'QuotaDeck',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [],
      }
    );

    if (this.extensionUri) {
      this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.png');
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    this.panel.webview.html = this.buildHtml(this.panel.webview, nonce);

    this.panelDisposables.push(
      this.panel.webview.onDidReceiveMessage(async (msg) => {
        if (!msg || typeof msg !== 'object') {
          return;
        }
        const message = msg as Record<string, unknown>;
        if (message.command === 'refresh') {
          await this.callbacks.onRefresh();
        } else if (message.command === 'clearHistory') {
          await this.callbacks.onClearHistory();
        } else if (message.command === 'updateConfig') {
          const key = message.key;
          if ((key === 'displayMode' || key === 'statusBarProviders') && this.callbacks.onUpdateConfig) {
            await this.callbacks.onUpdateConfig(key, message.value);
          }
        } else if (message.command === 'ready') {
          this.postState();
        }
      })
    );

    this.panelDisposables.push(
      this.panel.onDidDispose(() => {
        this.disposePanelResources();
      })
    );

    this.postState();
  }

  update(snapshots: ProviderSnapshot[], history: HistoryPoint[], config: MonitorConfig): void {
    this.latestSnapshots = snapshots;
    this.latestHistory = history;
    this.latestConfig = config;
    if (this.panel) {
      this.postState();
    }
  }

  private postState(): void {
    if (!this.panel || !this.latestConfig) {
      return;
    }

    const liveProviders = this.latestSnapshots.filter((s) => s.status === 'live');
    const enrichedSnapshots = this.latestSnapshots.map((s) => ({
      ...s,
      pools: s.pools.map((p) => {
        const fiveHourResetMs = parseAgyResetTimestamp(p.fiveHourReset);
        const weeklyResetMs = parseAgyResetTimestamp(p.weeklyReset);
        const resetCandidates = [
          fiveHourResetMs !== null ? { ms: fiveHourResetMs, raw: p.fiveHourReset } : null,
          weeklyResetMs !== null ? { ms: weeklyResetMs, raw: p.weeklyReset } : null,
        ].filter((c): c is { ms: number; raw: string | undefined } => c !== null);
        resetCandidates.sort((a, b) => a.ms - b.ms);
        const earliest = resetCandidates[0] ?? null;
        return {
          ...p,
          weeklyResetLabel: formatResetCountdown(p.weeklyReset),
          fiveHourResetLabel: formatResetCountdown(p.fiveHourReset),
          weeklyResetMs,
          fiveHourResetMs,
          nextResetMs: earliest ? earliest.ms : null,
          nextResetLabel: earliest ? formatResetCountdown(earliest.raw) : '--',
        };
      }),
    }));

    const allPools = enrichedSnapshots
      .filter((s) => s.status === 'live')
      .flatMap((s) => s.pools.map((p) => ({ ...p, providerId: s.id, providerName: s.name })));

    const lowest = [...allPools].sort((a, b) => a.remainingPct - b.remainingPct)[0];
    const soonestReset = [...allPools]
      .filter((p) => typeof p.nextResetMs === 'number')
      .sort((a, b) => (a.nextResetMs ?? Infinity) - (b.nextResetMs ?? Infinity))[0];

    const fiveHourSummary =
      allPools.length > 0
        ? allPools
            .map((p) => (typeof p.fiveHourPct === 'number' ? `${p.fiveHourPct}%` : '--'))
            .join(' / ')
        : '--';

    void this.panel.webview.postMessage({
      command: 'state',
      payload: {
        snapshots: enrichedSnapshots,
        history: this.latestHistory,
        config: this.latestConfig,
        summary: {
          liveCount: liveProviders.length,
          totalCount: this.latestSnapshots.length,
          lowestPct: lowest ? lowest.remainingPct : null,
          lowestLabel: lowest ? lowest.name : 'Unavailable',
          lowestProviderId: lowest ? lowest.providerId : null,
          lowestProviderName: lowest ? lowest.providerName : null,
          lowestResetLabel: lowest ? lowest.nextResetLabel : '--',
          nextResetMs: soonestReset ? soonestReset.nextResetMs : null,
          nextResetLabel: soonestReset ? soonestReset.nextResetLabel : '--',
          nextResetPoolName: soonestReset ? soonestReset.name : null,
          nextResetProviderName: soonestReset ? soonestReset.providerName : null,
          fiveHourSummary,
          avgRemaining:
            liveProviders.length > 0 ? averageRemainingPct(liveProviders[0].pools) : null,
        },
        updatedAt: new Date().toTimeString().slice(0, 8),
      },
    });
  }

  private disposePanelResources(): void {
    this.panel = undefined;
    for (const d of this.panelDisposables.splice(0)) {
      d.dispose();
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposePanelResources();
  }

  private buildHtml(webview: vscode.Webview, nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>QuotaDeck</title>
  <style>
    :root {
      --bg-canvas: var(--vscode-editor-background, #ffffff);
      --bg-subtle: var(--vscode-sideBar-background, #f8fafc);
      --bg-muted: var(--vscode-input-background, #f1f5f9);
      --border: var(--vscode-panel-border, #e5e7eb);
      --text-primary: var(--vscode-editor-foreground, #0f172a);
      --text-secondary: var(--vscode-descriptionForeground, #64748b);
      --accent: var(--vscode-button-background, #1d6ff2);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --warning: var(--vscode-editorWarning-foreground, #d97706);
      --positive: #10b981;
      --font-sans: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --font-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-family: var(--font-sans);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    .topbar {
      height: 48px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.5rem;
    }
    .brand { display: flex; align-items: center; gap: 0.65rem; font-weight: 600; font-size: 0.88rem; }
    .brand-mark {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      overflow: hidden;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .actions { display: flex; gap: 0.5rem; align-items: center; }

    .btn {
      padding: 0.32rem 0.72rem;
      border-radius: 6px;
      font-size: 0.76rem;
      font-weight: 500;
      font-family: var(--font-sans);
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-primary);
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .btn:hover { border-color: var(--accent); }
    .btn-primary {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
      font-weight: 600;
    }
    .btn-icon { width: 13px; height: 13px; flex-shrink: 0; }
    .btn-icon.spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .mode-switch {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg-subtle);
    }
    .mode-btn {
      padding: 0.28rem 0.58rem;
      font-size: 0.73rem;
      font-family: var(--font-mono);
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .mode-btn.active {
      background: var(--accent);
      color: var(--accent-fg);
      font-weight: 600;
    }

    .main-shell {
      max-width: 780px;
      margin: 0 auto;
      padding: 1.4rem 1.5rem 2.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }
    .main-shell.grid-mode { max-width: 1100px; }

    .board-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .board-title-group { display: flex; align-items: baseline; gap: 0.7rem; flex-wrap: wrap; }
    .page-title { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
    .meta-time { font-size: 0.72rem; color: var(--text-secondary); font-family: var(--font-mono); }
    .board-controls { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }

    .select-control {
      padding: 0.27rem 0.5rem;
      border-radius: 6px;
      font-size: 0.74rem;
      font-family: var(--font-sans);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-primary);
      cursor: pointer;
    }
    .select-control:focus { outline: none; border-color: var(--accent); }

    .filter-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .provider-filter-tabs, .status-chips { display: flex; gap: 0.35rem; flex-wrap: wrap; align-items: center; }
    .filter-tab {
      padding: 0.22rem 0.58rem;
      border-radius: 6px;
      font-size: 0.73rem;
      font-family: var(--font-sans);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-secondary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .filter-tab:hover { border-color: var(--accent); color: var(--text-primary); }
    .filter-tab.active { border-color: var(--accent); color: var(--accent); font-weight: 600; }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-secondary);
      opacity: 0.5;
      flex-shrink: 0;
    }
    .status-dot.live { background: var(--positive); opacity: 1; }
    .status-dot.warn { background: var(--warning); opacity: 1; }
    .status-chip {
      padding: 0.2rem 0.52rem;
      border-radius: 999px;
      font-size: 0.7rem;
      font-family: var(--font-sans);
      border: 1px solid var(--border);
      background: var(--bg-canvas);
      color: var(--text-secondary);
      cursor: pointer;
    }
    .status-chip:hover { border-color: var(--accent); color: var(--text-primary); }
    .status-chip.active { border-color: var(--accent); color: var(--accent); background: var(--bg-subtle); font-weight: 600; }

    /* Provider-first clean list (default) */
    .provider-stack { border-top: 1px solid var(--border); }
    .provider-block { padding: 1rem 0.25rem; border-bottom: 1px solid var(--border); }
    .provider-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .pr-left { display: flex; align-items: center; gap: 0.7rem; min-width: 0; }
    .pr-icon {
      width: 32px;
      height: 32px;
      border-radius: 7px;
      background: var(--bg-muted);
      border: 1px solid var(--border);
      display: grid;
      place-items: center;
      font-family: var(--font-mono);
      font-size: 0.74rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .pr-name { font-size: 0.88rem; font-weight: 600; }
    .pr-sub { font-size: 0.72rem; color: var(--text-secondary); }
    .pr-pct { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 0.84rem; font-weight: 600; }
    .pr-pct.warn { color: var(--warning); }
    .badge-soon {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      padding: 0.14rem 0.48rem;
      border-radius: 4px;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      background: var(--bg-subtle);
      flex-shrink: 0;
    }

    .pool-list {
      margin-top: 0.75rem;
      padding-left: 2.7rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .pool-item { display: flex; flex-direction: column; }
    .pool-item.flat-pool {
      padding: 0.85rem 0.25rem;
      border-bottom: 1px solid var(--border);
    }
    .pool-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      font-size: 0.79rem;
      margin-bottom: 0.32rem;
    }
    .pool-name-group { display: flex; align-items: center; gap: 0.42rem; min-width: 0; }
    .pool-name { color: var(--text-primary); font-weight: 500; }
    .provider-code-pill {
      font-family: var(--font-mono);
      font-size: 0.66rem;
      font-weight: 700;
      padding: 0.08rem 0.34rem;
      border-radius: 4px;
      background: var(--bg-muted);
      border: 1px solid var(--border);
      color: var(--text-secondary);
    }
    .pool-head-right {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      flex-shrink: 0;
    }
    .pool-val {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .pool-val.warn { color: var(--warning); }
    .q-track { height: 5px; width: 100%; background: var(--bg-muted); border-radius: 999px; overflow: hidden; }
    .q-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.2s ease; }
    .q-fill.warn { background: var(--warning); }
    .pool-meta {
      margin-top: 0.28rem;
      font-size: 0.71rem;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }

    /* Grid layout */
    .provider-stack.grid-layout {
      border-top: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 0.85rem;
      align-items: stretch;
    }
    .provider-stack.grid-layout .provider-block,
    .provider-stack.grid-layout .pool-item.flat-pool {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.1rem;
      background: var(--bg-subtle);
      height: 100%;
    }
    .provider-stack.grid-layout .pool-list {
      padding-left: 0;
      margin-top: 0.85rem;
    }
    .provider-stack.grid-layout .empty-state { grid-column: 1 / -1; }

    /* Inline Status Bar toggle switch */
    .sb-switch-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.32rem;
      padding: 0.12rem 0.36rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg-canvas);
      color: var(--text-secondary);
      font-family: var(--font-sans);
      font-size: 0.66rem;
      cursor: pointer;
      transition: border-color 0.15s ease, color 0.15s ease;
    }
    .sb-switch-btn:hover { border-color: var(--accent); color: var(--text-primary); }
    .sb-switch-btn.active { border-color: var(--accent); color: var(--text-primary); }
    .sb-switch-track {
      position: relative;
      width: 22px;
      height: 12px;
      border-radius: 999px;
      background: var(--bg-muted);
      border: 1px solid var(--border);
      display: inline-block;
      transition: background 0.15s ease, border-color 0.15s ease;
      flex-shrink: 0;
    }
    .sb-switch-btn.active .sb-switch-track {
      background: var(--accent);
      border-color: var(--accent);
    }
    .sb-switch-thumb {
      position: absolute;
      top: 1px;
      left: 1px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-secondary);
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .sb-switch-btn.active .sb-switch-thumb {
      transform: translateX(10px);
      background: var(--accent-fg);
    }

    .empty-state {
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 1.5rem 1rem;
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.8rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      margin-top: 0.5rem;
    }

    /* Collapsible History */
    .collapsible-block {
      margin-top: 0.4rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-subtle);
      overflow: hidden;
    }
    .collapsible-header {
      width: 100%;
      padding: 0.65rem 0.95rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      cursor: pointer;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-family: var(--font-sans);
      text-align: left;
    }
    .collapsible-header:hover { background: var(--bg-muted); }
    .collapsible-title-group { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
    .section-title { font-size: 0.84rem; font-weight: 600; }
    .section-actions { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
    .collapsible-meta { font-family: var(--font-mono); font-size: 0.71rem; color: var(--text-secondary); }
    .collapsible-body { padding: 0 1rem 1rem; border-top: 1px solid var(--border); background: var(--bg-canvas); }
    .collapsible-body.collapsed { display: none; }
    .btn-ghost {
      padding: 0.2rem 0.52rem;
      border-radius: 5px;
      font-size: 0.71rem;
      font-family: var(--font-sans);
      border: 1px solid var(--border);
      background: var(--bg-canvas);
      color: var(--text-secondary);
      cursor: pointer;
    }
    .btn-ghost:hover { border-color: var(--accent); color: var(--text-primary); }
    .btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.65rem;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .range-tabs { display: flex; gap: 0.3rem; }
    .range-tab {
      padding: 0.2rem 0.52rem;
      border-radius: 5px;
      font-size: 0.71rem;
      font-family: var(--font-mono);
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-secondary);
      cursor: pointer;
    }
    .range-tab.active { border-color: var(--accent); color: var(--accent); font-weight: 600; }
    .chart-area { position: relative; margin-top: 0.75rem; }
    .bars-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(26px, 1fr));
      gap: 0.65rem;
      align-items: end;
      height: 136px;
      padding-bottom: 1.6rem;
      border-bottom: 1px solid var(--border);
    }
    .bar-col {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
      position: relative;
      cursor: pointer;
    }
    .bar-cap {
      width: 100%;
      background: var(--bg-muted);
      border-radius: 7px;
      display: flex;
      align-items: flex-end;
      overflow: hidden;
      height: 100%;
    }
    .bar-fill { width: 100%; background: var(--accent); border-radius: 7px; opacity: 0.82; }
    .bar-col:hover .bar-fill { opacity: 1; }
    .bar-label {
      position: absolute;
      bottom: -1.4rem;
      font-size: 0.68rem;
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }
    .chart-popover {
      display: none;
      position: absolute;
      top: 8px;
      right: 8px;
      background: var(--bg-canvas);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.45rem 0.7rem;
      font-size: 0.74rem;
      z-index: 10;
      pointer-events: none;
    }
    .chart-popover.visible { display: block; }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 256 256" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="256" height="256" rx="52" fill="#0e1726"/>
          <path d="M 148.94 86.78 L 166.15 47.06 A 86.00 86.00 0 0 1 193.02 65.50 L 162.80 96.65 A 46.00 46.00 0 0 0 148.94 86.78 Z" fill="#1f2e42" stroke="#1f2e42" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 169.39 104.58 L 205.33 81.27 A 86.00 86.00 0 0 1 213.89 112.71 L 173.94 119.82 A 46.00 46.00 0 0 0 169.39 104.58 Z" fill="#1f2e42" stroke="#1f2e42" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 173.94 136.18 L 213.89 143.29 A 86.00 86.00 0 0 1 205.33 174.73 L 169.39 151.42 A 46.00 46.00 0 0 0 173.94 136.18 Z" fill="#1f2e42" stroke="#1f2e42" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 162.80 159.35 L 193.02 190.50 A 86.00 86.00 0 0 1 166.15 208.94 L 148.94 169.22 A 46.00 46.00 0 0 0 162.80 159.35 Z" fill="#1d6ff2" stroke="#1d6ff2" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 136.32 173.24 L 143.55 212.60 A 86.00 86.00 0 0 1 112.45 212.60 L 119.68 173.24 A 46.00 46.00 0 0 0 136.32 173.24 Z" fill="#1d6ff2" stroke="#1d6ff2" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 107.06 169.22 L 89.85 208.94 A 86.00 86.00 0 0 1 62.98 190.50 L 93.20 159.35 A 46.00 46.00 0 0 0 107.06 169.22 Z" fill="#1d6ff2" stroke="#1d6ff2" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 86.61 151.42 L 50.67 174.73 A 86.00 86.00 0 0 1 42.11 143.29 L 82.06 136.18 A 46.00 46.00 0 0 0 86.61 151.42 Z" fill="#10b981" stroke="#10b981" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 82.06 119.82 L 42.11 112.71 A 86.00 86.00 0 0 1 50.67 81.27 L 86.61 104.58 A 46.00 46.00 0 0 0 82.06 119.82 Z" fill="#10b981" stroke="#10b981" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 93.20 96.65 L 62.98 65.50 A 86.00 86.00 0 0 1 89.85 47.06 L 107.06 86.78 A 46.00 46.00 0 0 0 93.20 96.65 Z" fill="#10b981" stroke="#10b981" stroke-width="10" stroke-linejoin="round"/>
          <path d="M 119.68 82.76 L 112.45 43.40 A 86.00 86.00 0 0 1 143.55 43.40 L 136.32 82.76 A 46.00 46.00 0 0 0 119.68 82.76 Z" fill="#f59e0b" stroke="#f59e0b" stroke-width="10" stroke-linejoin="round"/>
        </svg>
      </div>
      <span>QuotaDeck</span>
    </div>
    <div class="actions">
      <div class="mode-switch" role="group" aria-label="Percentage display mode" title="Switch between remaining and used percentages">
        <button type="button" class="mode-btn active" id="modeLeftBtn" data-mode="remaining">Left</button>
        <button type="button" class="mode-btn" id="modeUsedBtn" data-mode="used">Used</button>
      </div>
      <button type="button" class="btn btn-primary" id="refreshBtn" title="Refresh all provider quotas">
        <svg class="btn-icon" id="refreshBtnIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67"/>
          <path d="M13.5 2.5v2.75h-2.75"/>
        </svg>
        <span id="refreshBtnLabel">Refresh</span>
      </button>
    </div>
  </header>

  <main class="main-shell" id="mainShell">
    <div class="board-header">
      <div class="board-title-group">
        <h1 class="page-title">Providers</h1>
        <span class="meta-time" id="updatedAt">Loading...</span>
      </div>
      <div class="board-controls">
        <select class="select-control" id="limitSortSelect" aria-label="Sort quota pools" title="Sort quota pools">
          <option value="default">Sort: Grouped</option>
          <option value="lowest">Sort: Tightest First</option>
          <option value="highest">Sort: Most Available</option>
          <option value="reset">Sort: Soonest Reset</option>
          <option value="name">Sort: Name (A–Z)</option>
        </select>
        <div class="mode-switch" role="group" aria-label="Dashboard layout">
          <button type="button" class="mode-btn active" id="layoutListBtn" data-layout="list" title="List view">
            <svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <line x1="2.5" y1="4" x2="13.5" y2="4"/>
              <line x1="2.5" y1="8" x2="13.5" y2="8"/>
              <line x1="2.5" y1="12" x2="13.5" y2="12"/>
            </svg>
            <span>List</span>
          </button>
          <button type="button" class="mode-btn" id="layoutGridBtn" data-layout="grid" title="Grid view">
            <svg class="btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/>
              <rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/>
              <rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/>
              <rect x="9" y="9" width="4.5" height="4.5" rx="1"/>
            </svg>
            <span>Grid</span>
          </button>
        </div>
      </div>
    </div>

    <div class="filter-strip">
      <div class="provider-filter-tabs" id="providerFilterTabs"></div>
      <div class="status-chips" id="statusFilterChips" role="group" aria-label="Filter by quota status"></div>
    </div>

    <div class="provider-stack" id="quotaBreakdown"></div>

    <div class="collapsible-block">
      <div class="collapsible-header" id="historyHeaderBar">
        <div class="collapsible-title-group">
          <span class="section-title">Usage History</span>
          <span class="collapsible-meta" id="historyMeta">0 snapshots</span>
        </div>
        <div class="section-actions">
          <button type="button" class="btn-ghost" id="clearHistoryBtn">Clear</button>
          <button type="button" class="btn-ghost" id="historyToggleBtn">Open Graph</button>
        </div>
      </div>
      <div class="collapsible-body collapsed" id="historyBody">
        <div class="chart-area">
          <div class="section-header">
            <select class="select-control" id="historyProviderSelect" aria-label="Filter history by provider">
              <option value="all">All Providers</option>
            </select>
            <div class="range-tabs">
              <button type="button" class="range-tab active" data-range="24H">24H</button>
              <button type="button" class="range-tab" data-range="7D">7D</button>
              <button type="button" class="range-tab" data-range="30D">30D</button>
            </div>
          </div>
          <div class="chart-popover" id="chartPopover">
            <div style="font-weight:700;" id="popPct">--%</div>
            <div style="color:var(--text-secondary);" id="popDesc">--</div>
            <div style="color:var(--text-secondary);font-family:var(--font-mono);font-size:0.68rem;margin-top:0.15rem;" id="popDetail"></div>
          </div>
          <div class="bars-row" id="barsRow"></div>
        </div>
      </div>
    </div>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let lastPayload = null;
    let currentRange = '24H';
    let activeProviderFilter = 'all';
    let activeStatusFilter = 'all';
    let limitSort = 'default';
    let limitsLayout = 'list';
    let historyProviderFilter = 'all';

    function esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function saveViewState(patch) {
      vscode.setState({ ...(vscode.getState() || {}), ...patch });
    }

    const savedState = vscode.getState() || {};
    if (savedState.providerFilter) activeProviderFilter = savedState.providerFilter;
    if (savedState.statusFilter) activeStatusFilter = savedState.statusFilter;
    if (savedState.limitSort) limitSort = savedState.limitSort;
    if (savedState.limitsLayout === 'grid' || savedState.limitsLayout === 'list') {
      limitsLayout = savedState.limitsLayout;
    }
    if (savedState.historyProvider) historyProviderFilter = savedState.historyProvider;

    const applyLimitsLayout = (layout) => {
      limitsLayout = layout === 'grid' ? 'grid' : 'list';
      const breakdownEl = document.getElementById('quotaBreakdown');
      const mainShell = document.getElementById('mainShell');
      const listBtn = document.getElementById('layoutListBtn');
      const gridBtn = document.getElementById('layoutGridBtn');
      if (breakdownEl) breakdownEl.classList.toggle('grid-layout', limitsLayout === 'grid');
      if (mainShell) mainShell.classList.toggle('grid-mode', limitsLayout === 'grid');
      if (listBtn) listBtn.classList.toggle('active', limitsLayout === 'list');
      if (gridBtn) gridBtn.classList.toggle('active', limitsLayout === 'grid');
    };
    applyLimitsLayout(limitsLayout);

    const layoutListBtn = document.getElementById('layoutListBtn');
    const layoutGridBtn = document.getElementById('layoutGridBtn');
    if (layoutListBtn) {
      layoutListBtn.addEventListener('click', () => {
        applyLimitsLayout('list');
        saveViewState({ limitsLayout: 'list' });
      });
    }
    if (layoutGridBtn) {
      layoutGridBtn.addEventListener('click', () => {
        applyLimitsLayout('grid');
        saveViewState({ limitsLayout: 'grid' });
      });
    }

    const limitSortSelect = document.getElementById('limitSortSelect');
    if (limitSortSelect) {
      limitSortSelect.value = limitSort;
      limitSortSelect.addEventListener('change', () => {
        limitSort = limitSortSelect.value || 'default';
        saveViewState({ limitSort });
        if (lastPayload) renderAll();
      });
    }

    const historyProviderSelect = document.getElementById('historyProviderSelect');
    if (historyProviderSelect) {
      historyProviderSelect.addEventListener('change', () => {
        historyProviderFilter = historyProviderSelect.value || 'all';
        saveViewState({ historyProvider: historyProviderFilter });
        if (lastPayload) renderBars(lastPayload.history);
      });
    }

    const historyOpenInitial = Boolean(savedState.historyOpen);
    if (historyOpenInitial) {
      document.getElementById('historyBody').classList.remove('collapsed');
      document.getElementById('historyToggleBtn').textContent = 'Hide Graph';
    }

    const toggleHistorySection = () => {
      const body = document.getElementById('historyBody');
      const collapsed = body.classList.toggle('collapsed');
      document.getElementById('historyToggleBtn').textContent = collapsed ? 'Open Graph' : 'Hide Graph';
      saveViewState({ historyOpen: !collapsed });
    };

    document.getElementById('historyToggleBtn').addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      toggleHistorySection();
    });
    const historyHeaderBar = document.getElementById('historyHeaderBar');
    if (historyHeaderBar) {
      historyHeaderBar.addEventListener('click', toggleHistorySection);
    }

    const setRefreshVisual = (loading) => {
      const lbl = document.getElementById('refreshBtnLabel');
      const btn = document.getElementById('refreshBtn');
      const icon = document.getElementById('refreshBtnIcon');
      if (lbl) lbl.textContent = loading ? 'Refreshing...' : 'Refresh';
      else if (btn) btn.textContent = loading ? 'Refreshing...' : 'Refresh';
      if (icon) icon.classList.toggle('spin', loading);
    };

    document.getElementById('refreshBtn').addEventListener('click', () => {
      setRefreshVisual(true);
      vscode.postMessage({ command: 'refresh' });
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', (ev) => {
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      vscode.postMessage({ command: 'clearHistory' });
    });

    const modeLeftBtn = document.getElementById('modeLeftBtn');
    const modeUsedBtn = document.getElementById('modeUsedBtn');
    const setMode = (mode) => {
      vscode.postMessage({ command: 'updateConfig', key: 'displayMode', value: mode });
    };
    if (modeLeftBtn) modeLeftBtn.addEventListener('click', () => setMode('remaining'));
    if (modeUsedBtn) modeUsedBtn.addEventListener('click', () => setMode('used'));

    document.querySelectorAll('.range-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentRange = btn.getAttribute('data-range') || '24H';
        document.querySelectorAll('.range-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (lastPayload) renderBars(lastPayload.history);
      });
    });

    const chartArea = document.querySelector('.chart-area');
    if (chartArea) {
      chartArea.addEventListener('mouseleave', () => {
        document.getElementById('chartPopover').classList.remove('visible');
      });
    }

    const defaultSbKeys = ['agy-gemini', 'claude', 'codex'];
    const getActiveSbSet = (cfg) => new Set((cfg && Array.isArray(cfg.statusBarProviders)) ? cfg.statusBarProviders : defaultSbKeys);
    const getStatusBarKey = (providerId, poolId) => {
      if (providerId === 'agy') {
        if (poolId === 'agy-gemini') return 'agy-gemini';
        if (poolId === 'agy-claude') return 'agy-claude';
        return null;
      }
      if (providerId === 'claude' && poolId === 'claude-main') return 'claude';
      if (providerId === 'codex' && poolId === 'codex-main') return 'codex';
      return null;
    };
    const getStatusBarTag = (sbKey) => {
      if (sbKey === 'agy-gemini') return 'AGY: G';
      if (sbKey === 'agy-claude') return 'AGY-C';
      if (sbKey === 'claude') return 'CL';
      if (sbKey === 'codex') return 'CX';
      return '';
    };

    function renderBars(history) {
      const barsEl = document.getElementById('barsRow');
      const isUsedGlobal = Boolean(lastPayload && lastPayload.config && lastPayload.config.displayMode === 'used');
      const unitWord = isUsedGlobal ? 'used' : 'left';
      const hours = currentRange === '24H' ? 24 : currentRange === '7D' ? 168 : 720;
      const cutoff = Date.now() - hours * 3600 * 1000;
      const filtered = history.filter((pt) => {
        const ms = Date.parse(pt.timestamp);
        if (Number.isFinite(ms) && ms < cutoff) return false;
        if (historyProviderFilter !== 'all') {
          return Array.isArray(pt.providers) && pt.providers.some((p) => p.id === historyProviderFilter);
        }
        return true;
      });

      const maxBars = currentRange === '24H' ? 12 : 14;
      let pts = filtered;
      if (filtered.length > maxBars) {
        const sampled = [];
        const step = (filtered.length - 1) / (maxBars - 1);
        for (let i = 0; i < maxBars; i++) {
          sampled.push(filtered[Math.round(i * step)]);
        }
        pts = sampled;
      }

      if (pts.length === 0) {
        barsEl.innerHTML = '<div class="pr-sub">No history recorded in this range.</div>';
        return;
      }

      const nameMap = new Map();
      if (lastPayload && Array.isArray(lastPayload.snapshots)) {
        lastPayload.snapshots.forEach((s) => nameMap.set(s.id, s.shortCode || s.name));
      }

      barsEl.innerHTML = pts.map((pt, idx) => {
        const entries = Array.isArray(pt.providers)
          ? (historyProviderFilter === 'all' ? pt.providers : pt.providers.filter((p) => p.id === historyProviderFilter))
          : [];
        const avgRemaining = Math.round(
          entries.reduce((s, p) => s + p.remainingPct, 0) / Math.max(1, entries.length)
        );
        const val = isUsedGlobal ? 100 - avgRemaining : avgRemaining;
        const d = new Date(pt.timestamp);
        const validDate = Number.isFinite(d.getTime());
        const hhmm = validDate
          ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
          : pt.timestamp.slice(11, 16);
        const dateLbl = validDate
          ? String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0')
          : pt.timestamp.slice(5, 10);
        const axisLbl = currentRange === '24H' ? hhmm : dateLbl;
        const fullTime = validDate ? (dateLbl + ' ' + hhmm) : hhmm;
        const detail = entries.map((p) => {
          const pv = isUsedGlobal ? 100 - p.remainingPct : p.remainingPct;
          return (nameMap.get(p.id) || p.id.toUpperCase()) + ': ' + pv + '%';
        }).join(' · ');
        const showAxisLbl = pts.length <= 8 || idx % 2 === 0 || idx === pts.length - 1;

        return '<div class="bar-col" data-idx="' + idx + '" data-pct="' + val + '" data-unit="' + unitWord + '" data-time="' + esc(fullTime) + '" data-detail="' + esc(detail) + '">' +
          '<div class="bar-cap"><div class="bar-fill" style="height:' + Math.max(3, val) + '%"></div></div>' +
          '<span class="bar-label">' + (showAxisLbl ? esc(axisLbl) : '') + '</span>' +
        '</div>';
      }).join('');

      barsEl.querySelectorAll('.bar-col').forEach((col) => {
        col.addEventListener('mouseenter', () => {
          document.getElementById('popPct').textContent = col.getAttribute('data-pct') + '% ' + (col.getAttribute('data-unit') || 'left');
          document.getElementById('popDesc').textContent = 'Snapshot at ' + col.getAttribute('data-time');
          const popDetail = document.getElementById('popDetail');
          if (popDetail) popDetail.textContent = col.getAttribute('data-detail') || '';
          document.getElementById('chartPopover').classList.add('visible');
        });
      });
    }

    function renderAll() {
      if (!lastPayload) return;
      const { snapshots, history, config, updatedAt } = lastPayload;
      const isUsedGlobal = Boolean(config && config.displayMode === 'used');
      const unitWord = isUsedGlobal ? 'used' : 'left';
      const fmtVal = (remaining) => (isUsedGlobal ? 100 - remaining : remaining);
      const activeSb = getActiveSbSet(config);

      if (activeProviderFilter !== 'all' && !snapshots.some((s) => s.id === activeProviderFilter)) {
        activeProviderFilter = 'all';
      }
      if (historyProviderFilter !== 'all' && !snapshots.some((s) => s.id === historyProviderFilter)) {
        historyProviderFilter = 'all';
      }

      const mLeft = document.getElementById('modeLeftBtn');
      const mUsed = document.getElementById('modeUsedBtn');
      if (mLeft && mUsed) {
        mLeft.classList.toggle('active', !isUsedGlobal);
        mUsed.classList.toggle('active', isUsedGlobal);
      }

      setRefreshVisual(false);
      const pollSec = config && typeof config.pollingIntervalSeconds === 'number' ? config.pollingIntervalSeconds : null;
      const pollStr = pollSec ? (' · Auto ' + (pollSec >= 60 ? Math.round(pollSec / 60) + 'm' : pollSec + 's')) : '';
      document.getElementById('updatedAt').textContent = 'Updated ' + updatedAt + pollStr;
      document.getElementById('historyMeta').textContent = history.length + ' snapshots';

      const clearBtn = document.getElementById('clearHistoryBtn');
      if (clearBtn) clearBtn.disabled = history.length === 0;

      if (historyProviderSelect) {
        historyProviderSelect.innerHTML = ['<option value="all">All Providers</option>'].concat(
          snapshots.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
        ).join('');
        historyProviderSelect.value = historyProviderFilter;
      }

      const liveProviders = snapshots.filter((s) => s.status === 'live' && s.pools.length > 0);
      const allLivePools = liveProviders.flatMap((s) =>
        s.pools.map((pl) => ({ ...pl, providerId: s.id, providerName: s.name, shortCode: s.shortCode }))
      );

      // Provider Filter Tabs
      const tabsEl = document.getElementById('providerFilterTabs');
      const filterItems = [{ id: 'all', label: 'All (' + snapshots.length + ')', status: 'all' }].concat(
        snapshots.map((s) => ({ id: s.id, label: s.name, status: s.status }))
      );
      tabsEl.innerHTML = filterItems.map((item) => {
        const dot = item.id === 'all'
          ? ''
          : '<span class="status-dot' + (item.status === 'live' ? ' live' : (item.status === 'unavailable' ? ' warn' : '')) + '"></span>';
        return '<button type="button" class="filter-tab' + (activeProviderFilter === item.id ? ' active' : '') + '" data-provider="' + esc(item.id) + '">' + dot + '<span>' + esc(item.label) + '</span></button>';
      }).join('');
      tabsEl.querySelectorAll('.filter-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeProviderFilter = btn.getAttribute('data-provider') || 'all';
          saveViewState({ providerFilter: activeProviderFilter });
          renderAll();
        });
      });

      // Status Filter Chips (concise: All, Low, Status Bar)
      const lowCount = allLivePools.filter((p) =>
        p.remainingPct <= 20 ||
        (typeof p.fiveHourPct === 'number' && p.fiveHourPct <= 20) ||
        (typeof p.weeklyPct === 'number' && p.weeklyPct <= 20)
      ).length;
      const pinnedCount = allLivePools.filter((p) => activeSb.has(getStatusBarKey(p.providerId, p.id))).length;
      const chipsEl = document.getElementById('statusFilterChips');
      if (chipsEl) {
        const chipItems = [
          { id: 'all', label: 'All' },
          { id: 'low', label: 'Low' + (lowCount > 0 ? ' (' + lowCount + ')' : '') },
          { id: 'pinned', label: 'Status Bar (' + pinnedCount + ')' },
        ];
        chipsEl.innerHTML = chipItems.map((c) =>
          '<button type="button" class="status-chip' + (activeStatusFilter === c.id ? ' active' : '') + '" data-status-filter="' + c.id + '">' + esc(c.label) + '</button>'
        ).join('');
        chipsEl.querySelectorAll('[data-status-filter]').forEach((btn) => {
          btn.addEventListener('click', () => {
            activeStatusFilter = btn.getAttribute('data-status-filter') || 'all';
            saveViewState({ statusFilter: activeStatusFilter });
            renderAll();
          });
        });
      }

      const renderSbSwitch = (sbKey, poolName, remainingPct) => {
        if (!sbKey) return '';
        const isOn = activeSb.has(sbKey);
        const tag = getStatusBarTag(sbKey);
        const valStr = fmtVal(remainingPct) + '%';
        const tip = isOn
          ? 'Shown in Status Bar as "' + tag + ' ' + valStr + '" (click to hide)'
          : 'Hidden from Status Bar (click to show as "' + tag + '")';
        return '<button type="button" class="sb-switch-btn' + (isOn ? ' active' : '') + '" role="switch" aria-checked="' + (isOn ? 'true' : 'false') + '" aria-label="Show ' + esc(poolName) + ' in Status Bar" title="' + esc(tip) + '" data-sb-toggle="' + esc(sbKey) + '">' +
          '<span class="sb-switch-label">Bar</span>' +
          '<span class="sb-switch-track"><span class="sb-switch-thumb"></span></span>' +
        '</button>';
      };

      const renderPoolItem = (s, pl, isFlat) => {
        const barVal = fmtVal(pl.remainingPct);
        const unitSuffix = isUsedGlobal ? '% used' : '%';
        const sbKey = getStatusBarKey(s.id, pl.id);
        const sbSwitchHtml = renderSbSwitch(sbKey, pl.name, pl.remainingPct);
        const isWarn = pl.remainingPct <= 20;

        const hasFiveH = typeof pl.fiveHourPct === 'number';
        const hasWeekly = typeof pl.weeklyPct === 'number';
        const metaParts = [];
        if (pl.weeklyPct === 0 && hasFiveH && pl.fiveHourPct > 0) {
          metaParts.push('Weekly cap');
        }
        if (hasFiveH) metaParts.push('5h ' + fmtVal(pl.fiveHourPct) + '%');
        if (hasWeekly) metaParts.push('Weekly ' + fmtVal(pl.weeklyPct) + '%');
        const resetLbl = pl.nextResetLabel && pl.nextResetLabel !== '--'
          ? pl.nextResetLabel
          : (pl.fiveHourResetLabel || pl.fiveHourReset || pl.weeklyResetLabel || pl.weeklyReset || '');
        if (resetLbl && resetLbl !== '--') metaParts.push('Resets ' + resetLbl);

        const tooltipParts = [s.name + ' · ' + pl.name];
        if (hasFiveH) tooltipParts.push('5h: ' + pl.fiveHourPct + '% left (' + (100 - pl.fiveHourPct) + '% used)');
        if (hasWeekly) tooltipParts.push('Weekly: ' + pl.weeklyPct + '% left (' + (100 - pl.weeklyPct) + '% used)');
        if (pl.fiveHourReset) tooltipParts.push('5h reset: ' + pl.fiveHourReset);
        if (pl.weeklyReset) tooltipParts.push('Weekly reset: ' + pl.weeklyReset);

        const providerPill = isFlat
          ? '<span class="provider-code-pill" title="' + esc(s.name) + '">' + esc(s.shortCode) + '</span>'
          : '';

        return '<div class="pool-item' + (isFlat ? ' flat-pool' : '') + '" title="' + esc(tooltipParts.join(' | ')) + '">' +
          '<div class="pool-head">' +
            '<div class="pool-name-group">' + providerPill + '<span class="pool-name">' + esc(pl.name) + '</span></div>' +
            '<div class="pool-head-right">' +
              '<span class="pool-val' + (isWarn ? ' warn' : '') + '">' + barVal + unitSuffix + '</span>' +
              sbSwitchHtml +
            '</div>' +
          '</div>' +
          '<div class="q-track"><div class="q-fill' + (isWarn ? ' warn' : '') + '" style="width:' + barVal + '%"></div></div>' +
          (metaParts.length > 0 ? '<div class="pool-meta">' + esc(metaParts.join(' · ')) + '</div>' : '') +
        '</div>';
      };

      const poolMatchesFilter = (s, pl) => {
        if (activeStatusFilter === 'low') {
          return pl.remainingPct <= 20 ||
            (typeof pl.fiveHourPct === 'number' && pl.fiveHourPct <= 20) ||
            (typeof pl.weeklyPct === 'number' && pl.weeklyPct <= 20);
        }
        if (activeStatusFilter === 'pinned') {
          const sbKey = getStatusBarKey(s.id, pl.id);
          return Boolean(sbKey && activeSb.has(sbKey));
        }
        return true;
      };

      const providerScoped = activeProviderFilter === 'all'
        ? snapshots
        : snapshots.filter((s) => s.id === activeProviderFilter);

      const breakdownEl = document.getElementById('quotaBreakdown');
      const blocks = [];

      const appendNonLiveBlock = (p) => {
        if (activeStatusFilter !== 'all') return;
        const badge = p.status === 'coming_soon' ? 'Coming soon' : 'Unavailable';
        const sub = p.status === 'coming_soon' ? 'Not yet configured' : (p.note || 'Unavailable');
        blocks.push(
          '<div class="provider-block">' +
            '<div class="provider-row">' +
              '<div class="pr-left">' +
                '<div class="pr-icon">' + esc(p.shortCode) + '</div>' +
                '<div><div class="pr-name">' + esc(p.name) + '</div><div class="pr-sub">' + esc(sub) + '</div></div>' +
              '</div>' +
              '<span class="badge-soon">' + esc(badge) + '</span>' +
            '</div>' +
          '</div>'
        );
      };

      if (limitSort === 'default') {
        for (const p of providerScoped) {
          if (p.status !== 'live' || p.pools.length === 0) {
            appendNonLiveBlock(p);
            continue;
          }
          const matchedPools = p.pools.filter((pl) => poolMatchesFilter(p, pl));
          if (matchedPools.length === 0) continue;

          const avg = Math.round(matchedPools.reduce((s, pl) => s + pl.remainingPct, 0) / matchedPools.length);
          const headVal = fmtVal(avg) + (isUsedGlobal ? '% used' : '%');
          const headWarn = avg <= 20 ? ' warn' : '';
          const poolsHtml = matchedPools.map((pl) => renderPoolItem(p, pl, false)).join('');

          blocks.push(
            '<div class="provider-block">' +
              '<div class="provider-row">' +
                '<div class="pr-left">' +
                  '<div class="pr-icon">' + esc(p.shortCode) + '</div>' +
                  '<div><div class="pr-name">' + esc(p.name) + '</div><div class="pr-sub">' + esc(p.sourceKind) + '</div></div>' +
                '</div>' +
                '<span class="pr-pct' + headWarn + '">' + headVal + '</span>' +
              '</div>' +
              '<div class="pool-list">' + poolsHtml + '</div>' +
            '</div>'
          );
        }
      } else {
        const flatItems = [];
        for (const p of providerScoped) {
          if (p.status !== 'live' || p.pools.length === 0) {
            appendNonLiveBlock(p);
            continue;
          }
          for (const pl of p.pools) {
            if (poolMatchesFilter(p, pl)) {
              flatItems.push({ p, pl });
            }
          }
        }

        flatItems.sort((a, b) => {
          if (limitSort === 'lowest') {
            const diff = a.pl.remainingPct - b.pl.remainingPct;
            if (diff !== 0) return diff;
            return (a.pl.nextResetMs ?? Number.MAX_SAFE_INTEGER) - (b.pl.nextResetMs ?? Number.MAX_SAFE_INTEGER);
          }
          if (limitSort === 'highest') {
            return b.pl.remainingPct - a.pl.remainingPct;
          }
          if (limitSort === 'reset') {
            return (a.pl.nextResetMs ?? Number.MAX_SAFE_INTEGER) - (b.pl.nextResetMs ?? Number.MAX_SAFE_INTEGER);
          }
          if (limitSort === 'name') {
            return a.pl.name.localeCompare(b.pl.name);
          }
          return 0;
        });

        for (const item of flatItems) {
          blocks.push(renderPoolItem(item.p, item.pl, true));
        }
      }

      if (blocks.length === 0) {
        breakdownEl.innerHTML = '<div class="empty-state">' +
          '<div>No providers or pools match this filter.</div>' +
          '<button type="button" class="btn-ghost" id="resetFiltersBtn">Reset Filters</button>' +
        '</div>';
        const resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) {
          resetBtn.addEventListener('click', () => {
            activeProviderFilter = 'all';
            activeStatusFilter = 'all';
            limitSort = 'default';
            if (limitSortSelect) limitSortSelect.value = 'default';
            saveViewState({ providerFilter: 'all', statusFilter: 'all', limitSort: 'default' });
            renderAll();
          });
        }
      } else {
        breakdownEl.innerHTML = blocks.join('');
        breakdownEl.querySelectorAll('[data-sb-toggle]').forEach((btn) => {
          btn.addEventListener('click', (ev) => {
            if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            const sbKey = btn.getAttribute('data-sb-toggle');
            if (!sbKey) return;
            const current = getActiveSbSet(lastPayload && lastPayload.config);
            if (current.has(sbKey)) current.delete(sbKey);
            else current.add(sbKey);
            const next = Array.from(current);
            if (lastPayload) {
              lastPayload.config = { ...(lastPayload.config || {}), statusBarProviders: next };
            }
            vscode.postMessage({ command: 'updateConfig', key: 'statusBarProviders', value: next });
            renderAll();
          });
        });
      }

      renderBars(history);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || msg.command !== 'state') return;
      lastPayload = msg.payload;
      renderAll();
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
