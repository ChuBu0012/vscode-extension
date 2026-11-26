import { afterEach, describe, expect, it, mock } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
const configStore: Record<string, unknown> = { pollingIntervalSeconds: 300 };

let lastCreatedStatusBarItem: {
  text: string;
  tooltip: unknown;
  backgroundColor: unknown;
  command: string | undefined;
  shown: boolean;
  disposed: boolean;
  show: () => void;
  dispose: () => void;
} | null = null;

let lastCreatedPanel: {
  viewType: string;
  title: string;
  options: unknown;
  disposed: boolean;
  postedMessages: unknown[];
  messageHandlers: Array<(msg: unknown) => unknown>;
  disposeHandlers: Array<() => void>;
  webview: {
    html: string;
    cspSource: string;
    postMessage: (msg: unknown) => Promise<boolean>;
    onDidReceiveMessage: (cb: (msg: unknown) => unknown) => { dispose: () => void };
  };
  onDidDispose: (cb: () => void) => { dispose: () => void };
  reveal: () => void;
  dispose: () => void;
} | null = null;

class MockMarkdownString {
  value = '';
  isTrusted: boolean | { enabledCommands: string[] } = false;
  constructor(initial?: string, public supportThemeIcons?: boolean) {
    if (initial) this.value = initial;
  }
  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }
}

class MockThemeColor {
  constructor(public readonly id: string) {}
}

mock.module('vscode', () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { One: 1 },
  ThemeColor: MockThemeColor,
  MarkdownString: MockMarkdownString,
  Uri: {
    joinPath: (base: { fsPath?: string }, ...parts: string[]) => {
      const joined = path.join(base?.fsPath ?? '', ...parts);
      return { fsPath: joined, toString: () => joined };
    },
  },
  commands: {
    registerCommand: (id: string, cb: (...args: unknown[]) => unknown) => {
      registeredCommands.set(id, cb);
      return { dispose: () => registeredCommands.delete(id) };
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: <T>(key: string, defaultVal: T): T => (configStore[key] as T | undefined) ?? defaultVal,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
  },
  window: {
    state: { focused: true },
    onDidChangeWindowState: () => ({ dispose: () => {} }),
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
    createStatusBarItem: () => {
      lastCreatedStatusBarItem = {
        text: '',
        tooltip: '',
        backgroundColor: undefined,
        command: undefined,
        shown: false,
        disposed: false,
        show() {
          this.shown = true;
        },
        dispose() {
          this.disposed = true;
        },
      };
      return lastCreatedStatusBarItem;
    },
    createWebviewPanel: (viewType: string, title: string, _col: unknown, options: unknown) => {
      const panel = {
        viewType,
        title,
        options,
        disposed: false,
        postedMessages: [] as unknown[],
        messageHandlers: [] as Array<(msg: unknown) => unknown>,
        disposeHandlers: [] as Array<() => void>,
        webview: {
          html: '',
          cspSource: 'vscode-webview://test',
          postMessage: async (msg: unknown) => {
            panel.postedMessages.push(msg);
            return true;
          },
          onDidReceiveMessage: (cb: (msg: unknown) => unknown) => {
            panel.messageHandlers.push(cb);
            return { dispose: () => {} };
          },
        },
        onDidDispose: (cb: () => void) => {
          panel.disposeHandlers.push(cb);
          return { dispose: () => {} };
        },
        reveal: () => {},
        dispose: () => {
          panel.disposed = true;
          for (const h of panel.disposeHandlers) h();
        },
      };
      lastCreatedPanel = panel;
      return panel;
    },
  },
}));

const { activate, deactivate } = await import('../src/extension');
const { DashboardPanel } = await import('../src/ui/dashboardPanel');
const { StatusBarController } = await import('../src/ui/statusBar');
import type { MonitorConfig, ProviderSnapshot } from '../src/types';

