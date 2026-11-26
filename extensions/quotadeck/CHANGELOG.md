# Changelog

## 0.2.0

- Added **Wave 1 Official REST API Providers** using `vscode.SecretStorage` (never stored in `settings.json`):
  - **OpenRouter** (`GET /api/v1/key` & `/api/v1/credits`)
  - **DeepSeek** (`GET /user/balance`)
  - **Cline / ClinePass** (`GET /api/v1/users/me/plan/usage-limits` & `/balance`)
- Added **Balance + Optional Budget Cap** (`quotadeck.budgets`) to display USD/CNY balances directly or compute percentage bars and `<= 20%` warnings.
- Added **Extensible Custom Providers** (`quotadeck.customProviders`) supporting `https://`/`localhost` HTTP JSON endpoints and local CLI tools with prototype-safe dot-path extraction.
- Added `QuotaDeck: Connect Provider API Key` (`quotadeck.connectProvider`), `QuotaDeck: Disconnect Provider API Key` (`quotadeck.disconnectProvider`), and inline `Connect`/`Disconnect` buttons in the Dashboard.
- Generalized `quotadeck.statusBarProviders` to support all built-in and `custom:<id>` providers.

## 0.1.1

- Cross-platform hardening for **Windows**, **Linux**, and **macOS**:
  - Support `.cmd`/`.exe` resolution and `windowsHide: true` when invoking `agy` CLI on Windows.
  - Support `CLAUDE_CONFIG_DIR` and file credential fallback when macOS Keychain tokens expire.
  - Guard against post-disposal polling timers and Windows file-locking during history compaction.
  - Clamp percentage values safely in the Dashboard Webview.
- Improved public `README.md` documentation, troubleshooting guide, and `Visualization` Marketplace category.

## 0.1.0

- Initial public release of **QuotaDeck — AI Usage & Limits**.
