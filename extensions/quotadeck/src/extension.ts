import * as vscode from 'vscode';
import { readMonitorConfig } from './config';
import { LOCAL_PROVIDER_IDS, createProviderOnboardingFlows } from './flows/providerOnboarding';
import {
  ACTIVE_COOLDOWN_POLLS,
  PollStatusInfo,
  computeQuotaSignature,
  computeSmartPollDelay,
  findEarliestResetMs,
  hasQuotaOrBalanceDrop,
} from './pollingPolicy';
import { AntigravityProvider } from './providers/antigravityProvider';
import { ClaudeCodeProvider } from './providers/claudeProvider';
import { ClineProvider } from './providers/clineProvider';
import { CodexProvider } from './providers/codexProvider';
import { fetchCustomProviderSnapshot } from './providers/customProviderRunner';
import { DeepSeekProvider } from './providers/deepSeekProvider';
import { OpenRouterProvider } from './providers/openRouterProvider';
import { VsCodeSecretStore } from './secrets';
import { HistoryStore } from './storage/historyStore';
import { ProviderSnapshot, QuotaProvider } from './types';
import { DashboardPanel } from './ui/dashboardPanel';
import { StatusBarController } from './ui/statusBar';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('QuotaDeck');
  context.subscriptions.push(output);

  const secretStore = new VsCodeSecretStore(context.secrets);
  const historyStore = new HistoryStore(context.globalStorageUri.fsPath);
  const providers: QuotaProvider[] = [
    new AntigravityProvider(),
    new ClaudeCodeProvider(),
    new CodexProvider(),
    new OpenRouterProvider({ secretStore }),
    new DeepSeekProvider({ secretStore }),
    new ClineProvider({ secretStore }),
  ];

  const statusBar = new StatusBarController();
  context.subscriptions.push(statusBar);

  let latestSnapshots: ProviderSnapshot[] = [];
  const skippedLocalProviderIds = new Set<string>();
  let activeRefreshPromise: Promise<void> | null = null;
  let pendingRecordHistory = false;
  let lastRefreshCompletedMs = 0;
  let lastQuotaSignature = '';
  let unchangedStreak = 0;
  let activeBurstRemaining = 0;
  const initialConfig = readMonitorConfig();
  let currentPollDelayMs = initialConfig.pollingIntervalSeconds * 1000;
  let latestPollStatus: PollStatusInfo = {
    mode: initialConfig.smartPolling !== false ? 'auto' : 'fixed',
    intervalSeconds: initialConfig.pollingIntervalSeconds,
    baseSeconds: initialConfig.pollingIntervalSeconds,
    smartEnabled: initialConfig.smartPolling !== false,
    activeRemainingCooldown: 0,
  };
  let pollingTimer: ReturnType<typeof setTimeout> | undefined;
  let configDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const scheduleNextPoll = () => {
    if (disposed) {
      return;
    }
    if (pollingTimer) {
      clearTimeout(pollingTimer);
    }
    pollingTimer = setTimeout(() => {
      pollingTimer = undefined;
      if (disposed) {
        return;
      }
      if (vscode.window.state.focused) {
        void refreshAll(true, false);
      } else {
        scheduleNextPoll();
      }
    }, currentPollDelayMs);
  };

  let dashboard: DashboardPanel;

  const refreshAll = async (recordHistory: boolean, isManual = false): Promise<void> => {
    if (recordHistory) {
      pendingRecordHistory = true;
    }
    if (activeRefreshPromise) {
      return activeRefreshPromise;
    }

    activeRefreshPromise = (async () => {
      statusBar.setLoading(true);
      try {
        const shouldRecord = pendingRecordHistory;
        pendingRecordHistory = false;

        const config = readMonitorConfig();
        if (isManual) {
          skippedLocalProviderIds.clear();
        }
        const builtInPromise = Promise.all(
          providers.map(async (p) => {
            if (!isManual && LOCAL_PROVIDER_IDS.has(p.id) && skippedLocalProviderIds.has(p.id)) {
              const prev = latestSnapshots.find((s) => s.id === p.id);
              if (prev) {
                return prev;
              }
            }
            const snap = await p.fetchSnapshot(config);
            if (LOCAL_PROVIDER_IDS.has(p.id)) {
              if (snap.status === 'not_connected') {
                skippedLocalProviderIds.add(p.id);
              } else {
                skippedLocalProviderIds.delete(p.id);
              }
            }
            return snap;
          })
        );
        const customConfigs = config.customProviders ?? [];
        const customPromise = Promise.all(
          customConfigs.map((cfg) => fetchCustomProviderSnapshot(cfg, { secretStore }))
        );
        const prevSnapshots = latestSnapshots;
        const [builtInSnaps, customSnaps] = await Promise.all([builtInPromise, customPromise]);
        latestSnapshots = [...builtInSnaps, ...customSnaps];

        const nowMs = Date.now();
        lastRefreshCompletedMs = nowMs;

        const smartEnabled = config.smartPolling !== false;
        const sig = computeQuotaSignature(latestSnapshots);
        const dropped = smartEnabled && hasQuotaOrBalanceDrop(prevSnapshots, latestSnapshots);

        if (dropped) {
          activeBurstRemaining = ACTIVE_COOLDOWN_POLLS;
          unchangedStreak = 0;
          output.appendLine('[POLL] Usage drop detected — switching to active 1m polling.');
        } else if (isManual || lastQuotaSignature === '' || sig !== lastQuotaSignature) {
          if (unchangedStreak > 0 && sig !== lastQuotaSignature) {
            output.appendLine('[POLL] Quota changed — resetting polling interval to baseline.');
          }
          unchangedStreak = 0;
        } else if (activeBurstRemaining > 0) {
          activeBurstRemaining -= 1;
          unchangedStreak = 0;
          if (activeBurstRemaining === 0) {
            output.appendLine('[POLL] Active cooldown complete — returning to baseline interval.');
          }
        } else {
          unchangedStreak += 1;
        }
        lastQuotaSignature = sig;

        const earliestResetMs = findEarliestResetMs(latestSnapshots, nowMs);
        const computed = computeSmartPollDelay({
          baseIntervalSeconds: config.pollingIntervalSeconds,
          smartEnabled,
          activeBurstRemaining,
          unchangedStreak,
          nowMs,
          earliestResetMs,
        });
        const nextDelayMs = computed.delayMs;
        latestPollStatus = computed.status;
        if (nextDelayMs !== currentPollDelayMs) {
          output.appendLine(
            `[POLL] Mode=${latestPollStatus.mode}; next refresh in ${Math.round(nextDelayMs / 1000)}s.`
          );
        }
        currentPollDelayMs = nextDelayMs;

        statusBar.update(latestSnapshots, config);
        if (shouldRecord) {
          await historyStore.appendSnapshot(latestSnapshots);
        }
        const history = await historyStore.readRecent(100);
        dashboard.update(latestSnapshots, history, config, latestPollStatus);
      } catch (err) {
        output.appendLine(`[ERROR] Refresh failed: ${String(err)}`);
      } finally {
        statusBar.setLoading(false);
        activeRefreshPromise = null;
        scheduleNextPoll();
      }
    })();

    return activeRefreshPromise;
  };

  let flows: ReturnType<typeof createProviderOnboardingFlows>;

  dashboard = new DashboardPanel(
    {
      onRefresh: async () => {
        await refreshAll(true, true);
      },
      onClearHistory: async () => {
        await historyStore.clear();
        const config = readMonitorConfig();
        dashboard.update(latestSnapshots, [], config);
      },
      onUpdateConfig: async (key, value) => {
        await vscode.workspace
          .getConfiguration('quotadeck')
          .update(key, value, vscode.ConfigurationTarget.Global);
        const config = readMonitorConfig();
        statusBar.update(latestSnapshots, config);
        if (key === 'pollingIntervalSeconds' || key === 'smartPolling') {
          unchangedStreak = 0;
          activeBurstRemaining = 0;
          const recomputed = computeSmartPollDelay({
            baseIntervalSeconds: config.pollingIntervalSeconds,
            smartEnabled: config.smartPolling !== false,
            activeBurstRemaining: 0,
            unchangedStreak: 0,
            nowMs: Date.now(),
            earliestResetMs: findEarliestResetMs(latestSnapshots, Date.now()),
          });
          currentPollDelayMs = recomputed.delayMs;
          latestPollStatus = recomputed.status;
          scheduleNextPoll();
        }
        const history = await historyStore.readRecent(100);
        dashboard.update(latestSnapshots, history, config, latestPollStatus);
      },
      onConnectProvider: async (providerId) => flows.connectProviderFlow(providerId),
      onDisconnectProvider: async (providerId) => flows.disconnectProviderFlow(providerId),
      onRemoveCustomProvider: async (providerId) => flows.removeCustomProviderFlow(providerId),
    },
    context.extensionUri
  );
  context.subscriptions.push(dashboard);

  flows = createProviderOnboardingFlows({
    providers,
    secretStore,
    historyStore,
    statusBar,
    dashboard,
    output,
    skippedLocalProviderIds,
    getLatestSnapshots: () => latestSnapshots,
    setLatestSnapshots: (snapshots) => {
      latestSnapshots = snapshots;
    },
    refreshAll,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('quotadeck.openDashboard', async () => {
      if (latestSnapshots.length === 0) {
        await refreshAll(true, true);
      }
      const config = readMonitorConfig();
      const history = await historyStore.readRecent(100);
      dashboard.show(latestSnapshots, history, config);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quotadeck.refresh', async () => {
      await refreshAll(true, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quotadeck.clearHistory', async () => {
      await historyStore.clear();
      const config = readMonitorConfig();
      dashboard.update(latestSnapshots, [], config);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quotadeck.connectProvider', async () => {
      await flows.connectProviderFlow();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quotadeck.disconnectProvider', async () => {
      await flows.disconnectProviderFlow();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        return;
      }
      if (Date.now() - lastRefreshCompletedMs >= currentPollDelayMs) {
        void refreshAll(true, false);
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      disposed = true;
      if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = undefined;
      }
      if (configDebounceTimer) {
        clearTimeout(configDebounceTimer);
        configDebounceTimer = undefined;
      }
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('quotadeck')) {
        if (configDebounceTimer) {
          clearTimeout(configDebounceTimer);
        }
        configDebounceTimer = setTimeout(() => {
          configDebounceTimer = undefined;
          const config = readMonitorConfig();
          statusBar.update(latestSnapshots, config);
          if (
            e.affectsConfiguration('quotadeck.pollingIntervalSeconds') ||
            e.affectsConfiguration('quotadeck.smartPolling') ||
            e.affectsConfiguration('quotadeck.budgets') ||
            e.affectsConfiguration('quotadeck.customProviders')
          ) {
            unchangedStreak = 0;
            activeBurstRemaining = 0;
            currentPollDelayMs = config.pollingIntervalSeconds * 1000;
            void refreshAll(false, true);
          } else {
            void historyStore.readRecent(100).then((history) => {
              dashboard.update(latestSnapshots, history, config, latestPollStatus);
            });
          }
        }, 150);
      }
    })
  );

  void refreshAll(true, true);
}

export function deactivate(): void {
  // Disposables are managed via context.subscriptions.
}
