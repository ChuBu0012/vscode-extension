# Specification — `quotadeck` (QuotaDeck — AI Usage & Limits)

> **Version**: v0.2.0 Target (Phase 2: Official REST API Providers & Custom Providers)
> **Baseline**: v0.1.1 (Published on Open VSX as `pornput-s.quotadeck`)

---

## 1. Overview
`quotadeck` is a cross-platform VS Code / Open VSX extension that monitors **5-hour / weekly quota limits** and **credit balances** across local AI coding tools and cloud AI APIs without exposing secrets in settings or spamming notifications.

### Baseline Providers (Implemented in v0.1.x)
1. **Antigravity (`agy`)**: Local `agy /usage` CLI (cross-platform `.cmd`/`.exe` + Unix path discovery).
2. **Claude Code (`claude`)**: Anthropic OAuth Usage API using macOS Keychain or `~/.claude/.credentials.json` (`CLAUDE_CONFIG_DIR`).
3. **Codex (`codex`)**: OpenAI Wham Usage API using `~/.codex/auth.json` (`CODEX_HOME`).

### Phase 2 Goals (Aligned via `/grill-me`)
1. **Hybrid Provider Expansion**:
   - **Wave 1 Built-in Official REST APIs**: **OpenRouter**, **DeepSeek**, and **Cline / ClinePass**.
   - **Extensible Custom Providers (`quotadeck.customProviders`)**: User-defined HTTP JSON endpoints or local CLI commands with JSONPath/dot-path extraction.
2. **Balance + Optional Budget Cap Model**:
   - Support dollar-balance providers (`$10.00` remaining) natively alongside percentage-window providers (`5h` / `Weekly`).
   - Support optional `budgetCapUsd` per credit provider so users can compute `% remaining`, view progress bars, and trigger `<= 20%` low-balance warnings.
3. **Secure Key Onboarding (`vscode.SecretStorage`)**:
   - Never store API keys or tokens in `settings.json`.
   - Provide inline `Connect` / `Disconnect` actions on unconfigured/connected provider rows and Command Palette commands (`quotadeck.connectProvider`, `quotadeck.disconnectProvider`).

---

## 2. Functional Requirements

### FR-1: Wave 1 Built-in Official REST API Providers

#### FR-1.1: OpenRouter (`openrouter`)
- **Primary Endpoint**: `GET https://openrouter.ai/api/v1/key` with `Authorization: Bearer <API_KEY>` (10s timeout via `AbortController`).
- **Optional Account Credits**: If user provides a Management/Provisioning key or `/key` returns account info, optionally query `GET https://openrouter.ai/api/v1/credits` for overall `total_credits` and `total_usage`.
- **Quota / Balance Mapping**:
  - When key `limit` is present (`typeof limit === 'number' && limit > 0`):
    - `remainingUsd = Math.max(0, limit - usage)`
    - `budgetCapUsd = limit`
    - `remainingPct = Math.round((remainingUsd / limit) * 100)`
  - When `limit` is `null` (unlimited key):
    - Use `credits` remaining balance (`$X.XX`) if available, or show `usage` (`$Y.YY used`) + optional user-configured `quotadeck.budgets.openrouter` (`budgetCapUsd`) to compute `remainingPct`.
- **Degradation**: Missing key → `status: 'not_connected'` (or `'unavailable'` with `requiresConnect: true` & `Connect` action button). HTTP `401`/`403` → prompt re-connect without stale cache; transient `5xx`/network error → fallback to last cached snapshot.

#### FR-1.2: DeepSeek (`deepseek`)
- **Endpoint**: `GET https://api.deepseek.com/user/balance` with `Authorization: Bearer <API_KEY>`.
- **Response Mapping**:
  - Read `is_available` and `balance_infos` (sum or primary currency entry e.g. `USD`: `total_balance`, `granted_balance`, `topped_up_balance`).
  - Format `balanceText` (e.g., `$10.00` or `¥50.00` matching `currency`).
  - If user configured `quotadeck.budgets.deepseek` (`> 0`), compute `remainingPct = clamp(round((totalBalance / budgetCap) * 100), 0, 100)` and enable progress bar + `<= 20%` warning.
  - If no budget cap is configured (`budgetCapUsd` unset), show exact balance (`$10.00`) without faking a percentage bar (`hasPercentage = false`, `isAvailable = true/false`).
- **Degradation**: Missing key → `Connect` action; HTTP `401`/`403` → invalid key message; `402` / `is_available: false` → `Balance depleted ($0.00)`.

#### FR-1.3: Cline / ClinePass (`cline`)
- **Endpoints**:
  - `GET https://api.cline.bot/api/v1/users/me/plan/usage-limits` (5h, weekly, monthly utilization/limits for ClinePass).
  - `GET https://api.cline.bot/api/v1/users/me` → `GET https://api.cline.bot/api/v1/users/{id}/balance` (pay-as-you-go balance when applicable).
- **Quota Mapping**:
  - Map 5h / weekly / monthly windows into `ModelPoolSnapshot` (`fiveHourPct`, `fiveHourReset`, `weeklyPct`, `weeklyReset`, `remainingPct` via `effectiveRemainingPct`).
  - If pay-as-you-go balance is returned alongside or instead of subscription limits, attach `balanceUsd` + optional `quotadeck.budgets.cline`.
- **Degradation**: Missing token → `Connect` action; `401`/`403` → expired/invalid token; transient network errors → cached snapshot fallback.

---

