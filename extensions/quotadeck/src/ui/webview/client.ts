interface VsCodeApi {
  postMessage: (msg: unknown) => void;
  getState: () => ViewState | undefined;
  setState: (state: ViewState) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface ViewState {
  providerFilter?: string;
  limitsLayout?: 'list' | 'grid';
  historyProvider?: string;
  historyWindow?: 'all' | '5h' | 'weekly';
  historyOpen?: boolean;
}

interface PacingPayload {
  window: '5h' | 'weekly';
  level: 'on_pace' | 'moderate' | 'fast';
  ratio: number;
  label: string;
  detail: string;
}

interface PoolPayload {
  id: string;
  name: string;
  remainingPct?: number;
  fiveHourPct?: number;
  fiveHourReset?: string;
  fiveHourResetLabel?: string;
  weeklyPct?: number;
  weeklyReset?: string;
  weeklyResetLabel?: string;
  nextResetMs?: number | null;
  nextResetLabel?: string;
  balanceAmount?: number;
  balanceCurrency?: string;
  budgetCapAmount?: number;
  pacing?: PacingPayload | null;
}

interface SnapshotPayload {
  id: string;
  shortCode: string;
  name: string;
  status: string;
  sourceKind: string;
  note?: string;
  requiresConnect?: boolean;
  pools: PoolPayload[];
}

interface HistoryPoolPayload {
  id: string;
  name?: string;
  remainingPct?: number;
  fiveHourPct?: number;
  weeklyPct?: number;
  balanceAmount?: number;
  balanceCurrency?: string;
}

interface HistoryEntryPayload {
  timestamp: string;
  providers: Array<{
    id: string;
    remainingPct: number;
    usedTokens: number;
    balanceAmount?: number;
    balanceCurrency?: string;
    pools?: HistoryPoolPayload[];
  }>;
}

interface PollStatusPayload {
  mode: 'active' | 'auto' | 'idle' | 'fixed';
  intervalSeconds: number;
  baseSeconds: number;
  smartEnabled: boolean;
  activeRemainingCooldown: number;
}

interface DashboardStatePayload {
  snapshots: SnapshotPayload[];
  history: HistoryEntryPayload[];
  config: {
    displayMode?: 'remaining' | 'used';
    pollingIntervalSeconds?: number;
    smartPolling?: boolean;
    statusBarProviders?: string[];
    lowThresholdPct?: number;
    lowBalanceUsd?: number;
  };
  pollStatus?: PollStatusPayload;
  updatedAt: string;
}

interface PendingAction {
  type: 'add' | 'connect' | 'disconnect' | 'remove';
  providerId?: string;
}

const vscode = acquireVsCodeApi();
let lastPayload: DashboardStatePayload | null = null;
let currentRange = '24H';
let activeProviderFilter = 'all';
let limitsLayout: 'list' | 'grid' = 'list';
let historyProviderFilter = 'all';
let historyWindowFilter: 'all' | '5h' | 'weekly' = 'all';

function esc(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function saveViewState(patch: Partial<ViewState>): void {
  vscode.setState({ ...(vscode.getState() || {}), ...patch });
}

const savedState = vscode.getState() || {};
if (savedState.providerFilter) activeProviderFilter = savedState.providerFilter;
if (savedState.limitsLayout === 'grid' || savedState.limitsLayout === 'list') {
  limitsLayout = savedState.limitsLayout;
}
if (savedState.historyProvider) historyProviderFilter = savedState.historyProvider;
if (savedState.historyWindow === '5h' || savedState.historyWindow === 'weekly' || savedState.historyWindow === 'all') {
  historyWindowFilter = savedState.historyWindow;
}

const applyLimitsLayout = (layout: string): void => {
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

const formatShortInterval = (sec: number): string => {
  if (!Number.isFinite(sec) || sec <= 0) return '5m';
  return sec >= 60 ? Math.round(sec / 60) + 'm' : sec + 's';
};

const pollIntervalSelect = document.getElementById('pollIntervalSelect') as HTMLSelectElement | null;
if (pollIntervalSelect) {
  pollIntervalSelect.addEventListener('change', () => {
    const val = Number(pollIntervalSelect.value);
    if (!Number.isFinite(val) || val < 30) return;
    if (lastPayload) {
      lastPayload.config = { ...(lastPayload.config || {}), pollingIntervalSeconds: val };
    }
    vscode.postMessage({ command: 'updateConfig', key: 'pollingIntervalSeconds', value: val });
  });
}

const smartPollBtn = document.getElementById('smartPollBtn');
if (smartPollBtn) {
  smartPollBtn.addEventListener('click', () => {
    const currentSmart = lastPayload?.config?.smartPolling !== false;
    const nextSmart = !currentSmart;
    if (lastPayload) {
      lastPayload.config = { ...(lastPayload.config || {}), smartPolling: nextSmart };
    }
    vscode.postMessage({ command: 'updateConfig', key: 'smartPolling', value: nextSmart });
    renderAll();
  });
}

const historyProviderSelect = document.getElementById('historyProviderSelect') as HTMLSelectElement | null;
if (historyProviderSelect) {
  historyProviderSelect.addEventListener('change', () => {
    historyProviderFilter = historyProviderSelect.value || 'all';
    saveViewState({ historyProvider: historyProviderFilter });
    if (lastPayload) renderBars(lastPayload.history);
  });
}

const historyWindowSelect = document.getElementById('historyWindowSelect') as HTMLSelectElement | null;
if (historyWindowSelect) {
  historyWindowSelect.value = historyWindowFilter;
  historyWindowSelect.addEventListener('change', () => {
    const val = historyWindowSelect.value;
    historyWindowFilter = val === '5h' || val === 'weekly' ? val : 'all';
    saveViewState({ historyWindow: historyWindowFilter });
    if (lastPayload) renderBars(lastPayload.history);
  });
}

const historyOpenInitial = Boolean(savedState.historyOpen);
if (historyOpenInitial) {
  document.getElementById('historyBody')?.classList.remove('collapsed');
  const toggleBtn = document.getElementById('historyToggleBtn');
  if (toggleBtn) toggleBtn.textContent = 'Hide Graph';
}

const toggleHistorySection = (): void => {
  const body = document.getElementById('historyBody');
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  const toggleBtn = document.getElementById('historyToggleBtn');
  if (toggleBtn) toggleBtn.textContent = collapsed ? 'Open Graph' : 'Hide Graph';
  saveViewState({ historyOpen: !collapsed });
};

document.getElementById('historyToggleBtn')?.addEventListener('click', (ev) => {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  toggleHistorySection();
});
document.getElementById('historyHeaderBar')?.addEventListener('click', toggleHistorySection);

let pendingAction: PendingAction | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

const setActionNotice = (text: string, autoClearMs?: number): void => {
  if (noticeTimer) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  const el = document.getElementById('actionNotice');
  if (el) el.textContent = text ? '· ' + text : '';
  if (text && autoClearMs) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (el) el.textContent = '';
    }, autoClearMs);
  }
};

