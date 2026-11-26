# QuotaDeck — AI Usage & Limits

A minimalist, zero-clutter VS Code extension to monitor **5-hour / weekly quotas** and **credit balances** across **Antigravity**, **Claude Code**, **Codex**, **OpenRouter**, **DeepSeek**, **Cline**, and custom HTTP/CLI providers right from your Status Bar and Dashboard.

Works across **macOS**, **Linux**, and **Windows** (including WSL and remote workspaces).

---

## Supported Providers

| Provider | Data Source | Auth |
|---|---|---|
| **Antigravity** | Local `agy` CLI (`agy /usage`) | Auto-detected |
| **Claude Code** | Local OAuth session (macOS Keychain or `~/.claude/.credentials.json` / `CLAUDE_CONFIG_DIR`) | Auto-detected |
| **Codex** | Local Codex session (`~/.codex/auth.json` or `CODEX_HOME`) | Auto-detected |
| **OpenRouter** | Official `GET /api/v1/key` & `/api/v1/credits` | `SecretStorage` (`Connect`) |
| **DeepSeek** | Official `GET /user/balance` | `SecretStorage` (`Connect`) |
| **Cline / ClinePass** | Official `GET /api/v1/users/me/plan/usage-limits` & `/balance` | `SecretStorage` (`Connect`) |
| **Custom Providers** | User-defined `https://`/`localhost` HTTP JSON or local CLI | Optional `SecretStorage` |

---

## Key Features

- **Glanceable Status Bar**: Live summary (`AGY: G 93% | CL 50% | DS $10.00`) with calm warning highlights (`<= 20%` or `<= $1.00`) and rich hover tooltips with reset countdowns.
- **Provider-First Dashboard**:
  - **List & Grid Views**: Switch between a compact hairline list and a responsive multi-column grid.
  - **Left / Used Mode**: Toggle globally between remaining (`% left`) and consumed (`% used`) quotas.
  - **Inline Controls**: Pin/unpin any pool to the Status Bar (`Bar` switch) or `Connect` / `Disconnect` API keys securely via `vscode.SecretStorage`.
  - **Filter & Sort**: Filter by provider or status (`All`, `Low`, `Status Bar`) and sort by `Grouped`, `Tightest First`, `Most Available`, `Soonest Reset`, or `Name (A–Z)`.
- **Balance + Optional Budget Caps**: Credit providers (`DeepSeek`, uncapped `OpenRouter`) show their exact balance (`$10.00`) and can optionally use `quotadeck.budgets` to calculate percentage bars and low-balance warnings.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `quotadeck.displayMode` | `"remaining"` | Show percentages as remaining (`"remaining"`) or consumed (`"used"`). |
| `quotadeck.statusBarProviders` | `["agy-gemini", "claude", "codex"]` | Pool keys shown in the Status Bar (e.g. `openrouter`, `deepseek`, `cline`, `custom:<id>`). |
| `quotadeck.pollingIntervalSeconds` | `300` | Baseline polling interval in seconds (`60`–`3600`). |
| `quotadeck.budgets` | `{}` | Optional USD budget caps (`{ "openrouter": 20, "deepseek": 10, "cline": 20 }`). |
| `quotadeck.customProviders` | `[]` | Custom HTTP (`https://`/`localhost`) or CLI usage providers. |

### Custom Provider Example
```jsonc
"quotadeck.customProviders": [
  {
    "id": "my-gateway",
    "name": "My LLM Gateway",
    "shortCode": "GW",
    "kind": "http",
    "url": "https://gateway.example.com/v1/usage",
    "secretKey": "quotadeck.secret.my-gateway",
    "valueType": "percentage",
    "valuePath": "data.remaining_pct",
    "resetPath": "data.resets_at"
  }
]
```

---

## Commands

- `QuotaDeck: Open Dashboard` (`quotadeck.openDashboard`)
- `QuotaDeck: Refresh Usage` (`quotadeck.refresh`)
- `QuotaDeck: Connect Provider API Key` (`quotadeck.connectProvider`)
- `QuotaDeck: Disconnect Provider API Key` (`quotadeck.disconnectProvider`)
- `QuotaDeck: Clear History` (`quotadeck.clearHistory`)

---

## Privacy & Security

- API keys entered via `Connect` are stored strictly in `vscode.SecretStorage` (never written to `settings.json` or logs).
- Zero telemetry, zero analytics, and zero external data collection.
