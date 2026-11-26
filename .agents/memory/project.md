# Project Memory — VS Code Extensions Monorepo

## Purpose & Goal
Build customized, high-utility VS Code extensions for personal use and developer workflows, with the ability to cleanly package and share them with friends via `.vsix` or publish them to the VS Code Marketplace.

## Architecture & Stack
- **Architecture**: Monorepo with Bun workspaces (`extensions/*`).
- **Package Manager**: Bun (`bun` v1.3.1).
- **Runtime / Bundler**: TypeScript (ES2022 / Node16) + esbuild.
- **Packaging**: `@vscode/vsce` producing `.vsix` artifacts.
- **Publisher**: `pornput-s` (`author`: `pornput.s`).

## Current State
- Monorepo infrastructure established.
- `extensions/starter-extension` created as the baseline template.
- Root configuration (`package.json`, `tsconfig.base.json`, `.vscode/launch.json`, `.vscode/tasks.json`) configured.
- Comprehensive HTML guide created: `docs/vscode-extension-fundamentals.html`.
- Quick guide created: `docs/quick-guide.html` (1-page cheatsheet with custom theme).
- Design system initialized: `Design.md` (Swiss-grid hairline layout, Light/Dark VS Code token mappings).
- Interactive UI mockup updated: `docs/ai-usage-monitor-mockup.html` (matching `Design.md`).

## Active Extensions
1. `starter-extension`: Template & baseline reference.
2. `quotadeck` (`QuotaDeck — AI Usage & Limits`, renamed from `ai-usage-monitor`): Monitors exact quotas for **Antigravity** (`5h` + `Weekly` via `agy` CLI), **Claude Code** (Anthropic OAuth Usage API), and **Codex** (`~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage`). Includes global **Left / Used** toggle (`quotadeck.displayMode`), configurable inline **Status Bar Visibility** (`quotadeck.statusBarProviders`), friendly `<= 20%` warning color, Adaptive Backoff Polling (`1x -> 2x -> 4x`, max 30m), Provider-First List/Grid Dashboard with Sort/Filter + collapsible `Usage History`, and `256x256` `resources/icon.png`.

## Next Steps
- **Completed (`quotadeck` v0.2.0 — 2026-11-26)**:
  1. Added `SecretStore` (`src/secrets.ts`) + `quotadeck.connectProvider` / `quotadeck.disconnectProvider` commands, `+ Add Agent` QuickPick/InputBox wizard (for API keys, local agent re-checks, and custom endpoints), inline loading feedback, and Status Bar messages (`setStatusBarMessage`).
  2. Implemented `OpenRouterProvider`, `DeepSeekProvider`, `ClineProvider`, and `CustomProviderRunner` (`quotadeck.customProviders` HTTP `https`/`localhost` + CLI `execFile` + prototype-safe `extractJsonPath`).
  3. Updated local auto-detection (`AntigravityProvider`, `ClaudeCodeProvider`, `CodexProvider`) to mark missing binaries/credentials as `not_connected`, hide them from the Dashboard, skip them in background auto-polls, and allow manual re-checks via `+ Add Agent` or `Refresh`.
  4. Verified `tsc --noEmit`, `bun test` (43 pass, 0 fail), `bun run package` (`quotadeck-0.2.0.vsix`), local `code --install-extension --force`, committed & pushed `v0.2.0` (`193f684`), and published `pornput-s.quotadeck v0.2.0` to Open VSX.
  5. Updated SEO/AEO metadata and documentation (`extensions/quotadeck/package.json`, `extensions/quotadeck/README.md`, `extensions/quotadeck/CHANGELOG.md`, root `README.md`, `llms.txt`, `llms-full.txt`).
- **Planned (Upcoming)**: Optional Wave 2 providers (e.g. GitHub Copilot / Cursor) or Visual Studio Marketplace publishing if requested.
