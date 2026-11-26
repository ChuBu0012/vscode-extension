# Tasks & Implementation Checklist — `quotadeck`

## Phase 1: Baseline & Public Release (v0.1.0 – v0.1.1) — Done
- [x] Core providers: `AntigravityProvider`, `ClaudeCodeProvider`, `CodexProvider`
- [x] `HistoryStore` (NDJSON append, compaction, Windows file-lock fallback) & `PollingPolicy` (backoff + reset wakeup)
- [x] Provider-first List/Grid Dashboard UI with inline Status Bar toggles, filters, sorting, and `Left / Used` mode
- [x] Cross-platform hardening (Windows `agy.cmd`/`windowsHide`, `CLAUDE_CONFIG_DIR`, disposal timer guard)
- [x] Public branding (`pornput-s.quotadeck`), `LICENSE`, `CHANGELOG.md`, Marketplace `README.md`, and Open VSX v0.1.1 publish

---

## Phase 2: Wave 1 Official REST API Providers & Custom Providers (v0.2.0)

| ID | Task | Status | Acceptance Criteria & Verification |
|---|---|---|---|
| **T1** | Extend domain types & config schema (`types.ts`, `config.ts`, `configValidation.ts`, `package.json`) | `[x]` | `ModelPoolSnapshot` supports `balanceAmount`, `balanceCurrency`, `budgetCapAmount`; `ProviderStatus` supports `'not_connected'`; `MonitorConfig` includes `budgets` and `customProviders`; `statusBarProviders` accepts dynamic `string[]`. |
| **T2** | Implement `SecretStore` wrapper (`src/secrets.ts`) & Connect/Disconnect flows (`extension.ts`) | `[x]` | Uses `context.secrets` (`vscode.SecretStorage`); adds `quotadeck.connectProvider` & `quotadeck.disconnectProvider` commands; secrets never logged or written to `settings.json`. |
| **T3** | Implement `OpenRouterProvider` (`src/providers/openRouterProvider.ts`) | `[x]` | Queries `/api/v1/key` (and `/api/v1/credits`); handles capped keys, uncapped keys + `budgetCapUsd`, `401`, and cached fallback. Unit tests in `test/openRouterProvider.test.ts`. |
| **T4** | Implement `DeepSeekProvider` (`src/providers/deepSeekProvider.ts`) | `[x]` | Queries `/user/balance`; parses `balance_infos` (`USD`/`CNY`), `is_available`, and optional `budgetCapUsd`; handles `401`/`402`. Unit tests in `test/deepSeekProvider.test.ts`. |
| **T5** | Implement `ClineProvider` (`src/providers/clineProvider.ts`) | `[x]` | Queries `/api/v1/users/me/plan/usage-limits` + `/users/me` + `/balance`; maps 5h/weekly quotas & balance cleanly. Unit tests in `test/clineProvider.test.ts`. |
| **T6** | Implement `CustomProviderRunner` (`src/providers/customProviderRunner.ts`) | `[x]` | Validates HTTP (`https` or `localhost` only) & CLI (`execFile`, timeout cap); prototype-safe `extractJsonPath`; injects `SecretStorage` token safely. Unit tests in `test/customProviderRunner.test.ts`. |
| **T7** | Upgrade `StatusBarController` (`src/ui/statusBar.ts`) | `[x]` | Formats both `%` and `$` balances cleanly; supports dynamic built-in + `custom:*` keys; updates tooltip sections & warning highlights. |
| **T8** | Upgrade `DashboardPanel` (`src/ui/dashboardPanel.ts`) | `[x]` | Displays balance amounts (`$10.00`), optional budget cap bars, `Connect`/`Disconnect` buttons for key-based providers, and dynamic Status Bar toggles while keeping the clean Provider-first layout. |
| **T9** | Update `README.md`, `CHANGELOG.md`, and `package.json` (`0.2.0`) | `[x]` | Document OpenRouter, DeepSeek, Cline, Budget Caps, `SecretStorage` onboarding, and `quotadeck.customProviders` examples. |
| **T10** | Full verification & release | `[x]` | `bunx tsc --noEmit`, `bun test` (41 pass, 0 fail), `bun run package` (`quotadeck-0.2.0.vsix`), local `code --install-extension`. |
