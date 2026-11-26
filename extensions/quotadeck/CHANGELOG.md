# Changelog

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