function createMockDom(html: string) {
  const idMatches = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const elements = new Map<string, MockElement>();

  class MockClassList {
    private set = new Set<string>();
    add(...cls: string[]) { for (const c of cls) this.set.add(c); }
    remove(...cls: string[]) { for (const c of cls) this.set.delete(c); }
    toggle(c: string, force?: boolean) {
      if (force === true) { this.set.add(c); return true; }
      if (force === false) { this.set.delete(c); return false; }
      if (this.set.has(c)) { this.set.delete(c); return false; }
      this.set.add(c);
      return true;
    }
    contains(c: string) { return this.set.has(c); }
  }

  class MockElement {
    id: string;
    textContent = '';
    private _innerHTML = '';
    value = '';
    disabled = false;
    classList = new MockClassList();
    listeners = new Map<string, Array<(ev?: unknown) => void>>();
    attrs = new Map<string, string>();
    private parsedChildren: MockElement[] = [];

    constructor(id: string) { this.id = id; }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(val: string) {
      this._innerHTML = val;
      this.parsedChildren = [];
      const tagRegex = /<[a-zA-Z0-9-]+([^>]*)>/g;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(val)) !== null) {
        const attrStr = match[1];
        const child = new MockElement('');
        const attrRegex = /([a-zA-Z0-9-:]+)="([^"]*)"/g;
        let am: RegExpExecArray | null;
        while ((am = attrRegex.exec(attrStr)) !== null) {
          const [, k, v] = am;
          child.attrs.set(k, v);
          if (k === 'id') {
            child.id = v;
            elements.set(v, child);
          } else if (k === 'class') {
            for (const c of v.split(/\s+/).filter(Boolean)) child.classList.add(c);
          }
        }
        this.parsedChildren.push(child);
      }
    }

    addEventListener(type: string, cb: (ev?: unknown) => void) {
      const arr = this.listeners.get(type) ?? [];
      arr.push(cb);
      this.listeners.set(type, arr);
    }
    dispatch(type: string, ev?: unknown) {
      for (const cb of this.listeners.get(type) ?? []) cb(ev);
    }
    getAttribute(k: string) { return this.attrs.get(k) ?? null; }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); }
    querySelectorAll(sel: string): MockElement[] {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return this.parsedChildren.filter((c) => c.classList.contains(cls));
      }
      const attrMatch = /^\[([a-zA-Z0-9-:]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (attrMatch) {
        const [, attr, val] = attrMatch;
        return this.parsedChildren.filter((c) => {
          const got = c.getAttribute(attr);
          return val !== undefined ? got === val : got !== null;
        });
      }
      return [];
    }
  }

  for (const id of idMatches) elements.set(id, new MockElement(id));
  const chartAreaEl = new MockElement('__chartArea');
  const queryMap = new Map<string, MockElement[]>([
    ['.range-tab', [new MockElement('r1'), new MockElement('r2'), new MockElement('r3')]],
    ['.chart-area', [chartAreaEl]],
  ]);

  const windowListeners = new Map<string, Array<(ev: unknown) => void>>();
  let webviewState: Record<string, unknown> = {};
  const sentMessages: unknown[] = [];

  const mockDocument = {
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, new MockElement(id));
      return elements.get(id)!;
    },
    querySelectorAll: (sel: string) => queryMap.get(sel) ?? [],
    querySelector: (sel: string) => (queryMap.get(sel) ?? [])[0] ?? null,
  };

  const mockWindow = {
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      const arr = windowListeners.get(type) ?? [];
      arr.push(cb);
      windowListeners.set(type, arr);
    },
    dispatchMessage: (data: unknown) => {
      for (const cb of windowListeners.get('message') ?? []) cb({ data });
    },
  };

  const acquireVsCodeApi = () => ({
    getState: () => webviewState,
    setState: (s: Record<string, unknown>) => { webviewState = s; },
    postMessage: (m: unknown) => { sentMessages.push(m); },
  });

  const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('Inline script not found');
  new Function('document', 'window', 'acquireVsCodeApi', scriptMatch[1])(mockDocument, mockWindow, acquireVsCodeApi);

  return { elements, mockWindow, sentMessages, getWebviewState: () => webviewState };
}

