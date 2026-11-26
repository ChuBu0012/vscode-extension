# QuotaDeck — AI Usage & Limits

**QuotaDeck** (`pornput-s.quotadeck`) is a lightweight VS Code, Cursor, Windsurf, and Antigravity extension for monitoring **5-hour and weekly AI coding rate limits** alongside **API credit balances** directly in your Status Bar and Dashboard Webview.

QuotaDeck tracks **Antigravity**, **Claude Code**, **Codex**, **OpenRouter**, **DeepSeek**, **Cline / ClinePass**, and user-defined **Custom HTTP JSON or CLI endpoints** with zero telemetry and `vscode.SecretStorage` credential encryption.

---

## Quick Facts

| Attribute | Value |
|---|---|
| **Extension ID** | `pornput-s.quotadeck` |
| **Registry** | [Open VSX (`pornput-s/quotadeck`)](https://open-vsx.org/extension/pornput-s/quotadeck) |
| **Source Repository** | [github.com/ChuBu0012/vscode-extension](https://github.com/ChuBu0012/vscode-extension) |
| **Supported Editors** | Antigravity, Cursor, Windsurf, VSCodium, Visual Studio Code `^1.90.0` |
| **Supported OS** | macOS, Linux, Windows (native and WSL / remote workspaces) |
| **Telemetry / Tracking** | None (`0` external analytics calls) |
| **Credential Storage** | Encrypted OS keychain via `vscode.SecretStorage` (never written to `settings.json`) |

---

## Installation

### Antigravity, Cursor, Windsurf, and VSCodium (Open VSX)
1. Open the Extensions view (`Cmd+Shift+X` on macOS or `Ctrl+Shift+X` on Windows/Linux).
2. Search for `QuotaDeck` or `pornput-s.quotadeck`.
3. Click **Install**.

### Visual Studio Code (via VSIX)
QuotaDeck is currently published on Open VSX. To install in Microsoft VS Code:
1. Download the latest `.vsix` package from [Open VSX Versions](https://open-vsx.org/extension/pornput-s/quotadeck).
2. In VS Code, open Extensions -> click `...` (Views and More Actions) -> **Install from VSIX...**, or run:
   ```bash
   code --install-extension quotadeck-0.2.0.vsix
   ```

---

## Supported Providers & Data Sources

| Provider | What QuotaDeck Tracks | Auth / Discovery | Hidden When Absent |
|---|---|---|---|
| **Antigravity** (`agy`) | 5-hour & weekly pool limits (`Gemini`, `Claude`) | Runs `agy /usage` on startup & manual refresh | Yes (`not_connected` when `agy` is missing) |
| **Claude Code** | 5-hour, weekly, Sonnet & Opus utilization (`api/oauth/usage`) | macOS Keychain or `$CLAUDE_CONFIG_DIR/.credentials.json` (`~/.claude`) | Yes (`not_connected` when not signed in) |
| **Codex** | Primary (5h) & secondary (weekly) rate limits (`wham/usage`) | `$CODEX_HOME/auth.json` (`~/.codex/auth.json`) | Yes (`not_connected` when not signed in) |
| **OpenRouter** | Key credit limit remaining or account credits | API key via `+ Add Agent` (`SecretStorage`) | Yes until connected |
| **DeepSeek** | Total balance (`USD` / `CNY`) + optional budget cap `%` | API key via `+ Add Agent` (`SecretStorage`) | Yes until connected |
| **Cline / ClinePass** | 5h / weekly plan utilization or pay-as-you-go balance | Token via `+ Add Agent` (`SecretStorage`) | Yes until connected |
| **Custom HTTP / CLI** | Any `https://` or `localhost` JSON API or local CLI command | Guided wizard in `+ Add Agent` or `quotadeck.customProviders` | Shown once configured |

### Local Agent Auto-Detection & Manual Re-Check
- On editor startup, QuotaDeck checks **Antigravity**, **Claude Code**, and **Codex** automatically.
- Providers not installed or not signed in on the machine return `not_connected`, remain hidden from the Dashboard to prevent clutter, and are skipped during background auto-polling.
- If you install or sign in to a local tool later without restarting the IDE, click **`+ Add Agent`** in the Dashboard (or press **`Refresh`**) to re-check it immediately.

---

## Features

### 1. Glanceable Status Bar & Rich Tooltip
- Displays live quotas and balances inline (for example: `AGY: G 93% | CL 50% | DS $10.00`).
- Switches to warning highlight (`statusBarItem.warningBackground`) when remaining quota drops to `<= 20%` or balance drops to `<= $1.00`.
- Hovering shows ASCII progress bars, both `5h` and `Weekly` windows, exact local reset countdowns, and one-click **Refresh** / **Open Dashboard** actions.

### 2. Minimalist Provider Dashboard
- **List & Grid Views**: Switch between a single-column hairline list and a responsive multi-column grid (`webview` state persisted across sessions).
- **Global Left / Used Mode**: Toggle all cards, history bars, and the Status Bar between remaining (`% left`) and consumed (`% used`).
- **Inline Status Bar Switches**: Toggle the `Bar` switch on any pool card to pin or unpin that provider from the Status Bar.
- **`+ Add Agent` CTA**: Guided flow to connect OpenRouter, DeepSeek, Cline, re-check local agents, or add a custom HTTP/CLI endpoint with live button loading states and automatic Status Bar feedback.
- **Filter, Search & Sort**: Filter by provider or status (`All`, `Low`, `Status Bar`) and sort pools by `Grouped`, `Tightest First`, `Most Available`, `Soonest Reset`, or `Name (A-Z)`.
- **Collapsible Usage History**: Compact bar chart (`24H`, `7D`, `30D`) stored locally in extension `globalStorageUri` with per-provider filtering.

### 3. Adaptive Backoff Polling & Offline Resilience
- Automatically backs off from the baseline interval when quotas are unchanged (`1x -> 2x -> 4x`, capped at `30` minutes) and wakes up ~2 seconds after the earliest known reset window.
- Pauses background polling when the editor window loses focus and serves the last cached snapshot if an upstream API temporarily times out.

---

## Configuration Reference

Configure via VS Code **Settings** (`Cmd+,` / `Ctrl+,` -> search `QuotaDeck`) or `settings.json`:

| Setting | Type / Default | Description |
|---|---|---|
| `quotadeck.displayMode` | `"remaining"` \| `"used"` (default `"remaining"`) | Show percentages as remaining (`left`) or consumed (`used`). |
| `quotadeck.statusBarProviders` | `string[]` (default `["agy-gemini", "claude", "codex"]`) | Pool IDs displayed in the Status Bar (`agy-gemini`, `agy-claude`, `claude`, `codex`, `openrouter`, `deepseek`, `cline`, `custom:<id>`). |
| `quotadeck.pollingIntervalSeconds` | `number` (default `300`, range `60`–`3600`) | Baseline polling interval in seconds before adaptive backoff (`1x -> 2x -> 4x`, max 30 min). |
| `quotadeck.budgets` | `object` (default `{}`) | Optional USD budget caps (`{ "openrouter": 20, "deepseek": 10, "cline": 20 }`) for computing percentage bars on uncapped balances. |
| `quotadeck.customProviders` | `CustomProviderConfig[]` (default `[]`) | Array of custom HTTP JSON (`https://`/`localhost`) or local CLI usage providers. |

### Custom Provider Configuration Example

You can configure custom providers through the interactive **`+ Add Agent` -> `Custom HTTP / CLI Endpoint`** wizard or directly in `settings.json`:

```jsonc
"quotadeck.customProviders": [
  {
    "id": "my-gateway",
    "name": "LiteLLM Gateway",
    "shortCode": "LT",
    "kind": "http",
    "url": "https://gateway.example.com/key/info",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer {{SECRET}}"
    },
    "secretKey": "quotadeck.secret.my-gateway",
    "valueType": "balance_usd",
    "valuePath": "info.remaining_budget",
    "budgetCapUsd": 50,
    "resetPath": "info.budget_reset_at"
  }
]
```

**Custom Provider Fields**:
- `kind`: `"http"` (`https://` or `http://localhost` / `127.0.0.1` / `::1`) or `"cli"` (executes command directly via `execFile` without shell interpolation on POSIX).
- `valueType`: `"percentage"` (`0–100` remaining), `"used_percentage"` (`0–100` used, auto-inverted), or `"balance_usd"`.
- `valuePath` / `resetPath`: Safe dot-notation paths into the JSON response (prototype keys such as `__proto__`, `constructor`, and `prototype` are blocked).
- `headers`: Optional map; any `{{SECRET}}` placeholder is substituted at runtime from `vscode.SecretStorage` under `secretKey` (otherwise defaults to `Authorization: Bearer <secret>`).

---

## Commands

| Command | ID | Description |
|---|---|---|
| **QuotaDeck: Open Dashboard** | `quotadeck.openDashboard` | Open or focus the Dashboard Webview. |
| **QuotaDeck: Refresh Usage** | `quotadeck.refresh` | Immediately re-check all providers (including hidden local tools). |
| **QuotaDeck: Add Agent / Provider API Key** | `quotadeck.connectProvider` | Open the `+ Add Agent` QuickPick for API keys, local tools, or custom endpoints. |
| **QuotaDeck: Disconnect Provider API Key** | `quotadeck.disconnectProvider` | Remove a stored API key from `vscode.SecretStorage`. |
| **QuotaDeck: Clear History** | `quotadeck.clearHistory` | Erase recorded usage history snapshots. |

---

## Frequently Asked Questions (FAQ)

### How does QuotaDeck track Antigravity, Claude Code, and Codex without an API key?
QuotaDeck reads locally authenticated developer tool state already present on your machine: `agy /usage` output for Antigravity, macOS Keychain or `~/.claude/.credentials.json` (`CLAUDE_CONFIG_DIR`) for Claude Code, and `~/.codex/auth.json` (`CODEX_HOME`) for Codex.

### What happens if Claude Code, Codex, or Antigravity is not installed?
If a local binary or session file is missing on startup, QuotaDeck marks that provider as `not_connected`, hides its card from the Dashboard, and skips it during background auto-polling. If your session token later expires (`401`/`403`), QuotaDeck surfaces an `unavailable` status note prompting you to refresh that tool's login.

### Where are my API keys and bearer tokens stored?
All API keys for OpenRouter, DeepSeek, Cline, and custom endpoints are encrypted inside `vscode.SecretStorage`. QuotaDeck never writes keys into `settings.json`, workspace files, or output logs.

### Why doesn't QuotaDeck show up in Microsoft VS Code Marketplace search?
QuotaDeck is currently published on the **Open VSX Registry** (`pornput-s.quotadeck`), which powers Cursor, Windsurf, Antigravity, and VSCodium. Microsoft VS Code uses a separate Marketplace; download the `.vsix` file from Open VSX and install it with **Install from VSIX...** or `code --install-extension`.

### Can I monitor custom LLM proxies, company gateways, or local quota scripts?
Yes. Click **`+ Add Agent`** -> **`Custom HTTP / CLI Endpoint`** in the Dashboard (or add an entry to `quotadeck.customProviders`) to extract quotas or USD balances from any JSON API (`https://` or `localhost`) or local CLI command using a JSON dot-path.

---

## Privacy & Security

- **Local-First Architecture**: Only communicates with configured official API endpoints and user-defined custom providers.
- **Strict Webview CSP**: Inline scripts run with cryptographic per-panel nonces; all rendered strings are HTML-escaped.
- **Non-Blocking Host Execution**: CLI and HTTP checks run asynchronously with bounded timeouts (`windowsHide: true` on Windows).
- **Zero Notification Spam**: Status feedback uses Status Bar progress/messages and the QuotaDeck Output Channel rather than modal popups.