const setAddAgentVisual = (loading: boolean): void => {
  const btn = document.getElementById('addAgentBtn') as HTMLButtonElement | null;
  const lbl = document.getElementById('addAgentBtnLabel');
  const icon = document.getElementById('addAgentBtnIcon');
  if (btn) btn.disabled = loading;
  if (lbl) lbl.textContent = loading ? 'Adding...' : 'Add Agent';
  if (icon) icon.classList.toggle('spin', loading);
};

const setRefreshVisual = (loading: boolean): void => {
  const lbl = document.getElementById('refreshBtnLabel');
  const btn = document.getElementById('refreshBtn');
  const icon = document.getElementById('refreshBtnIcon');
  if (lbl) lbl.textContent = loading ? 'Refreshing...' : 'Refresh';
  else if (btn) btn.textContent = loading ? 'Refreshing...' : 'Refresh';
  if (icon) icon.classList.toggle('spin', loading);
};

document.getElementById('refreshBtn')?.addEventListener('click', () => {
  setRefreshVisual(true);
  vscode.postMessage({ command: 'refresh' });
});

document.getElementById('addAgentBtn')?.addEventListener('click', () => {
  pendingAction = { type: 'add' };
  setAddAgentVisual(true);
  setActionNotice('Opening Add Agent prompt...');
  vscode.postMessage({ command: 'connectProvider' });
});

document.getElementById('clearHistoryBtn')?.addEventListener('click', (ev) => {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  vscode.postMessage({ command: 'clearHistory' });
});

