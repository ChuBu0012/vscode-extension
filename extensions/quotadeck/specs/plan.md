# Technical Plan — `quotadeck` (Phase 2: Official APIs & Custom Providers)

## 1. Architecture & Target Module Layout
```
extensions/quotadeck/src/
├── extension.ts                     # Activation, SecretStorage wiring, connect/disconnect commands, polling
├── config.ts                        # Read quotadeck.* settings (budgets, customProviders, dynamic statusBarProviders)
├── configValidation.ts              # Sanitize polling interval, budget caps, and customProviders schema
├── secrets.ts                       # [NEW] Typed wrapper over vscode.SecretStorage (get/set/delete/has)
├── timeFormat.ts                    # Timestamp parsing & human countdown formatting
├── types.ts                         # Extended ModelPoolSnapshot, ProviderSnapshot, BudgetConfig, CustomProviderConfig
├── pollingPolicy.ts                 # Adaptive backoff (1x -> 2x -> 4x) & reset-aware wakeup
├── providers/
│   ├── antigravityProvider.ts       # Existing local agy CLI provider
│   ├── claudeProvider.ts            # Existing Anthropic OAuth usage provider
│   ├── codexProvider.ts             # Existing Codex wham/usage provider
│   ├── openRouterProvider.ts        # [NEW] GET /api/v1/key & /api/v1/credits
│   ├── deepSeekProvider.ts          # [NEW] GET /user/balance
│   ├── clineProvider.ts             # [NEW] GET /api/v1/users/me/plan/usage-limits & balance
│   └── customProviderRunner.ts      # [NEW] Safe HTTP/CLI custom provider executor + prototype-safe JSONPath
├── storage/
│   └── historyStore.ts              # NDJSON snapshot store + Windows-safe compaction
└── ui/
    ├── statusBar.ts                 # Dynamic status bar formatting (% and $ balance) + Markdown tooltip
    └── dashboardPanel.ts            # Provider-first List/Grid Webview + Balance rendering + Connect/Disconnect actions
```

---

## 2. Key Technical Design Decisions

### 2.1 Dynamic Status Bar Keys & Backward Compatibility
- Change `StatusBarProviderKey` from a closed union to `string` while preserving default `['agy-gemini', 'claude', 'codex']`.
- In `package.json`, change `quotadeck.statusBarProviders.items` from strict `enum` to `type: "string"` (with `examples` or description documenting built-ins + `custom:<id>`), so VS Code doesn't show schema validation warnings when users pin `openrouter`, `deepseek`, `cline`, or `custom:*`.
- Map `(providerId, poolId)` → `statusBarKey` cleanly via a single helper shared/aligned between `StatusBarController` and `DashboardPanel`:
  - `agy` / `agy-gemini` → `agy-gemini` (`AGY: G`)
  - `agy` / `agy-claude` → `agy-claude` (`AGY-C`)
  - `claude` / `claude-main` → `claude` (`CL`)
  - `codex` / `codex-main` → `codex` (`CX`)
  - `openrouter` / `openrouter-main` → `openrouter` (`OR`)
  - `deepseek` / `deepseek-main` → `deepseek` (`DS`)
  - `cline` / `cline-main` → `cline` (`CN`)
  - `custom:<id>` → `custom:<id>` (shortCode uppercase)

### 2.2 Balance & Budget Cap Formatting
- Pure helper `formatPoolMetric(pool, mode, budgetCapUsd?)` (testable independently):
  - If `pool.remainingPct` is a number (either native `%` or computed from `budgetCapUsd`):
    - Returns `{ kind: 'pct', value: 0..100, isLow: remainingPct <= 20 }`.
  - Else if `pool.balanceAmount` is a number:
    - Returns `{ kind: 'balance', formatted: formatCurrency(balanceAmount, balanceCurrency), isLow: balanceAmount <= 1 }`.
- `HistoryStore`: Only records numeric `remainingPct` for providers that have a percentage (`typeof remainingPct === 'number'`); balance-only providers without a budget cap do not skew the percentage history average.

### 2.3 `SecretStorage` & Onboarding Flow
- `SecretStore` keys:
  - `quotadeck.key.openrouter`
  - `quotadeck.key.deepseek`
  - `quotadeck.key.cline`
  - `quotadeck.secret.<customId>` (for custom providers)
- In `DashboardPanel`:
  - Providers returning `status: 'not_connected'` render cleanly in a subtle secondary row (or under `All` tab) with a crisp `Connect` button (`data-connect-provider`).
  - Clicking `Connect` sends `{ command: 'connectProvider', providerId }` → `extension.ts` runs `connectProviderFlow(providerId)` using `vscode.window.showInputBox({ password: true, prompt: ... })` → saves to `SecretStorage` → refreshes immediately.
  - Note: Never keep `showInformationMessage` popups; show status directly in the Dashboard and Status Bar.

### 2.4 Custom Provider Security & Validation
- `sanitizeCustomProviders(raw)` in `configValidation.ts`:
  - Validates `id` (`/^[a-z0-9][a-z0-9-_]{0,31}$/`), `name`, `shortCode` (1–4 chars), `kind` (`'http' | 'cli'`).
  - For `'http'`: parses via `new URL(url)` and enforces `protocol === 'https:'` OR (`protocol === 'http:'` and `hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'`).
  - For `'cli'`: splits or executes `command` + `args[]` via `execFile` (`windowsHide: true`, timeout clamped `[1000, 15000]`). Never uses shell interpolation on untrusted arguments.
- `extractJsonPath(root, dotPath)`:
  - Splits `dotPath` by `.` and iterates safely, rejecting `__proto__`, `constructor`, `prototype`, and supporting numeric array indices (`balance_infos.0.total_balance`).

### 2.5 Testing & Verification Strategy
- **Unit tests (`bun test`)** using dependency injection (mock `fetch`, mock `SecretStore`, mock `execFile`):
  - `test/openRouterProvider.test.ts`: key with limit, unlimited key + credits, budget cap override, 401/network fallback, missing key (`not_connected`).
  - `test/deepSeekProvider.test.ts`: USD/CNY balance parsing, `is_available: false`, optional `budgetCapUsd` percentage calculation, 401/402 handling.
  - `test/clineProvider.test.ts`: 5h/weekly usage limits, pay-as-you-go balance fallback, 401/network handling.
  - `test/customProviderRunner.test.ts`: URL protocol validation (`https` vs remote `http` rejected, `localhost` allowed), prototype-pollution-safe `extractJsonPath`, `percentage` / `used_percentage` / `balance_usd` extraction, CLI timeout & error handling.
  - `test/uiAndExtension.test.ts`: Balance display (`$10.00`), `Connect` button message flow, dynamic Status Bar text (`OR $4.50 | DS $10.00`).
- **Build & Packaging**:
  - `bunx tsc --noEmit`
  - `bun test`
  - `bun run compile` & `bun run package`