const sampleSnapshots: ProviderSnapshot[] = [
  {
    id: 'agy',
    shortCode: 'AG',
    name: 'Antigravity',
    status: 'live',
    sourceKind: 'Exact',
    pools: [
      {
        id: 'agy-gemini',
        name: 'Gemini Models',
        remainingPct: 93,
        weeklyPct: 57,
        weeklyReset: '2026-12-01 23:48 +07',
        fiveHourPct: 93,
        fiveHourReset: '2026-11-26 14:39 +07',
      },
      {
        id: 'agy-claude',
        name: 'Claude and GPT models',
        remainingPct: 100,
        weeklyPct: 49,
        weeklyReset: '2026-12-02 15:45 +07',
        fiveHourPct: 100,
        fiveHourReset: '2026-11-26 14:41 +07',
      },
    ],
  },
  { id: 'claude', shortCode: 'CL', name: 'Claude Code', status: 'coming_soon', sourceKind: 'Coming soon', pools: [] },
  { id: 'codex', shortCode: 'CX', name: 'Codex', status: 'coming_soon', sourceKind: 'Coming soon', pools: [] },
];

const sampleConfig: MonitorConfig = {
  pollingIntervalSeconds: 300,
  displayMode: 'remaining',
  statusBarProviders: ['agy-gemini', 'claude', 'codex'],
};

