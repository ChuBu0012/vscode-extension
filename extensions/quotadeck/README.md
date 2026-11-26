# QuotaDeck — AI Usage & Limits

A minimalist, zero-clutter VS Code extension to monitor **5-hour** and **weekly** usage quotas across **Antigravity**, **Claude Code**, and **Codex** directly from your Status Bar and Dashboard.

Works across **macOS**, **Linux**, and **Windows** (including WSL and remote workspaces).

---

## Key Features

- **Glanceable Status Bar**: Live quota summary in the bottom-right Status Bar (`AGY: G 93% | CL 50% | CX 10%`) with calm warning highlights at `<= 20%` and rich hover tooltips with progress bars and reset countdowns.
- **Provider-First Dashboard**:
  - **List & Grid Views**: Switch between a compact vertical hairline list and a responsive multi-column grid.
  - **Left / Used Mode**: Toggle globally between remaining (`% left`) and consumed (`% used`) quotas.
  - **Inline Status Bar Controls**: Pin or unpin any model pool directly from its own row using the `Bar` switch.
  - **Filter & Sort**: Filter by provider or status (`All`, `Low`, `Status Bar`) and sort by `Grouped`, `Tightest First`, `Most Available`, `Soonest Reset`, or `Name (A–Z)`.
- **Smart Polling & Local History**: Adaptive backoff polling (`1x -> 2x -> 4x`, up to 30m) when quotas are unchanged, focus-aware refresh, and a collapsible Usage History graph stored locally (`history.ndjson`).

---

## Supported Providers & Requirements

QuotaDeck automatically detects providers signed in on your machine and degrades gracefully if any tool is not installed:

| Provider | Data Source | Platforms |
|---|---|---|
| **Antigravity** | Local `agy` CLI (`agy /usage`) | macOS, Linux, Windows |
| **Claude Code** | Local OAuth session (macOS Keychain or `~/.claude/.credentials.json` / `CLAUDE_CONFIG_DIR`) | macOS, Linux, Windows |
| **Codex** | Local Codex session (`~/.codex/auth.json` or `CODEX_HOME`) | macOS, Linux, Windows |

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `quotadeck.displayMode` | `"remaining"` | Show percentages as remaining (`"remaining"`) or consumed (`"used"`). |
| `quotadeck.statusBarProviders` | `["agy-gemini", "claude", "codex"]` | Quota pools displayed in the Status Bar (`agy-gemini`, `agy-claude`, `claude`, `codex`). |
| `quotadeck.pollingIntervalSeconds` | `300` | Baseline polling interval in seconds (`60`–`3600`). |

---

## Commands

- `QuotaDeck: Open Dashboard` (`quotadeck.openDashboard`)
- `QuotaDeck: Refresh Usage` (`quotadeck.refresh`)
- `QuotaDeck: Clear History` (`quotadeck.clearHistory`)

---

## Privacy & Security

- Reads credentials strictly from your local environment and communicates only with the official usage endpoints of the providers you already use.
- Zero telemetry, zero analytics, and zero external data collection.

---

## Troubleshooting

- **Provider shows `Unavailable`**: Ensure the corresponding CLI/tool (`agy`, Claude Code, or Codex) is installed and signed in on your machine, then click **Refresh** or run `QuotaDeck: Refresh Usage`.
- **Inspect logs**: Open the **Output** panel (`Cmd+Shift+U` / `Ctrl+Shift+U`) and select **QuotaDeck**.