### FR-2: Extensible Custom Providers (`quotadeck.customProviders`)
Users can define custom HTTP JSON or CLI providers in `settings.json`:
```jsonc
"quotadeck.customProviders": [
  {
    "id": "my-gateway",
    "name": "My LLM Gateway",
    "shortCode": "GW",
    "kind": "http",               // "http" | "cli"
    "url": "https://gateway.example.com/v1/usage",
    "method": "GET",              // optional, default "GET"
    "headers": { "X-Custom": "1" },
    "secretKey": "quotadeck.secret.my-gateway", // optional SecretStorage key injected as Bearer token or {{SECRET}}
    "valueType": "percentage",    // "percentage" | "used_percentage" | "balance_usd"
    "valuePath": "data.remaining_pct",
    "resetPath": "data.resets_at",
    "budgetCapUsd": 25
  }
]
```
- **Security Constraints for Custom Providers**:
  - `http` kind: Only allow `https://` URLs (and `http://localhost` / `http://127.0.0.1` for local tools like Ollama/local proxies). Reject arbitrary `http://` remote URLs with clear validation note.
  - `cli` kind: Execute via `execFile` (no arbitrary shell injection on Unix; `windowsHide: true`, configurable timeout capped at `15000ms`), parsing stdout JSON via `valuePath` / `resetPath` or regex.
  - Safe dot-path extractor (`extractJsonPath(obj, path)`): Pure, prototype-pollution-safe (`__proto__`, `constructor`, `prototype` blocked).
  - `secretKey`: If configured, read from `vscode.SecretStorage` and attach via `Authorization: Bearer <secret>` (or replace `{{SECRET}}` in headers only, never in URLs or logs).

---

### FR-3: Unified Data Model & UI Presentation
- Extend `ModelPoolSnapshot`:
  - `remainingPct?: number` (when percentage or `budgetCapUsd` exists)
  - `balanceAmount?: number`
  - `balanceCurrency?: string` (e.g. `'USD'`, `'CNY'`)
  - `budgetCapAmount?: number`
  - `requiresAuth?: boolean` (for providers awaiting `Connect`)
- **Provider-First Dashboard UI**:
  - Preserve the clean hairline List/Grid layout (`Design.md`).
  - **Percentage / Capped pools**: Render `%` + progress bar + `5h / Weekly / Resets ...` metadata line + `Bar` Status Bar toggle.
  - **Uncapped Balance pools**: Render `$10.00` (tabular-nums) + subtle `Balance · Set budget cap in settings for % bar` (or clean `USD balance`) + `Bar` Status Bar toggle (Status Bar shows e.g. `DS $10.00` or `OR $4.50`!).
  - **Unconnected Key-Based Providers**:
    - Do not clutter the top of the active list if the user hasn't connected them—render a clean compact row at the bottom (or under `Not Connected` / `Connect` chip) with a crisp `Connect` button (`data-connect-provider="..."`).
    - Connected providers render a subtle `Key` / `Disconnect` action in the provider header or Command Palette.
- **Status Bar (`StatusBarController`)**:
  - Generalize `statusBarProviders` from a fixed 4-item enum to `string[]` (supporting `'agy-gemini'`, `'agy-claude'`, `'claude'`, `'codex'`, `'openrouter'`, `'deepseek'`, `'cline'`, and custom provider IDs `'custom:<id>'`).
  - Format status text cleanly:
    - Percentage pools: `AGY: G 93%`, `CL 50%`, `CX 10%`, `CN 80%`
    - Balance pools: `OR $4.50` (or `OR 45%` if capped), `DS $10.00` (or `DS 50%` if capped)
    - Warning highlight (`<= 20%` remaining) applies to percentage-based and budget-capped pools; uncapped `$` balance pools warn when `balanceAmount <= 1` (or `=== 0`).

---

### FR-4: Secret Management & Commands
- **New Commands**:
  - `quotadeck.connectProvider`: QuickPick to choose provider (`OpenRouter`, `DeepSeek`, `Cline`, or configured Custom Provider secret) → `showInputBox({ password: true, ignoreFocusOut: true })` → store in `context.secrets.store(...)` → trigger immediate refresh.
  - `quotadeck.disconnectProvider`: QuickPick to choose connected provider → `context.secrets.delete(...)` → refresh.
- **Webview Actions**:
  - Clicking `Connect` on a provider row posts `{ command: 'connectProvider', providerId }` to extension host (never collects secrets inside Webview HTML inputs).
  - Clicking `Disconnect` posts `{ command: 'disconnectProvider', providerId }`.

---

## 3. Non-Functional Requirements & Invariants
- **NFR-1 (Zero Secrets in Settings/Logs/Git)**: API keys live exclusively in `vscode.SecretStorage`; never logged to `OutputChannel` or echoed in error messages.
- **NFR-2 (Cross-Platform)**: Works identically on macOS, Linux, Windows, and WSL (no native SQLite/C++ addons, `AbortController` timeouts on all HTTP calls, `windowsHide: true` on CLI calls).
- **NFR-3 (Strict Webview Security)**: CSP `default-src 'none'`, cryptographic `nonce`, HTML escaping on all user-defined strings (including custom provider names, currencies, notes).
- **NFR-4 (Low Cognitive Load)**: Unconnected key-based providers never flood the Status Bar or show error popups; they wait quietly until connected.
- **NFR-5 (Strict Disposal)**: All new commands, secret-change listeners, and disposables pushed to `context.subscriptions`.
