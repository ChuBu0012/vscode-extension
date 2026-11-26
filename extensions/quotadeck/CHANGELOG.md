# Changelog

## 0.1.0

- Initial public release of **QuotaDeck — AI Usage & Limits**.
- Exact 5-hour and weekly quota tracking for **Antigravity** (`agy`), **Claude Code** (Anthropic OAuth Usage API), and **Codex** (`~/.codex/auth.json`).
- Glanceable Status Bar indicator with friendly `<= 20%` warning highlight and rich hover tooltips with reset countdowns.
- Provider-first Dashboard with **List** and **Grid** layouts, global **Left / Used** toggle, provider & status filters, sorting, inline Status Bar toggles per pool, and collapsible **Usage History** graph.
- Adaptive backoff polling (`1x -> 2x -> 4x`, capped at 30 minutes) and focus-aware refresh.
