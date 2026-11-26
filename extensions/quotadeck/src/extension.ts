import * as vscode from 'vscode';
import { readMonitorConfig } from './config';
import { computeNextPollDelayMs, computeQuotaSignature, findEarliestResetMs } from './pollingPolicy';
import { AntigravityProvider } from './providers/antigravityProvider';
import { ClaudeCodeProvider } from './providers/claudeProvider';
import { ClineProvider } from './providers/clineProvider';
import { CodexProvider } from './providers/codexProvider';
import { fetchCustomProviderSnapshot } from './providers/customProviderRunner';
import { DeepSeekProvider } from './providers/deepSeekProvider';
import { OpenRouterProvider } from './providers/openRouterProvider';
import { VsCodeSecretStore, providerSecretKey } from './secrets';
import { HistoryStore } from './storage/historyStore';
import { ProviderSnapshot, QuotaProvider } from './types';
import { DashboardPanel } from './ui/dashboardPanel';
import { StatusBarController } from './ui/statusBar';

const LOCAL_PROVIDER_IDS = new Set(['agy', 'claude', 'codex']);
const LOCAL_PROVIDER_META: Record<string, { label: string; description: string }> = {
  agy: { label: 'Antigravity', description: 'Local CLI · Re-check agy /usage' },
  claude: { label: 'Claude Code', description: 'Local OAuth · Re-check Keychain / .credentials.json' },
  codex: { label: 'Codex', description: 'Local OAuth · Re-check ~/.codex/auth.json' },
};

