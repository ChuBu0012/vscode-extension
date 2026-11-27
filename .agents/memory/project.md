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
- **Completed (`quotadeck` v0.2.2 — Architecture, CI/CD & Visual Polish — 2026-11-27)**:
  1. Added Weekly Limit Donut Chart (`data-weekly-donut`) + remaining-capacity color tiers (`> 50%` green, `21%–50%` amber, `<= 20%` warm coral) + full responsive layout across narrow/wide VS Code panels.
  2. Modularized Webview into `src/ui/webview/client.ts` + `src/ui/webview/styles.css` (bundled via `esbuild` into `dist/webview.js` + `dist/webview.css`, loaded via `webview.asWebviewUri()` + `localResourceRoots`).
  3. Extracted `src/flows/providerOnboarding.ts` out of `src/extension.ts`.
  4. Added GitHub Actions workflows (`.github/workflows/ci.yml` and `.github/workflows/release.yml` for GitHub Release `.vsix` + conditional Open VSX / VS Marketplace publish).
  5. Previous milestones (`v0.2.0` Wave 1 REST APIs + Custom Endpoints + `+ Add Agent`, `v0.2.1` SEO/AEO docs + `llms.txt`) published to Open VSX and pushed to `main`.
- **Planned (Upcoming)**: Optional `HistoryStore` per-pool granularity or Wave 2 providers (Copilot/Cursor) if requested.
