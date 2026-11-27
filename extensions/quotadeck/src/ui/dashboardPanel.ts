import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { computePoolPacing } from '../pacing';
import { PollStatusInfo } from '../pollingPolicy';
import { formatResetCountdown, parseAgyResetTimestamp } from '../timeFormat';
import { HistoryPoint, MonitorConfig, ProviderSnapshot, averageRemainingPct } from '../types';

export type DashboardConfigKey = 'displayMode' | 'statusBarProviders' | 'pollingIntervalSeconds' | 'smartPolling';

export interface DashboardCallbacks {
  onRefresh: () => Promise<void>;
  onClearHistory: () => Promise<void>;
  onUpdateConfig?: (key: DashboardConfigKey, value: unknown) => Promise<void>;
  onConnectProvider?: (providerId?: string) => Promise<string | void>;
  onDisconnectProvider?: (providerId: string) => Promise<void>;
  onRemoveCustomProvider?: (providerId: string) => Promise<void>;
}

export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private latestSnapshots: ProviderSnapshot[] = [];
  private latestHistory: HistoryPoint[] = [];
  private latestConfig: MonitorConfig | undefined;
  private latestPollStatus: PollStatusInfo | undefined;

  constructor(
    private readonly callbacks: DashboardCallbacks,
    private readonly extensionUri?: vscode.Uri
  ) {}

  show(snapshots: ProviderSnapshot[], history: HistoryPoint[], config: MonitorConfig, pollStatus?: PollStatusInfo): void {
    this.latestSnapshots = snapshots;
    this.latestHistory = history;
    this.latestConfig = config;
    if (pollStatus) {
      this.latestPollStatus = pollStatus;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postState();
      return;
    }

    const localResourceRoots = this.extensionUri
      ? [vscode.Uri.joinPath(this.extensionUri, 'dist')]
      : [];

    this.panel = vscode.window.createWebviewPanel(
      'quotadeck.dashboard',
      'QuotaDeck',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots,
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
          if (
            (key === 'displayMode' ||
              key === 'statusBarProviders' ||
              key === 'pollingIntervalSeconds' ||
              key === 'smartPolling') &&
            this.callbacks.onUpdateConfig
          ) {
            await this.callbacks.onUpdateConfig(key, message.value);
          }
        } else if (message.command === 'connectProvider') {
          let notice: string | void = undefined;
          try {
            if (this.callbacks.onConnectProvider) {
              notice = await this.callbacks.onConnectProvider(
                typeof message.providerId === 'string' ? message.providerId : undefined
              );
            }
          } finally {
            this.postActionDone(typeof notice === 'string' ? notice : undefined);
          }
        } else if (message.command === 'disconnectProvider') {
          try {
            if (typeof message.providerId === 'string' && this.callbacks.onDisconnectProvider) {
              await this.callbacks.onDisconnectProvider(message.providerId);
            }
          } finally {
            this.postActionDone();
          }
        } else if (message.command === 'removeCustomProvider') {
          try {
            if (typeof message.providerId === 'string' && this.callbacks.onRemoveCustomProvider) {
              await this.callbacks.onRemoveCustomProvider(message.providerId);
            }
          } finally {
            this.postActionDone();
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

  update(snapshots: ProviderSnapshot[], history: HistoryPoint[], config: MonitorConfig, pollStatus?: PollStatusInfo): void {
    this.latestSnapshots = snapshots;
    this.latestHistory = history;
    this.latestConfig = config;
    if (pollStatus) {
      this.latestPollStatus = pollStatus;
    }
    if (this.panel) {
      this.postState();
    }
  }

  private postActionDone(notice?: string): void {
    this.panel?.webview.postMessage({ command: 'actionDone', notice });
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
          pacing: computePoolPacing(p, fiveHourResetMs, weeklyResetMs),
        };
      }),
    }));

    const allPools = enrichedSnapshots
      .filter((s) => s.status === 'live')
      .flatMap((s) => s.pools.map((p) => ({ ...p, providerId: s.id, providerName: s.name })));

    const lowest = [...allPools]
      .filter((p) => typeof p.remainingPct === 'number')
      .sort((a, b) => (a.remainingPct ?? 0) - (b.remainingPct ?? 0))[0];
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
        pollStatus: this.latestPollStatus,
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

  private resolveAssetUri(webview: vscode.Webview, filename: string): string {
    if (this.extensionUri) {
      const diskUri = vscode.Uri.joinPath(this.extensionUri, 'dist', filename);
      if (typeof webview.asWebviewUri === 'function') {
        return String(webview.asWebviewUri(diskUri));
      }
      return String(diskUri);
    }
    return `dist/${filename}`;
  }

  private buildHtml(webview: vscode.Webview, nonce: string): string {
    const styleUri = this.resolveAssetUri(webview, 'webview.css');
    const scriptUri = this.resolveAssetUri(webview, 'webview.js');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>QuotaDeck</title>
  <link rel="stylesheet" href="${styleUri}">
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
      <button type="button" class="btn" id="addAgentBtn" title="Add API key or custom agent endpoint">
        <svg class="btn-icon" id="addAgentBtnIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <line x1="8" y1="3" x2="8" y2="13"/>
          <line x1="3" y1="8" x2="13" y2="8"/>
        </svg>
        <span id="addAgentBtnLabel">Add Agent</span>
      </button>
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
        <span class="meta-time" id="actionNotice" aria-live="polite"></span>
      </div>
      <div class="board-controls">
        <select class="select-control" id="pollIntervalSelect" aria-label="Auto reload interval" title="Baseline auto-reload interval">
          <option value="30">Reload: 30s</option>
          <option value="60">Reload: 1m</option>
          <option value="300">Reload: 5m</option>
          <option value="600">Reload: 10m</option>
        </select>
        <button type="button" class="filter-tab active" id="smartPollBtn" aria-pressed="true" title="Smart polling: speeds up to 1m when quota drops, relaxes after 3 unchanged checks">Smart</button>
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
            <div class="history-select-group">
              <select class="select-control" id="historyProviderSelect" aria-label="Filter history by provider">
                <option value="all">All Providers</option>
              </select>
              <select class="select-control" id="historyWindowSelect" aria-label="Filter history by quota window">
                <option value="all">All Windows</option>
                <option value="5h">5h Window</option>
                <option value="weekly">Weekly Window</option>
              </select>
            </div>
            <div class="range-tabs">
              <button type="button" class="range-tab active" data-range="24H">24H</button>
              <button type="button" class="range-tab" data-range="7D">7D</button>
              <button type="button" class="range-tab" data-range="30D">30D</button>
            </div>
          </div>
          <div class="chart-popover" id="chartPopover">
            <div class="pop-pct" id="popPct">--%</div>
            <div class="pop-desc" id="popDesc">--</div>
            <div class="pop-detail" id="popDetail"></div>
          </div>
          <div class="bars-row" id="barsRow"></div>
        </div>
      </div>
    </div>
  </main>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