const modeLeftBtn = document.getElementById('modeLeftBtn');
const modeUsedBtn = document.getElementById('modeUsedBtn');
const setMode = (mode: 'remaining' | 'used'): void => {
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

document.querySelector('.chart-area')?.addEventListener('mouseleave', () => {
  document.getElementById('chartPopover')?.classList.remove('visible');
});

const defaultSbKeys = ['agy-gemini', 'claude', 'codex'];
const getActiveSbSet = (cfg?: DashboardStatePayload['config']): Set<string> =>
  new Set((cfg && Array.isArray(cfg.statusBarProviders)) ? cfg.statusBarProviders : defaultSbKeys);

const getStatusBarKey = (providerId: string, poolId: string): string | null => {
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
};

const getStatusBarTag = (sbKey: string, shortCode?: string): string => {
  if (sbKey === 'agy-gemini') return 'AGY: G';
  if (sbKey === 'agy-claude') return 'AGY-C';
  if (sbKey === 'claude') return 'CL';
  if (sbKey === 'codex') return 'CX';
  if (sbKey === 'openrouter') return 'OR';
  if (sbKey === 'deepseek') return 'DS';
  if (sbKey === 'cline') return 'CN';
  return (shortCode || sbKey).toUpperCase();
};

const formatMoney = (amount?: number, currency?: string): string => {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const cur = (currency || 'USD').toUpperCase();
  const sym = (cur === 'CNY' || cur === 'RMB') ? '¥' : (cur === 'EUR' ? '€' : (cur === 'GBP' ? '£' : '$'));
  return sym + safe.toFixed(2);
};

function getProviderHistoryValue(entry: HistoryEntryPayload['providers'][number], win: 'all' | '5h' | 'weekly'): number | null {
  if (win === '5h') {
    if (!Array.isArray(entry.pools)) return null;
    const vals = entry.pools.map((p) => p.fiveHourPct).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }
  if (win === 'weekly') {
    if (!Array.isArray(entry.pools)) return null;
    const vals = entry.pools.map((p) => p.weeklyPct).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }
  if (Array.isArray(entry.pools)) {
    const hasNumeric = entry.pools.some((p) => typeof p.remainingPct === 'number');
    if (!hasNumeric) return null;
  }
  return typeof entry.remainingPct === 'number' && Number.isFinite(entry.remainingPct) ? entry.remainingPct : null;
}

function renderBars(history: HistoryEntryPayload[]): void {
  const barsEl = document.getElementById('barsRow');
  if (!barsEl) return;
  const isUsedGlobal = Boolean(lastPayload?.config?.displayMode === 'used');
  const unitWord = isUsedGlobal ? 'used' : 'left';
  const hours = currentRange === '24H' ? 24 : currentRange === '7D' ? 168 : 720;
  const cutoff = Date.now() - hours * 3600 * 1000;
  const filtered = history.filter((pt) => {
    const ms = Date.parse(pt.timestamp);
    if (Number.isFinite(ms) && ms < cutoff) return false;
    const relevantEntries = Array.isArray(pt.providers)
      ? (historyProviderFilter === 'all' ? pt.providers : pt.providers.filter((p) => p.id === historyProviderFilter))
      : [];
    if (relevantEntries.length === 0) return false;
    if (historyWindowFilter === 'all') return true;
    return relevantEntries.some((p) => getProviderHistoryValue(p, historyWindowFilter) !== null);
  });

  const maxBars = currentRange === '24H' ? 12 : 14;
  let pts = filtered;
  if (filtered.length > maxBars) {
    const sampled: HistoryEntryPayload[] = [];
    const step = (filtered.length - 1) / (maxBars - 1);
    for (let i = 0; i < maxBars; i++) {
      sampled.push(filtered[Math.round(i * step)]);
    }
    pts = sampled;
  }

  if (pts.length === 0) {
    barsEl.innerHTML = '<div class="pr-sub">No history recorded for this filter.</div>';
    return;
  }

  const nameMap = new Map<string, string>();
  if (lastPayload && Array.isArray(lastPayload.snapshots)) {
    lastPayload.snapshots.forEach((s) => nameMap.set(s.id, s.shortCode || s.name));
  }

  barsEl.innerHTML = pts.map((pt, idx) => {
    const entries = Array.isArray(pt.providers)
      ? (historyProviderFilter === 'all' ? pt.providers : pt.providers.filter((p) => p.id === historyProviderFilter))
      : [];
    const numericVals = entries
      .map((p) => getProviderHistoryValue(p, historyWindowFilter))
      .filter((v): v is number => v !== null);
    const avgRemaining = numericVals.length > 0
      ? Math.round(numericVals.reduce((s, v) => s + v, 0) / numericVals.length)
      : 0;
    const val = numericVals.length > 0 ? (isUsedGlobal ? 100 - avgRemaining : avgRemaining) : 0;
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
      const code = nameMap.get(p.id) || p.id.toUpperCase();
      const winVal = getProviderHistoryValue(p, historyWindowFilter);
      if (winVal !== null) {
        const pv = isUsedGlobal ? 100 - winVal : winVal;
        const balSuffix = typeof p.balanceAmount === 'number'
          ? ' (' + formatMoney(p.balanceAmount, p.balanceCurrency) + ')'
          : '';
        return code + ': ' + pv + '%' + balSuffix;
      }
      if (typeof p.balanceAmount === 'number') {
        return code + ': ' + formatMoney(p.balanceAmount, p.balanceCurrency);
      }
      return '';
    }).filter(Boolean).join(' · ');
    const showAxisLbl = pts.length <= 8 || idx % 2 === 0 || idx === pts.length - 1;
    const pctDisplay = numericVals.length > 0 ? String(val) : '--';

    return '<div class="bar-col" data-idx="' + idx + '" data-pct="' + pctDisplay + '" data-unit="' + unitWord + '" data-time="' + esc(fullTime) + '" data-detail="' + esc(detail) + '">' +
      '<div class="bar-cap"><div class="bar-fill" style="height:' + (numericVals.length > 0 ? Math.max(3, val) : 12) + '%"></div></div>' +
      '<span class="bar-label">' + (showAxisLbl ? esc(axisLbl) : '') + '</span>' +
    '</div>';
  }).join('');

  barsEl.querySelectorAll('.bar-col').forEach((col) => {
    col.addEventListener('mouseenter', () => {
      const popPct = document.getElementById('popPct');
      const popDesc = document.getElementById('popDesc');
      const popDetail = document.getElementById('popDetail');
      const rawPct = col.getAttribute('data-pct') || '--';
      if (popPct) {
        popPct.textContent = rawPct === '--'
          ? 'Balance snapshot'
          : (rawPct + '% ' + (col.getAttribute('data-unit') || 'left'));
      }
      if (popDesc) popDesc.textContent = 'Snapshot at ' + col.getAttribute('data-time');
      if (popDetail) popDetail.textContent = col.getAttribute('data-detail') || '';
      document.getElementById('chartPopover')?.classList.add('visible');
    });
  });
}

