# Changelog

## 0.3.0

- Added **Window-Based Quota Pacing** (`src/pacing.ts`) comparing consumed quota percentage against elapsed 5-hour / weekly window time (`On pace`, `Elevated`, `Fast · ~Xh left`).
- Added **Configurable Warning Thresholds**: `quotadeck.lowThresholdPct` (default `20%`) and `quotadeck.lowBalanceUsd` (default `$1.00`), unified across Status Bar warnings, Dashboard `Low` filters, Donut Charts, and progress bars.
- Upgraded **Per-Pool & USD History Granularity** (`HistoryStore` + Dashboard Usage History): stores `5h`, `Weekly`, and USD balance snapshots backward-compatibly and adds an `All Windows / 5h Window / Weekly Window` history selector plus USD balance breakdown in hover popovers.

## 0.2.2

- Added **Weekly Limit Donut Chart** inside quota cards with remaining-capacity color tiers (`> 50%` green, `21%–50%` amber, `<= 20%` warm coral) synchronized even in `Used` mode.
- Improved **Responsive UI** across narrow VS Code side panels and wide windows (wrapping topbar/actions, fluid `min(100%, 290px)` grid tracks, mobile stacked donut & pool metrics).
- Modularized Webview CSS/TypeScript assets (`src/ui/webview/*` bundled via `esbuild` with `localResourceRoots` + `asWebviewUri`), extracted `src/flows/providerOnboarding.ts`, and added GitHub Actions CI & release workflows.

## 0.2.1

- Added `"AI"` category, expanded Marketplace/Open VSX search keywords, and updated `README.md` with installation guides, configuration reference, and FAQ.

## 0.2.0

- Added **Wave 1 Official REST API Providers** stored in `vscode.SecretStorage` (never written to `settings.json`):
  - **OpenRouter** (`GET /api/v1/key` & `/api/v1/credits`)
  - **DeepSeek** (`GET /user/balance`)
  - **Cline / ClinePass** (`GET /api/v1/users/me/plan/usage-limits` & `/balance`)
- Added **Guided `+ Add Agent` Flow & Custom Endpoint Support** (`quotadeck.customProviders`):
  - Interactive QuickPick/InputBox wizard for adding `https://`/`localhost` HTTP JSON endpoints or local CLI commands (`percentage`, `used_percentage`, `balance_usd`) with prototype-safe dot-path extraction and optional `{{SECRET}}` header templating.
  - Inline button loading states (`Adding...`, `Connecting...`, `Disconnecting...`, `Removing...`) and non-intrusive Status Bar notices (`setStatusBarMessage`).
- Added **Startup-Only Detection for Missing Local Agents**:
  - Local agents (`Antigravity`, `Claude Code`, `Codex`) without binaries or credentials are marked `not_connected`, hidden cleanly from the Dashboard, and skipped during background auto-polling, with manual re-check via **`+ Add Agent`** or **`Refresh`**.
- Added **Balance + Optional Budget Caps** (`quotadeck.budgets`) to render USD/CNY balances directly or compute percentage bars and `<= 20%` warnings.
- Generalized `quotadeck.statusBarProviders` to support all built-in and `custom:<id>` providers.

## 0.1.1

- Cross-platform hardening for **Windows**, **Linux**, and **macOS**:
  - Support `.cmd`/`.exe` resolution and `windowsHide: true` when invoking `agy` CLI on Windows.
  - Support `CLAUDE_CONFIG_DIR` and file credential fallback when macOS Keychain tokens expire.
  - Guard against post-disposal polling timers and Windows file-locking during history compaction.
  - Clamp percentage values safely in the Dashboard Webview.
- Improved public `README.md` documentation and `Visualization` Marketplace category.

## 0.1.0

- Initial public release of **QuotaDeck — AI Usage & Limits**.
