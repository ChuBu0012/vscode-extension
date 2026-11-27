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
- **Completed (`quotadeck` v0.3.0 — Analytics & Pacing — 2026-11-27)**:
  1. Added `src/pacing.ts` (`computeWindowPacing`, `computePoolPacing`) for window-based burn-rate pacing (`On pace`, `Elevated`, `Fast · ~Xh left`) surfaced on Dashboard pool cards & tooltips.
  2. Added `quotadeck.lowThresholdPct` (default `20`) and `quotadeck.lowBalanceUsd` (default `1`) settings applied consistently across `StatusBarController`, Dashboard `Low` filters, progress bars, and Weekly Donut tones.
  3. Upgraded `HistoryStore` to store backward-compatible per-pool `5h`, `weekly`, and USD balance snapshots, plus `All Windows / 5h Window / Weekly Window` filtering and USD hover tooltips in Usage History.
  4. Previously committed, pushed (`cf499f6`), and published `v0.2.2` to Open VSX before starting `v0.3.0`.
- **Planned (Upcoming)**: Commit & release `v0.3.0` via tag/Open VSX once verified by user; optional 1-click presets or Wave 2 providers later.