function renderAll(): void {
  if (!lastPayload) return;
  const { snapshots, history, config, updatedAt } = lastPayload;
  const isUsedGlobal = Boolean(config && config.displayMode === 'used');
  const fmtVal = (remaining: unknown): number => {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(remaining) || 0)));
    return isUsedGlobal ? 100 - clamped : clamped;
  };
  const activeSb = getActiveSbSet(config);
  const lowPct = typeof config?.lowThresholdPct === 'number' ? config.lowThresholdPct : 20;
  const medPct = Math.min(85, Math.max(lowPct + 10, Math.round(lowPct * 2.5)));
  const lowBal = typeof config?.lowBalanceUsd === 'number' ? config.lowBalanceUsd : 1;

  const visibleSnapshots = snapshots.filter((s) => s.status !== 'not_connected');

  if (activeProviderFilter !== 'all' && !visibleSnapshots.some((s) => s.id === activeProviderFilter)) {
    activeProviderFilter = 'all';
  }
  if (historyProviderFilter !== 'all' && !visibleSnapshots.some((s) => s.id === historyProviderFilter)) {
    historyProviderFilter = 'all';
  }

  const mLeft = document.getElementById('modeLeftBtn');
  const mUsed = document.getElementById('modeUsedBtn');
  if (mLeft && mUsed) {
    mLeft.classList.toggle('active', !isUsedGlobal);
    mUsed.classList.toggle('active', isUsedGlobal);
  }

  setRefreshVisual(false);
  const pollSec = config && typeof config.pollingIntervalSeconds === 'number' ? config.pollingIntervalSeconds : 300;
  const smartEnabled = config?.smartPolling !== false;
  if (pollIntervalSelect) {
    const secStr = String(pollSec);
    if (!['30', '60', '300', '600'].includes(secStr)) {
      const existingCustom = Array.from(pollIntervalSelect.options || []).some((o) => o.value === secStr);
      if (!existingCustom && typeof document.createElement === 'function') {
        const opt = document.createElement('option');
        opt.value = secStr;
        opt.textContent = 'Reload: ' + formatShortInterval(pollSec);
        pollIntervalSelect.appendChild(opt);
      }
    }
    pollIntervalSelect.value = secStr;
  }
  if (smartPollBtn) {
    smartPollBtn.classList.toggle('active', smartEnabled);
    smartPollBtn.setAttribute('aria-pressed', smartEnabled ? 'true' : 'false');
  }

  const ps = lastPayload.pollStatus;
  let pollStr = '';
  let pollTitle = '';
  if (ps) {
    const curLabel = formatShortInterval(ps.intervalSeconds);
    const baseLabel = formatShortInterval(ps.baseSeconds);
    if (ps.mode === 'active') {
      pollStr = ' · Active ' + curLabel + ' (Smart)';
      pollTitle = 'Usage drop detected — checking every ' + curLabel + ' (baseline ' + baseLabel + ', ' + ps.activeRemainingCooldown + ' quiet checks to cooldown)';
    } else if (ps.mode === 'idle') {
      pollStr = ' · Idle ' + curLabel;
      pollTitle = 'Quota unchanged — backed off to ' + curLabel + ' (baseline ' + baseLabel + ')';
    } else if (ps.mode === 'fixed') {
      pollStr = ' · Fixed ' + curLabel;
      pollTitle = 'Smart polling off — fixed reload every ' + curLabel;
    } else {
      pollStr = ' · Auto ' + curLabel;
      pollTitle = 'Auto-reload every ' + baseLabel + ' (Smart mode speeds up to 1m on usage drop)';
    }
  } else {
    const lbl = formatShortInterval(pollSec);
    pollStr = smartEnabled ? (' · Auto ' + lbl) : (' · Fixed ' + lbl);
    pollTitle = smartEnabled ? ('Baseline ' + lbl + ' (Smart auto-detect active)') : ('Fixed reload every ' + lbl);
  }
  const updatedAtEl = document.getElementById('updatedAt');
  const historyMetaEl = document.getElementById('historyMeta');
  if (updatedAtEl) {
    updatedAtEl.textContent = 'Updated ' + updatedAt + pollStr;
    updatedAtEl.setAttribute('title', pollTitle);
  }
  if (historyMetaEl) historyMetaEl.textContent = history.length + ' snapshots';

  const clearBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement | null;
  if (clearBtn) clearBtn.disabled = history.length === 0;

  if (historyProviderSelect) {
    historyProviderSelect.innerHTML = ['<option value="all">All Providers</option>'].concat(
      visibleSnapshots.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
    ).join('');
    historyProviderSelect.value = historyProviderFilter;
  }

  const liveProviders = visibleSnapshots.filter((s) => s.status === 'live' && s.pools.length > 0);
  const allLivePools = liveProviders.flatMap((s) =>
    s.pools.map((pl) => ({ ...pl, providerId: s.id, providerName: s.name, shortCode: s.shortCode }))
  );

  const tabsEl = document.getElementById('providerFilterTabs');
  if (tabsEl) {
    const filterItems = [{ id: 'all', label: 'All (' + visibleSnapshots.length + ')', status: 'all' }].concat(
      visibleSnapshots.map((s) => ({ id: s.id, label: s.name, status: s.status }))
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
  }

  const renderSbSwitch = (sbKey: string | null, pool: PoolPayload, shortCode: string): string => {
    if (!sbKey) return '';
    const isOn = activeSb.has(sbKey);
    const tag = getStatusBarTag(sbKey, shortCode);
    const valStr = typeof pool.remainingPct === 'number'
      ? (fmtVal(pool.remainingPct) + '%')
      : (typeof pool.balanceAmount === 'number' ? formatMoney(pool.balanceAmount, pool.balanceCurrency) : '');
    const tip = isOn
      ? 'Shown in Status Bar as "' + tag + ' ' + valStr + '" (click to hide)'
      : 'Hidden from Status Bar (click to show as "' + tag + '")';
    return '<button type="button" class="sb-switch-btn' + (isOn ? ' active' : '') + '" role="switch" aria-checked="' + (isOn ? 'true' : 'false') + '" aria-label="Show ' + esc(pool.name) + ' in Status Bar" title="' + esc(tip) + '" data-sb-toggle="' + esc(sbKey) + '">' +
      '<span class="sb-switch-label">Bar</span>' +
      '<span class="sb-switch-track"><span class="sb-switch-thumb"></span></span>' +
    '</button>';
  };

  const getQuotaTone = (remainingPct: unknown): string => {
    if (typeof remainingPct !== 'number' || !Number.isFinite(remainingPct)) return '';
    if (remainingPct <= lowPct) return 'tone-low';
    if (remainingPct <= medPct) return 'tone-medium';
    return 'tone-healthy';
  };

  const renderWeeklyDonut = (pl: PoolPayload): string => {
    if (typeof pl.weeklyPct !== 'number' || !Number.isFinite(pl.weeklyPct)) return '';
    const remWeekly = Math.max(0, Math.min(100, pl.weeklyPct));
    const shownWeekly = fmtVal(remWeekly);
    const tone = getQuotaTone(remWeekly);
    const radius = 9;
    const circ = 2 * Math.PI * radius;
    const arcLen = Math.max(shownWeekly > 0 || !isUsedGlobal ? 2.4 : 0, (shownWeekly / 100) * circ);
    const resetSub = pl.weeklyResetLabel && pl.weeklyResetLabel !== '--' ? pl.weeklyResetLabel : '';
    const valStr = shownWeekly + (isUsedGlobal ? '% used' : '%');
    return '<div class="weekly-mini ' + tone + '" data-weekly-donut="' + esc(pl.id) + '" title="Weekly limit: ' + remWeekly + '% left (' + (100 - remWeekly) + '% used)' + (resetSub ? ' · Resets ' + esc(resetSub) : '') + '">' +
      '<svg class="weekly-mini-svg" viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle class="weekly-mini-bg" cx="12" cy="12" r="9"/>' +
        '<circle class="weekly-mini-fg" cx="12" cy="12" r="9" transform="rotate(-90 12 12)" stroke-dasharray="' + arcLen.toFixed(2) + ' ' + circ.toFixed(2) + '"/>' +
      '</svg>' +
      '<span class="weekly-mini-label">Weekly <span class="weekly-mini-val">' + esc(valStr) + '</span></span>' +
    '</div>';
  };

  const renderPoolItem = (s: SnapshotPayload, pl: PoolPayload, isFlat: boolean): string => {
    const hasPct = typeof pl.remainingPct === 'number';
    const hasBal = typeof pl.balanceAmount === 'number';
    const barVal = hasPct ? fmtVal(pl.remainingPct) : 0;
    const valText = hasPct
      ? (barVal + (isUsedGlobal ? '% used' : '%'))
      : (hasBal ? formatMoney(pl.balanceAmount, pl.balanceCurrency) : '--');
    const sbKey = getStatusBarKey(s.id, pl.id);
    const sbSwitchHtml = renderSbSwitch(sbKey, pl, s.shortCode);
    const isWarn = hasPct ? (pl.remainingPct! <= lowPct) : (hasBal && pl.balanceAmount! <= lowBal);
    const poolTone = hasPct ? getQuotaTone(pl.remainingPct) : (isWarn ? 'tone-low' : '');

    const hasFiveH = typeof pl.fiveHourPct === 'number';
    const hasWeekly = typeof pl.weeklyPct === 'number';
    const primaryRem = (hasFiveH && hasWeekly) ? pl.fiveHourPct : pl.remainingPct;
    const primaryFillVal = typeof primaryRem === 'number' ? fmtVal(primaryRem) : barVal;
    const primaryTone = typeof primaryRem === 'number' ? getQuotaTone(primaryRem) : poolTone;
    const primaryWarn = typeof primaryRem === 'number' ? (primaryRem <= lowPct) : isWarn;

    const metaParts: string[] = [];
    if (pl.weeklyPct === 0 && hasFiveH && pl.fiveHourPct! > 0) {
      metaParts.push('Weekly cap');
    }
    if (hasFiveH && pl.fiveHourPct !== pl.remainingPct) {
      metaParts.push('5h ' + fmtVal(pl.fiveHourPct) + '%');
    } else if (hasFiveH) {
      metaParts.push('5h');
    }
    if (hasBal && typeof pl.budgetCapAmount === 'number') {
      metaParts.push(formatMoney(pl.balanceAmount, pl.balanceCurrency) + ' / ' + formatMoney(pl.budgetCapAmount, pl.balanceCurrency) + ' cap');
    } else if (hasBal && !hasPct) {
      metaParts.push((pl.balanceCurrency || 'USD') + ' balance');
    }
    const resetLbl = (hasFiveH && pl.fiveHourResetLabel && pl.fiveHourResetLabel !== '--')
      ? pl.fiveHourResetLabel
      : ((pl.nextResetLabel && pl.nextResetLabel !== '--')
        ? pl.nextResetLabel
        : (pl.fiveHourReset || pl.weeklyResetLabel || pl.weeklyReset || ''));
    if (resetLbl && resetLbl !== '--') metaParts.push('Resets ' + resetLbl);

    const tooltipParts = [s.name + ' · ' + pl.name];
    if (hasFiveH) tooltipParts.push('5h: ' + pl.fiveHourPct + '% left (' + (100 - pl.fiveHourPct!) + '% used)');
    if (hasWeekly) tooltipParts.push('Weekly: ' + pl.weeklyPct + '% left (' + (100 - pl.weeklyPct!) + '% used)');
    if (hasBal) tooltipParts.push('Balance: ' + formatMoney(pl.balanceAmount, pl.balanceCurrency));
    if (pl.fiveHourReset) tooltipParts.push('5h reset: ' + pl.fiveHourReset);
    if (pl.weeklyReset) tooltipParts.push('Weekly reset: ' + pl.weeklyReset);
    if (pl.pacing && pl.pacing.detail) tooltipParts.push('Pace: ' + pl.pacing.detail);

    const providerPill = isFlat
      ? '<span class="provider-code-pill" title="' + esc(s.name) + '">' + esc(s.shortCode) + '</span>'
      : '';

    const trackHtml = hasPct
      ? '<div class="q-track"><div class="q-fill ' + primaryTone + (primaryWarn ? ' warn' : '') + '" style="width:' + primaryFillVal + '%"></div></div>'
      : '';
    const donutHtml = renderWeeklyDonut(pl);
    const pacingBadgeHtml = pl.pacing
      ? '<span class="pacing-badge ' + esc(pl.pacing.level) + '" title="' + esc(pl.pacing.detail) + '">' + esc(pl.pacing.label) + '</span>'
      : '';
    const metaHtml = (metaParts.length > 0 || pacingBadgeHtml)
      ? '<div class="pool-meta">' + (metaParts.length > 0 ? '<span>' + esc(metaParts.join(' · ')) + '</span>' : '') + pacingBadgeHtml + '</div>'
      : '';

    return '<div class="pool-item' + (isFlat ? ' flat-pool' : '') + '" title="' + esc(tooltipParts.join(' | ')) + '">' +
      '<div class="pool-head">' +
        '<div class="pool-name-group">' + providerPill + '<span class="pool-name">' + esc(pl.name) + '</span></div>' +
        '<div class="pool-head-right">' +
          '<span class="pool-val ' + poolTone + (isWarn ? ' warn' : '') + '">' + esc(valText) + '</span>' +
          sbSwitchHtml +
        '</div>' +
      '</div>' +
      '<div class="pool-metrics">' +
        '<div class="pool-primary-col">' + trackHtml + metaHtml + '</div>' +
        donutHtml +
      '</div>' +
    '</div>';
  };

  const isKeyProvider = (id: string): boolean => id === 'openrouter' || id === 'deepseek' || id === 'cline';
  const isCustomProvider = (id: string): boolean => id.startsWith('custom:');

  const providerScoped = activeProviderFilter === 'all'
    ? visibleSnapshots
    : visibleSnapshots.filter((s) => s.id === activeProviderFilter);

  const breakdownEl = document.getElementById('quotaBreakdown');
  if (!breakdownEl) return;
  const blocks: string[] = [];

  const appendNonLiveBlock = (p: SnapshotPayload): void => {
    const badge = p.status === 'not_connected'
      ? 'Not connected'
      : (p.status === 'coming_soon' ? 'Coming soon' : 'Unavailable');
    const sub = p.status === 'coming_soon'
      ? 'Not yet configured'
      : (p.note || (p.status === 'not_connected' ? 'Connect API key to enable' : 'Unavailable'));
    const isBusyConnect = Boolean(pendingAction && pendingAction.type === 'connect' && pendingAction.providerId === p.id);
    const actionHtml = p.requiresConnect
      ? '<button type="button" class="btn-ghost" data-connect-provider="' + esc(p.id) + '"' + (isBusyConnect ? ' disabled' : '') + '>' + (isBusyConnect ? 'Connecting...' : 'Connect') + '</button>'
      : '<span class="badge-soon">' + esc(badge) + '</span>';
    blocks.push(
      '<div class="provider-block">' +
        '<div class="provider-row">' +
          '<div class="pr-left">' +
            '<div class="pr-icon">' + esc(p.shortCode) + '</div>' +
            '<div><div class="pr-name">' + esc(p.name) + '</div><div class="pr-sub">' + esc(sub) + '</div></div>' +
          '</div>' +
          actionHtml +
        '</div>' +
      '</div>'
    );
  };

  for (const p of providerScoped) {
    if (p.status !== 'live' || p.pools.length === 0) {
      appendNonLiveBlock(p);
      continue;
    }
    const matchedPools = p.pools;
    const numericPools = matchedPools.filter((pl) => typeof pl.remainingPct === 'number');
    let headVal = '';
    let headWarn = '';
    if (numericPools.length > 0) {
      const avg = Math.round(numericPools.reduce((sum, pl) => sum + (pl.remainingPct ?? 0), 0) / numericPools.length);
      headVal = fmtVal(avg) + (isUsedGlobal ? '% used' : '%');
      headWarn = ' ' + getQuotaTone(avg) + (avg <= lowPct ? ' warn' : '');
    } else if (typeof matchedPools[0].balanceAmount === 'number') {
      headVal = formatMoney(matchedPools[0].balanceAmount, matchedPools[0].balanceCurrency);
      headWarn = matchedPools[0].balanceAmount <= lowBal ? ' tone-low warn' : ' tone-healthy';
    }

    const isBusyDisconnect = Boolean(pendingAction && pendingAction.type === 'disconnect' && pendingAction.providerId === p.id);
    const isBusyRemove = Boolean(pendingAction && pendingAction.type === 'remove' && pendingAction.providerId === p.id);
    const disconnectBtn = isKeyProvider(p.id)
      ? '<button type="button" class="btn-ghost" data-disconnect-provider="' + esc(p.id) + '" title="Remove API key from SecretStorage"' + (isBusyDisconnect ? ' disabled' : '') + '>' + (isBusyDisconnect ? 'Disconnecting...' : 'Disconnect') + '</button>'
      : (isCustomProvider(p.id)
        ? '<button type="button" class="btn-ghost" data-remove-custom="' + esc(p.id) + '" title="Remove custom provider"' + (isBusyRemove ? ' disabled' : '') + '>' + (isBusyRemove ? 'Removing...' : 'Remove') + '</button>'
        : '');
    const poolsHtml = matchedPools.map((pl) => renderPoolItem(p, pl, false)).join('');

    blocks.push(
      '<div class="provider-block">' +
        '<div class="provider-row">' +
          '<div class="pr-left">' +
            '<div class="pr-icon">' + esc(p.shortCode) + '</div>' +
            '<div><div class="pr-name">' + esc(p.name) + '</div><div class="pr-sub">' + esc(p.sourceKind) + '</div></div>' +
          '</div>' +
          '<div class="pool-head-right">' +
            disconnectBtn +
            '<span class="pr-pct' + headWarn + '">' + esc(headVal) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pool-list">' + poolsHtml + '</div>' +
      '</div>'
    );
  }

  if (blocks.length === 0) {
    if (visibleSnapshots.length === 0) {
      breakdownEl.innerHTML = '<div class="empty-state">' +
        '<div>No AI providers detected or connected yet.</div>' +
        '<button type="button" class="btn-ghost" id="emptyAddAgentBtn">+ Add Agent</button>' +
      '</div>';
      document.getElementById('emptyAddAgentBtn')?.addEventListener('click', () => {
        pendingAction = { type: 'add' };
        setAddAgentVisual(true);
        setActionNotice('Opening Add Agent prompt...');
        vscode.postMessage({ command: 'connectProvider' });
      });
    } else {
      breakdownEl.innerHTML = '<div class="empty-state">' +
        '<div>No providers or pools match this filter.</div>' +
        '<button type="button" class="btn-ghost" id="resetFiltersBtn">Reset Filters</button>' +
      '</div>';
      document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
        activeProviderFilter = 'all';
        saveViewState({ providerFilter: 'all' });
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
        const current = getActiveSbSet(lastPayload?.config);
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
    breakdownEl.querySelectorAll('[data-connect-provider]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-connect-provider');
        if (!pid) return;
        pendingAction = { type: 'connect', providerId: pid };
        (btn as HTMLButtonElement).disabled = true;
        btn.textContent = 'Connecting...';
        setActionNotice('Connecting ' + pid + '...');
        vscode.postMessage({ command: 'connectProvider', providerId: pid });
      });
    });
    breakdownEl.querySelectorAll('[data-disconnect-provider]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-disconnect-provider');
        if (!pid) return;
        pendingAction = { type: 'disconnect', providerId: pid };
        (btn as HTMLButtonElement).disabled = true;
        btn.textContent = 'Disconnecting...';
        setActionNotice('Disconnecting ' + pid + '...');
        vscode.postMessage({ command: 'disconnectProvider', providerId: pid });
      });
    });
    breakdownEl.querySelectorAll('[data-remove-custom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-remove-custom');
        if (!pid) return;
        pendingAction = { type: 'remove', providerId: pid };
        (btn as HTMLButtonElement).disabled = true;
        btn.textContent = 'Removing...';
        setActionNotice('Removing custom provider...');
        vscode.postMessage({ command: 'removeCustomProvider', providerId: pid });
      });
    });
  }

  renderBars(history);
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { command?: string; notice?: string; payload?: DashboardStatePayload } | undefined;
  if (!msg) return;
  if (msg.command === 'actionDone') {
    pendingAction = null;
    setAddAgentVisual(false);
    if (msg.notice) {
      setActionNotice(msg.notice, 5000);
    } else {
      setActionNotice('');
    }
    if (lastPayload) renderAll();
    return;
  }
  if (msg.command !== 'state' || !msg.payload) return;
  lastPayload = msg.payload;
  renderAll();
});

vscode.postMessage({ command: 'ready' });
