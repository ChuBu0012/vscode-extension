# Changelog

## 0.1.1

- Cross-platform hardening for **Windows**, **Linux**, and **macOS**:
  - Support `.cmd`/`.exe` resolution and `windowsHide: true` when invoking `agy` CLI on Windows.
  - Support `CLAUDE_CONFIG_DIR` and file credential fallback when macOS Keychain tokens expire.
  - Guard against post-disposal polling timers and Windows file-locking during history compaction.
  - Clamp percentage values safely in the Dashboard Webview.
- Improved public `README.md` documentation, troubleshooting guide, and `Visualization` Marketplace category.

## 0.1.0

- Initial public release of **QuotaDeck — AI Usage & Limits**.
- Exact 5-hour and weekly quota tracking for **Antigravity** (`agy`), **Claude Code** (Anthropic OAuth Usage API), and **Codex** (`~/.codex/auth.json`).
- Glanceable Status Bar indicator with friendly `<= 20%` warning highlight and rich hover tooltips with reset countdowns.
- Provider-first Dashboard with **List** and **Grid** layouts, global **Left / Used** toggle, provider & status filters, sorting, inline Status Bar toggles per pool, and collapsible **Usage History** graph.
- Adaptive backoff polling (`1x -> 2x -> 4x`, capped at 30 minutes) and focus-aware refresh.