const KEY_PROVIDER_LABELS: Record<string, { label: string; prompt: string }> = {
  openrouter: { label: 'OpenRouter', prompt: 'Enter your OpenRouter API key' },
  deepseek: { label: 'DeepSeek', prompt: 'Enter your DeepSeek API key' },
  cline: { label: 'Cline', prompt: 'Enter your Cline API / session token' },
};

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
  let currentPollDelayMs = readMonitorConfig().pollingIntervalSeconds * 1000;
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
        const [builtInSnaps, customSnaps] = await Promise.all([builtInPromise, customPromise]);
        latestSnapshots = [...builtInSnaps, ...customSnaps];

        const nowMs = Date.now();
        lastRefreshCompletedMs = nowMs;

        const sig = computeQuotaSignature(latestSnapshots);
        if (isManual || lastQuotaSignature === '' || sig !== lastQuotaSignature) {
          if (unchangedStreak > 0 && sig !== lastQuotaSignature) {
            output.appendLine('[POLL] Quota changed — resetting polling interval to baseline.');
          }
          unchangedStreak = 0;
        } else {
          unchangedStreak += 1;
        }
        lastQuotaSignature = sig;

        const earliestResetMs = findEarliestResetMs(latestSnapshots, nowMs);
        const nextDelayMs = computeNextPollDelayMs(
          config.pollingIntervalSeconds,
          unchangedStreak,
          nowMs,
          earliestResetMs
        );
        if (nextDelayMs !== currentPollDelayMs) {
          output.appendLine(
            `[POLL] Unchanged streak=${unchangedStreak}; next refresh in ${Math.round(nextDelayMs / 1000)}s.`
          );
        }
        currentPollDelayMs = nextDelayMs;

        statusBar.update(latestSnapshots, config);

        if (shouldRecord) {
          await historyStore.appendSnapshot(latestSnapshots);
        }
        const history = await historyStore.readRecent(100);
        dashboard.update(latestSnapshots, history, config);
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

  const addCustomProviderWizard = async (): Promise<void> => {
    const name = (await vscode.window.showInputBox({
      prompt: 'Custom Agent / Provider Name',
      placeHolder: 'e.g. My LLM Gateway',
      ignoreFocusOut: true,
    }))?.trim();
    if (!name) {
      return;
    }

    const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'custom';
    const existing = readMonitorConfig().customProviders ?? [];
    let id = baseId;
    let n = 2;
    while (existing.some((c) => c.id === id)) {
      id = `${baseId.slice(0, 20)}-${n++}`;
    }

    const kindPick = await vscode.window.showQuickPick(
      [
        { label: 'HTTP JSON Endpoint', description: 'https:// or http://localhost', providerKind: 'http' as const },
        { label: 'Local CLI Command', description: 'Run a CLI tool that outputs JSON', providerKind: 'cli' as const },
      ],
      { placeHolder: 'Select provider type' }
    );
    if (!kindPick) {
      return;
    }

    let url: string | undefined;
    let command: string | undefined;
    if (kindPick.providerKind === 'http') {
      url = (await vscode.window.showInputBox({
        prompt: 'Usage API Endpoint URL (https:// or localhost)',
        placeHolder: 'https://api.example.com/v1/usage',
        ignoreFocusOut: true,
      }))?.trim();
      if (!url) {
        return;
      }
    } else {
      command = (await vscode.window.showInputBox({
        prompt: 'CLI Command to execute',
        placeHolder: 'my-agent-cli',
        ignoreFocusOut: true,
      }))?.trim();
      if (!command) {
        return;
      }
    }

    const valTypePick = await vscode.window.showQuickPick(
      [
        { label: 'Remaining Percentage (0–100)', valueType: 'percentage' as const },
        { label: 'Used Percentage (0–100)', valueType: 'used_percentage' as const },
        { label: 'USD Balance ($)', valueType: 'balance_usd' as const },
      ],
      { placeHolder: 'How is the quota value represented in JSON?' }
    );
    if (!valTypePick) {
      return;
    }

    const valuePath = (await vscode.window.showInputBox({
      prompt: 'JSON dot-path to the quota/balance value',
      placeHolder: 'e.g. data.remaining_pct or balance',
      ignoreFocusOut: true,
    }))?.trim();
    if (!valuePath) {
      return;
    }

    const apiKey = (await vscode.window.showInputBox({
      prompt: 'Optional API Key / Bearer Token (leave empty if not needed)',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Optional Bearer token (stored securely in SecretStorage)',
    }))?.trim();

    const secretKey = apiKey ? `quotadeck.secret.${id}` : undefined;
    if (apiKey && secretKey) {
      await secretStore.set(secretKey, apiKey);
    }

    const shortCode = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'CU';
    const nextList = [
      ...existing,
      {
        id,
        name,
        shortCode,
        kind: kindPick.providerKind,
        url,
        command,
        secretKey,
        valueType: valTypePick.valueType,
        valuePath,
      },
    ];

    await vscode.workspace
      .getConfiguration('quotadeck')
      .update('customProviders', nextList, vscode.ConfigurationTarget.Global);
    output.appendLine(`[CUSTOM] Added custom provider "${name}" (${id}).`);
    vscode.window.setStatusBarMessage(`QuotaDeck: Added ${name}`, 3500);
    await refreshAll(false, true);
  };

  const removeCustomProviderFlow = async (providerId: string): Promise<void> => {
    const customId = providerId.startsWith('custom:') ? providerId.slice('custom:'.length) : providerId;
    const existing = readMonitorConfig().customProviders ?? [];
    const target = existing.find((c) => c.id === customId);
    if (!target) {
      return;
    }
    if (target.secretKey) {
      await secretStore.delete(target.secretKey);
    }
    const nextList = existing.filter((c) => c.id !== customId);
    await vscode.workspace
      .getConfiguration('quotadeck')
      .update('customProviders', nextList, vscode.ConfigurationTarget.Global);
    output.appendLine(`[CUSTOM] Removed custom provider "${target.name}" (${customId}).`);
    vscode.window.setStatusBarMessage(`QuotaDeck: Removed ${target.name}`, 3500);
    await refreshAll(false, true);
  };

  const recheckLocalProvider = async (providerId: string): Promise<string> => {
    const provider = providers.find((p) => p.id === providerId);
    const meta = LOCAL_PROVIDER_META[providerId];
    if (!provider || !meta) {
      return '';
    }
    skippedLocalProviderIds.delete(providerId);
    const config = readMonitorConfig();
    const snap = await provider.fetchSnapshot(config);
    if (snap.status === 'not_connected') {
      skippedLocalProviderIds.add(providerId);
    }
    const nextSnapshots = latestSnapshots.some((s) => s.id === providerId)
      ? latestSnapshots.map((s) => (s.id === providerId ? snap : s))
      : [...latestSnapshots, snap];
    latestSnapshots = nextSnapshots;
    statusBar.update(latestSnapshots, config);
    const history = await historyStore.readRecent(100);
    dashboard.update(latestSnapshots, history, config);

    if (snap.status === 'live') {
      vscode.window.setStatusBarMessage(`QuotaDeck: Connected ${meta.label}`, 3500);
      output.appendLine(`[LOCAL] Connected ${meta.label} on manual check.`);
      return `Connected ${meta.label}`;
    }
    const reason = snap.note ?? 'not installed or not signed in';
    vscode.window.setStatusBarMessage(`QuotaDeck: ${meta.label} not found (${reason})`, 5000);
    output.appendLine(`[LOCAL] ${meta.label} check failed: ${reason}`);
    return `${meta.label} not found — ${reason}`;
  };

  const connectProviderFlow = async (targetId?: string): Promise<string | void> => {
    if (targetId && LOCAL_PROVIDER_IDS.has(targetId)) {
      return recheckLocalProvider(targetId);
    }

    const config = readMonitorConfig();
    const customEntries = (config.customProviders ?? [])
      .filter((c) => Boolean(c.secretKey))
      .map((c) => ({
        id: `custom:${c.id}`,
        label: c.name,
        description: 'Custom Provider Secret',
        secretKey: c.secretKey!,
        prompt: `Enter secret for ${c.name} (${c.secretKey})`,
      }));

    const localEntries = Array.from(LOCAL_PROVIDER_IDS).map((id) => {
      const meta = LOCAL_PROVIDER_META[id];
      const existing = latestSnapshots.find((s) => s.id === id);
      const statusTag = existing?.status === 'live' ? 'Connected · Re-check' : meta.description;
      return { id, label: meta.label, description: statusTag };
    });

    const options = [
      { id: 'openrouter', label: 'OpenRouter', description: 'Official API · Credit limit & balance', secretKey: providerSecretKey('openrouter'), prompt: KEY_PROVIDER_LABELS.openrouter.prompt },
      { id: 'deepseek', label: 'DeepSeek', description: 'Official API · Account balance', secretKey: providerSecretKey('deepseek'), prompt: KEY_PROVIDER_LABELS.deepseek.prompt },
      { id: 'cline', label: 'Cline / ClinePass', description: 'Official API · 5h/Weekly limits & balance', secretKey: providerSecretKey('cline'), prompt: KEY_PROVIDER_LABELS.cline.prompt },
      ...customEntries,
    ];

    let chosen = targetId ? options.find((o) => o.id === targetId) : undefined;
    if (!chosen) {
      const picked = await vscode.window.showQuickPick(
        [
          ...options.map((o) => ({ label: o.label, description: o.description, actionType: 'key' as const, option: o, localId: undefined as string | undefined })),
          ...localEntries.map((l) => ({ label: l.label, description: l.description, actionType: 'local' as const, option: undefined, localId: l.id })),
          { label: '$(plus) Custom HTTP / CLI Endpoint', description: 'Add your own API endpoint or CLI tool', actionType: 'custom' as const, option: undefined, localId: undefined as string | undefined },
        ],
        { placeHolder: 'Add Agent / Connect Provider' }
      );
      if (!picked) {
        return;
      }
      if (picked.actionType === 'custom') {
        await addCustomProviderWizard();
        return;
      }
      if (picked.actionType === 'local' && picked.localId) {
        return recheckLocalProvider(picked.localId);
      }
      chosen = picked.option;
    }
    if (!chosen) {
      return;
    }

    const token = await vscode.window.showInputBox({
      prompt: chosen.prompt,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Paste API key or token',
    });
    if (!token || !token.trim()) {
      return;
    }

    await secretStore.set(chosen.secretKey, token.trim());
    output.appendLine(`[AUTH] Stored credentials for ${chosen.id} in SecretStorage.`);
    vscode.window.setStatusBarMessage(`QuotaDeck: Connected ${chosen.label}`, 3500);
    await refreshAll(false, true);
  };

  const disconnectProviderFlow = async (targetId?: string): Promise<void> => {
    const config = readMonitorConfig();
    const customEntries = (config.customProviders ?? [])
      .filter((c) => Boolean(c.secretKey))
      .map((c) => ({ id: `custom:${c.id}`, label: c.name, secretKey: c.secretKey! }));

    const options = [
      ...Object.entries(KEY_PROVIDER_LABELS).map(([id, meta]) => ({
        id,
        label: meta.label,
        secretKey: providerSecretKey(id),
      })),
      ...customEntries,
    ];

    let chosen = targetId ? options.find((o) => o.id === targetId) : undefined;
    if (!chosen) {
      const picked = await vscode.window.showQuickPick(
        options.map((o) => ({ label: o.label, description: o.id, option: o })),
        { placeHolder: 'Select provider to disconnect' }
      );
      chosen = picked?.option;
    }
    if (!chosen) {
      return;
    }

    await secretStore.delete(chosen.secretKey);
    output.appendLine(`[AUTH] Removed credentials for ${chosen.id} from SecretStorage.`);
    vscode.window.setStatusBarMessage(`QuotaDeck: Disconnected ${chosen.label}`, 3500);
    await refreshAll(false, true);
  };

  const dashboard = new DashboardPanel(
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
        const history = await historyStore.readRecent(100);
        dashboard.update(latestSnapshots, history, config);
      },
      onConnectProvider: async (providerId) => {
        return connectProviderFlow(providerId);
      },
      onDisconnectProvider: async (providerId) => {
        await disconnectProviderFlow(providerId);
      },
      onRemoveCustomProvider: async (providerId) => {
        await removeCustomProviderFlow(providerId);
      },
    },
    context.extensionUri
  );
  context.subscriptions.push(dashboard);

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
      await connectProviderFlow();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quotadeck.disconnectProvider', async () => {
      await disconnectProviderFlow();
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
            e.affectsConfiguration('quotadeck.budgets') ||
            e.affectsConfiguration('quotadeck.customProviders')
          ) {
            unchangedStreak = 0;
            currentPollDelayMs = config.pollingIntervalSeconds * 1000;
            void refreshAll(false, true);
          } else {
            void historyStore.readRecent(100).then((history) => {
              dashboard.update(latestSnapshots, history, config);
            });
          }
        }, 150);
      }
    })
  );

  void refreshAll(true, true);
}

export function deactivate(): void {
  // All subscriptions and timers are disposed via context.subscriptions
}
