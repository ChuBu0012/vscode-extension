import * as vscode from 'vscode';
import { readMonitorConfig } from '../config';
import { SecretStore, providerSecretKey } from '../secrets';
import { HistoryStore } from '../storage/historyStore';
import { ProviderSnapshot, QuotaProvider } from '../types';
import { DashboardPanel } from '../ui/dashboardPanel';
import { StatusBarController } from '../ui/statusBar';

export const LOCAL_PROVIDER_IDS = new Set(['agy', 'claude', 'codex']);

export const LOCAL_PROVIDER_META: Record<string, { label: string; description: string }> = {
  agy: { label: 'Antigravity', description: 'Local CLI · Re-check agy /usage' },
  claude: { label: 'Claude Code', description: 'Local OAuth · Re-check Keychain / .credentials.json' },
  codex: { label: 'Codex', description: 'Local OAuth · Re-check ~/.codex/auth.json' },
};

export const KEY_PROVIDER_LABELS: Record<string, { label: string; prompt: string }> = {
  openrouter: { label: 'OpenRouter', prompt: 'Enter your OpenRouter API key' },
  deepseek: { label: 'DeepSeek', prompt: 'Enter your DeepSeek API key' },
  cline: { label: 'Cline', prompt: 'Enter your Cline API / session token' },
};

export interface OnboardingDependencies {
  providers: QuotaProvider[];
  secretStore: SecretStore;
  historyStore: HistoryStore;
  statusBar: StatusBarController;
  dashboard: DashboardPanel;
  output: vscode.OutputChannel;
  skippedLocalProviderIds: Set<string>;
  getLatestSnapshots: () => ProviderSnapshot[];
  setLatestSnapshots: (snapshots: ProviderSnapshot[]) => void;
  refreshAll: (recordHistory: boolean, isManual?: boolean) => Promise<void>;
}

export function createProviderOnboardingFlows(deps: OnboardingDependencies) {
  const {
    providers,
    secretStore,
    historyStore,
    statusBar,
    dashboard,
    output,
    skippedLocalProviderIds,
    getLatestSnapshots,
    setLatestSnapshots,
    refreshAll,
  } = deps;

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
    const current = getLatestSnapshots();
    const nextSnapshots = current.some((s) => s.id === providerId)
      ? current.map((s) => (s.id === providerId ? snap : s))
      : [...current, snap];
    setLatestSnapshots(nextSnapshots);
    statusBar.update(nextSnapshots, config);
    const history = await historyStore.readRecent(100);
    dashboard.update(nextSnapshots, history, config);

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

    const latest = getLatestSnapshots();
    const localEntries = Array.from(LOCAL_PROVIDER_IDS).map((id) => {
      const meta = LOCAL_PROVIDER_META[id];
      const existing = latest.find((s) => s.id === id);
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

  return {
    removeCustomProviderFlow,
    connectProviderFlow,
    disconnectProviderFlow,
  };
}
