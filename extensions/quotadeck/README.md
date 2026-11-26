# QuotaDeck — AI Usage & Limits

Minimalist VS Code extension for tracking 5-hour and weekly usage quotas across **Antigravity**, **Claude Code**, and **Codex** directly from your Status Bar and Dashboard.

## Supported Providers
- **Antigravity**: Reads exact `5h` and `Weekly` quota limits via the local `agy` CLI (`agy /usage`).
- **Claude Code**: Reads exact `5h` and `Weekly` utilization via your local Claude Code OAuth session (`~/.claude/.credentials.json` or macOS Keychain).
- **Codex**: Reads exact primary (`5h`) and secondary (`Weekly`) rate limits via your local Codex session (`~/.codex/auth.json`).

If a provider is not installed or signed in on your machine, QuotaDeck degrades gracefully without intrusive popups.

## Features
- **Glanceable Status Bar**: Live summary in the bottom-right Status Bar (`AGY: G 93% | CL 50% | CX 10%`) with friendly warning highlights at `<= 20%` and rich hover tooltips with block progress bars and reset countdowns.
- **Provider-First Dashboard**:
  - Clean hairline layout with **List** and **Grid** views.
  - Global **Left / Used** percentage toggle.
  - Inline **Bar** toggle switch inside each quota pool to pin/unpin it in the Status Bar.
  - Provider tabs, status filter chips (`All`, `Low`, `Status Bar`), and sorting (`Grouped`, `Tightest First`, `Most Available`, `Soonest Reset`, `Name A–Z`).
- **Smart Polling & Local History**: Adaptive backoff polling when quotas remain unchanged, window-focus-aware refresh, and local usage history stored in VS Code global storage (`history.ndjson`).

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `quotadeck.displayMode` | `"remaining"` | Display quota percentages as remaining (`"remaining"`) or consumed (`"used"`). |
| `quotadeck.statusBarProviders` | `["agy-gemini", "claude", "codex"]` | Quota pools shown in the Status Bar (`agy-gemini`, `agy-claude`, `claude`, `codex`). |
| `quotadeck.pollingIntervalSeconds` | `300` | Baseline polling interval in seconds (`60`–`3600`). |

## Commands
- `QuotaDeck: Open Dashboard` (`quotadeck.openDashboard`)
- `QuotaDeck: Refresh Usage` (`quotadeck.refresh`)
- `QuotaDeck: Clear History` (`quotadeck.clearHistory`)

## Privacy
QuotaDeck reads credentials strictly from your local environment (`agy` CLI, Claude Code local credentials, `~/.codex/auth.json`) and communicates only with the respective official provider usage endpoints. No telemetry or third-party data collection is performed.

## Development
```bash
bun install
bun run --cwd extensions/quotadeck compile
bun run --cwd extensions/quotadeck watch
bun run --cwd extensions/quotadeck package
```