describe('StatusBarController & DashboardPanel & extension.ts', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    registeredCommands.clear();
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('StatusBarController shows 5h Gemini + Claude quotas, friendly warning colors, loading spinner, and tooltip', () => {
    const sb = new StatusBarController();
    sb.update([]);
    expect(lastCreatedStatusBarItem?.text).toBe('$(pulse) AI: --');

    sb.update(sampleSnapshots);
    expect(lastCreatedStatusBarItem?.text).toBe('$(pulse) AGY: G 93%');
    expect(lastCreatedStatusBarItem?.backgroundColor).toBeUndefined();

    sb.setLoading(true);
    expect(lastCreatedStatusBarItem?.text).toBe('$(sync~spin) AGY: G 93%');
    sb.setLoading(false);
    expect(lastCreatedStatusBarItem?.text).toBe('$(pulse) AGY: G 93%');

    const md = lastCreatedStatusBarItem?.tooltip as MockMarkdownString;
    expect(md.value).toContain('AI Usage');
    expect(md.value).toContain('Gemini Models');
    expect(md.value).toContain('**93% left**');
    expect(md.value).toContain('57%');
    expect(md.value).not.toContain('Claude and GPT models');
    expect(md.value).toContain('████████████'.slice(0, Math.round(93 / 100 * 12)));
    expect(md.value).not.toContain('Coming soon');
    expect(md.value).toContain('command:quotadeck.refresh');

    // Shows AGY + CL + CX in remaining mode and respects 'used' mode + statusBarProviders filter
    const allLive: ProviderSnapshot[] = [
      sampleSnapshots[0],
      {
        id: 'claude',
        shortCode: 'CL',
        name: 'Claude Code',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'claude-main', name: 'Claude (Pro)', remainingPct: 55, fiveHourPct: 55, weeklyPct: 20 }],
      },
      {
        id: 'codex',
        shortCode: 'CX',
        name: 'Codex',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'codex-main', name: 'Codex (Free)', remainingPct: 0, fiveHourPct: 0 }],
      },
    ];

    sb.update(allLive, { ...sampleConfig, displayMode: 'remaining', statusBarProviders: ['agy-gemini', 'claude', 'codex'] });
    expect(lastCreatedStatusBarItem?.text).toBe('$(warning) AGY: G 93% | CL 55% | CX 0%');

    // Hiding codex from statusBarProviders removes CX and clears warning color
    sb.update(allLive, { ...sampleConfig, displayMode: 'used', statusBarProviders: ['agy-gemini', 'claude'] });
    expect(lastCreatedStatusBarItem?.text).toBe('$(pulse) AGY: G 7% | CL 45% (used)');
    expect(lastCreatedStatusBarItem?.backgroundColor).toBeUndefined();

    const mdBoth = lastCreatedStatusBarItem?.tooltip as MockMarkdownString;
    expect(mdBoth.value).toContain('Claude Code');
    expect(mdBoth.value).toContain('45% used');
    expect(mdBoth.value).toContain('Codex');

    // Claude at 0% must NOT turn status bar red/warning when Gemini is healthy
    sb.update([
      {
        ...sampleSnapshots[0],
        pools: [
          { id: 'agy-gemini', name: 'Gemini Models', remainingPct: 70, fiveHourPct: 70, weeklyPct: 51 },
          { id: 'agy-claude', name: 'Claude and GPT models', remainingPct: 0, fiveHourPct: 0, weeklyPct: 0 },
        ],
      },
    ]);
    expect(lastCreatedStatusBarItem?.text).toBe('$(pulse) AGY: G 70%');
    expect(lastCreatedStatusBarItem?.backgroundColor).toBeUndefined();

    // Friendly warning background <= 20%
    sb.update([
      {
        ...sampleSnapshots[0],
        pools: [{ id: 'agy-gemini', name: 'Gemini Models', remainingPct: 15, fiveHourPct: 15, weeklyPct: 50 }],
      },
    ]);
    expect(lastCreatedStatusBarItem?.text).toBe('$(warning) AGY: G 15%');
    expect((lastCreatedStatusBarItem?.backgroundColor as MockThemeColor)?.id).toBe('statusBarItem.warningBackground');

    // Friendly warning background at 0% (no harsh error red)
    sb.update([
      {
        ...sampleSnapshots[0],
        pools: [{ id: 'agy-gemini', name: 'Gemini Models', remainingPct: 0, fiveHourPct: 0, weeklyPct: 50 }],
      },
    ]);
    expect(lastCreatedStatusBarItem?.text).toBe('$(warning) AGY: G 0%');
    expect((lastCreatedStatusBarItem?.backgroundColor as MockThemeColor)?.id).toBe('statusBarItem.warningBackground');

    // Includes agy-claude in tooltip when explicitly enabled, and shows hidden note when none pinned
    sb.update(allLive, { ...sampleConfig, statusBarProviders: ['agy-gemini', 'agy-claude'] });
    expect(lastCreatedStatusBarItem?.text).toBe('$(pulse) AGY: G 93% | AGY-C 100%');
    expect((lastCreatedStatusBarItem?.tooltip as MockMarkdownString).value).toContain('Claude and GPT models');

    sb.update(allLive, { ...sampleConfig, statusBarProviders: [] });
    expect(lastCreatedStatusBarItem?.text).toBe('$(pulse) AI: --');
    expect((lastCreatedStatusBarItem?.tooltip as MockMarkdownString).value).toContain('hidden from the Status Bar');

    sb.dispose();
    expect(lastCreatedStatusBarItem?.disposed).toBe(true);
  });

  it('DashboardPanel renders Antigravity Weekly & 5h limits and Coming soon providers', async () => {
    let refreshed = false;
    let cleared = false;
    const panel = new DashboardPanel({
      onRefresh: async () => { refreshed = true; },
      onClearHistory: async () => { cleared = true; },
    });
    panel.show(sampleSnapshots, [], sampleConfig);

    expect(lastCreatedPanel!.webview.html).toContain("default-src 'none'");
    const dom = createMockDom(lastCreatedPanel!.webview.html);

    dom.mockWindow.dispatchMessage({
      command: 'state',
      payload: {
        snapshots: sampleSnapshots,
        history: [{ timestamp: new Date().toISOString(), providers: [{ id: 'agy', remainingPct: 53, usedTokens: 0 }] }],
        config: sampleConfig,
        summary: {
          liveCount: 1,
          totalCount: 3,
          lowestPct: 49,
          lowestLabel: 'Claude and GPT models',
          fiveHourSummary: '93% / 100%',
        },
        updatedAt: '09:45:00',
      },
    });

    expect(dom.elements.has('kpiGlance')).toBe(false);
    expect(dom.elements.has('sideToggleBtn')).toBe(false);
    expect(dom.elements.has('statusBarToggles')).toBe(false);
    expect(dom.elements.get('providerFilterTabs')!.innerHTML).toContain('Claude Code');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Antigravity');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('2026-12-01 23:48 +07');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Claude Code');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Coming soon');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('data-sb-toggle="agy-gemini"');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('aria-checked="true"');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('aria-checked="false"');
    expect(dom.elements.get('historyMeta')!.textContent).toBe('1 snapshots');

    // List / Grid layout toggle works and persists in webview state
    expect(dom.elements.get('quotaBreakdown')!.classList.contains('grid-layout')).toBe(false);
    expect(dom.elements.get('mainShell')!.classList.contains('grid-mode')).toBe(false);
    dom.elements.get('layoutGridBtn')!.dispatch('click');
    expect(dom.elements.get('quotaBreakdown')!.classList.contains('grid-layout')).toBe(true);
    expect(dom.elements.get('mainShell')!.classList.contains('grid-mode')).toBe(true);
    expect(dom.elements.get('layoutGridBtn')!.classList.contains('active')).toBe(true);
    expect(dom.elements.get('layoutListBtn')!.classList.contains('active')).toBe(false);
    expect(dom.getWebviewState().limitsLayout).toBe('grid');
    dom.elements.get('layoutListBtn')!.dispatch('click');
    expect(dom.elements.get('quotaBreakdown')!.classList.contains('grid-layout')).toBe(false);
    expect(dom.elements.get('mainShell')!.classList.contains('grid-mode')).toBe(false);
    expect(dom.getWebviewState().limitsLayout).toBe('list');

    // History stats are collapsed by default; clicking historyToggleBtn expands them
    expect(dom.elements.get('historyBody')!.classList.contains('collapsed')).toBe(false);
    dom.elements.get('historyToggleBtn')!.dispatch('click');
    expect(dom.elements.get('historyBody')!.classList.contains('collapsed')).toBe(true);

    dom.elements.get('refreshBtn')!.dispatch('click');
    expect(dom.sentMessages).toContainEqual({ command: 'refresh' });
    dom.elements.get('modeUsedBtn')!.dispatch('click');
    expect(dom.sentMessages).toContainEqual({ command: 'updateConfig', key: 'displayMode', value: 'used' });

    for (const h of lastCreatedPanel!.messageHandlers) {
      await h({ command: 'refresh' });
      await h({ command: 'clearHistory' });
    }
    expect(refreshed).toBe(true);
    expect(cleared).toBe(true);

    panel.dispose();
    expect(lastCreatedPanel!.disposed).toBe(true);
  });

  it('DashboardPanel shows loading state for Add Agent and Disconnect and resets on actionDone', async () => {
    const panel = new DashboardPanel({
      onRefresh: async () => {},
      onClearHistory: async () => {},
      onConnectProvider: async () => {},
      onDisconnectProvider: async () => {},
    });

    const connectedSnaps: ProviderSnapshot[] = [
      {
        id: 'openrouter',
        shortCode: 'OR',
        name: 'OpenRouter',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'openrouter-main', name: 'OpenRouter Credits', remainingPct: 75, balanceAmount: 15 }],
      },
    ];

    panel.show(connectedSnaps, [], sampleConfig);
    const dom = createMockDom(lastCreatedPanel!.webview.html);
    dom.mockWindow.dispatchMessage({
      command: 'state',
      payload: {
        snapshots: connectedSnaps,
        history: [],
        config: sampleConfig,
        summary: { liveCount: 1, totalCount: 1, lowestPct: 75, lowestLabel: 'OpenRouter Credits' },
        updatedAt: '15:15:00',
      },
    });

    const addBtn = dom.elements.get('addAgentBtn')!;
    addBtn.dispatch('click');
    expect(addBtn.disabled).toBe(true);
    expect(dom.elements.get('addAgentBtnLabel')!.textContent).toBe('Adding...');
    expect(dom.elements.get('actionNotice')!.textContent).toContain('Opening Add Agent prompt');

    dom.mockWindow.dispatchMessage({ command: 'actionDone' });
    expect(addBtn.disabled).toBe(false);
    expect(dom.elements.get('addAgentBtnLabel')!.textContent).toBe('Add Agent');
    expect(dom.elements.get('actionNotice')!.textContent).toBe('');

    const disconnectBtn = dom.elements.get('quotaBreakdown')!.querySelectorAll('[data-disconnect-provider="openrouter"]')[0];
    expect(disconnectBtn).toBeTruthy();
    disconnectBtn.dispatch('click');
    expect(disconnectBtn.disabled).toBe(true);
    expect(disconnectBtn.textContent).toBe('Disconnecting...');
    expect(dom.sentMessages).toContainEqual({ command: 'disconnectProvider', providerId: 'openrouter' });

    dom.mockWindow.dispatchMessage({ command: 'actionDone', notice: 'Codex not found — Sign in to Codex' });
    expect(dom.elements.get('actionNotice')!.textContent).toContain('Codex not found');
    const resetDisconnectBtn = dom.elements.get('quotaBreakdown')!.querySelectorAll('[data-disconnect-provider="openrouter"]')[0];
    expect(resetDisconnectBtn.textContent).not.toBe('Disconnecting...');

    panel.dispose();
  });

  it('DashboardPanel supports sorting, status filters, search, inline status bar toggle, and used-mode history', async () => {
    const panel = new DashboardPanel({
      onRefresh: async () => {},
      onClearHistory: async () => {},
    });

    const multiSnapshots: ProviderSnapshot[] = [
      sampleSnapshots[0],
      {
        id: 'claude',
        shortCode: 'CL',
        name: 'Claude Code',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'claude-main', name: 'Claude (Pro)', remainingPct: 55, fiveHourPct: 55, weeklyPct: 80, fiveHourReset: '2026-11-26T06:00:00Z' }],
      },
      {
        id: 'codex',
        shortCode: 'CX',
        name: 'Codex',
        status: 'live',
        sourceKind: 'Exact',
        pools: [{ id: 'codex-main', name: 'Codex (Free)', remainingPct: 10, fiveHourPct: 10, fiveHourReset: '2026-11-26T05:50:00Z' }],
      },
    ];

    panel.show(multiSnapshots, [], { ...sampleConfig, displayMode: 'used', statusBarProviders: ['agy-gemini', 'claude'] });
    const dom = createMockDom(lastCreatedPanel!.webview.html);

    dom.mockWindow.dispatchMessage({
      command: 'state',
      payload: {
        snapshots: multiSnapshots.map((s) => ({
          ...s,
          pools: s.pools.map((p) => ({
            ...p,
            nextResetMs: p.id === 'codex-main' ? 1000 : p.id === 'claude-main' ? 2000 : 3000,
            nextResetLabel: p.id === 'codex-main' ? 'in 10m · 12:50' : 'in 1h · 13:40',
          })),
        })),
        history: [
          {
            timestamp: new Date().toISOString(),
            providers: [
              { id: 'agy', remainingPct: 80, usedTokens: 0 },
              { id: 'claude', remainingPct: 60, usedTokens: 0 },
            ],
          },
        ],
        config: { ...sampleConfig, displayMode: 'used', statusBarProviders: ['agy-gemini', 'claude'] },
        summary: { liveCount: 3, totalCount: 3, lowestPct: 10, lowestLabel: 'Codex (Free)' },
        updatedAt: '12:40:00',
      },
    });

    // History bars respect 'used' mode (100 - avg(80, 60) = 30% used)
    const barCols = dom.elements.get('barsRow')!.querySelectorAll('.bar-col');
    expect(barCols.length).toBe(1);
    barCols[0].dispatch('mouseenter');
    expect(dom.elements.get('popPct')!.textContent).toBe('30% used');
    expect(dom.elements.get('popDetail')!.textContent).toContain('AG: 20%');

    // Inline Status Bar switch toggles agy-claude on
    const agyClaudeSwitch = dom.elements.get('quotaBreakdown')!.querySelectorAll('[data-sb-toggle="agy-claude"]')[0];
    expect(agyClaudeSwitch).toBeDefined();
    agyClaudeSwitch.dispatch('click');
    expect(dom.sentMessages).toContainEqual({
      command: 'updateConfig',
      key: 'statusBarProviders',
      value: ['agy-gemini', 'claude', 'agy-claude'],
    });

    // Sort by lowest remaining (tightest first) orders Codex (10%) -> Claude (55%) -> Gemini (93%) -> Claude & GPT (100%)
    const sortSelect = dom.elements.get('limitSortSelect')!;
    sortSelect.value = 'lowest';
    sortSelect.dispatch('change');
    const sortedHtml = dom.elements.get('quotaBreakdown')!.innerHTML;
    expect(sortedHtml.indexOf('Codex (Free)')).toBeLessThan(sortedHtml.indexOf('Claude (Pro)'));
    expect(sortedHtml.indexOf('Claude (Pro)')).toBeLessThan(sortedHtml.indexOf('Gemini Models'));
    expect(sortedHtml.indexOf('Gemini Models')).toBeLessThan(sortedHtml.indexOf('Claude and GPT models'));

    // Sort by highest remaining orders Claude & GPT (100%) -> Gemini (93%) -> Claude (55%) -> Codex (10%)
    sortSelect.value = 'highest';
    sortSelect.dispatch('change');
    const highestHtml = dom.elements.get('quotaBreakdown')!.innerHTML;
    expect(highestHtml.indexOf('Claude and GPT models')).toBeLessThan(highestHtml.indexOf('Gemini Models'));
    expect(highestHtml.indexOf('Gemini Models')).toBeLessThan(highestHtml.indexOf('Codex (Free)'));

    // Status filter 'pinned' hides agy-gemini? No, keeps pinned pools (agy-gemini, claude, agy-claude) and hides codex
    const pinnedChip = dom.elements.get('statusFilterChips')!.querySelectorAll('[data-status-filter="pinned"]')[0];
    pinnedChip.dispatch('click');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Gemini Models');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).not.toContain('Codex (Free)');

    // Status filter 'low' shows only Codex (10% remaining), and switching to Antigravity tab produces empty state -> Reset Filters restores all
    const lowChip = dom.elements.get('statusFilterChips')!.querySelectorAll('[data-status-filter="low"]')[0];
    lowChip.dispatch('click');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Codex (Free)');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).not.toContain('Gemini Models');

    const agyTab = dom.elements.get('providerFilterTabs')!.querySelectorAll('[data-provider="agy"]')[0];
    agyTab.dispatch('click');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('No providers or pools match');
    dom.elements.get('resetFiltersBtn')!.dispatch('click');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Gemini Models');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Codex (Free)');

    // Clicking Claude Code provider tab filters to Claude Code only
    const claudeTab = dom.elements.get('providerFilterTabs')!.querySelectorAll('[data-provider="claude"]')[0];
    claudeTab.dispatch('click');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('Claude (Pro)');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).not.toContain('Codex (Free)');

    // Balance-only provider & not_connected provider render cleanly with Connect / Status Bar balance
    dom.mockWindow.dispatchMessage({
      command: 'state',
      payload: {
        snapshots: [
          {
            id: 'deepseek',
            shortCode: 'DS',
            name: 'DeepSeek',
            status: 'live',
            sourceKind: 'Exact',
            pools: [{ id: 'deepseek-main', name: 'DeepSeek Balance', balanceAmount: 10.5, balanceCurrency: 'USD' }],
          },
          {
            id: 'openrouter',
            shortCode: 'OR',
            name: 'OpenRouter',
            status: 'not_connected',
            sourceKind: 'Not connected',
            requiresConnect: true,
            pools: [],
            note: 'Connect your OpenRouter API key to track credits',
          },
        ],
        history: [],
        config: { ...sampleConfig, displayMode: 'remaining', statusBarProviders: ['deepseek'] },
        summary: { liveCount: 1, totalCount: 2 },
        updatedAt: '14:45:00',
      },
    });
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).toContain('$10.50');
    expect(dom.elements.get('quotaBreakdown')!.innerHTML).not.toContain('OpenRouter');
    expect(dom.elements.get('providerFilterTabs')!.innerHTML).not.toContain('OpenRouter');
    dom.elements.get('addAgentBtn')!.dispatch('click');
    expect(dom.sentMessages).toContainEqual({ command: 'connectProvider' });

    panel.dispose();
  });

  it('extension activate() wires commands and disposes cleanly', async () => {
    const tmpStorage = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-usage-ext-'));
    tempDirs.push(tmpStorage);
    const subscriptions: Array<{ dispose: () => void }> = [];

    activate({
      subscriptions,
      globalStorageUri: { fsPath: tmpStorage, toString: () => tmpStorage },
      extensionUri: { fsPath: tmpStorage, toString: () => tmpStorage },
      secrets: {
        get: async () => undefined,
        store: async () => {},
        delete: async () => {},
        onDidChange: () => ({ dispose: () => {} }),
      },
    } as never);

    expect(registeredCommands.has('quotadeck.openDashboard')).toBe(true);
    expect(registeredCommands.has('quotadeck.refresh')).toBe(true);
    expect(registeredCommands.has('quotadeck.connectProvider')).toBe(true);
    expect(registeredCommands.has('quotadeck.disconnectProvider')).toBe(true);

    await registeredCommands.get('quotadeck.openDashboard')!();
    expect(lastCreatedPanel).not.toBeNull();

    for (const sub of subscriptions) sub.dispose();
    deactivate();
    expect(lastCreatedPanel!.disposed).toBe(true);
  }, 15000);
});
