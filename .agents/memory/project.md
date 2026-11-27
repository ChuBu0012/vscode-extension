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
- **Completed (`quotadeck` v0.3.1 — Smart Reload, Mini Donut & Clean Controls — 2026-11-27)**:
  1. Added Dashboard `Reload: 30s / 1m / 5m / 10m` selector (`#pollIntervalSelect`, min `30s`) + `Smart` toggle (`#smartPollBtn`, `quotadeck.smartPolling`) and live `#updatedAt` status (`Active 1m (Smart)` / `Auto 5m` / `Idle 10m` / `Fixed 30s`).
  2. Implemented `hasQuotaOrBalanceDrop` & `computeSmartPollDelay` (`1m` burst on drop, 3-poll quiet cooldown, then baseline + `1x -> 2x -> 4x` backoff).
  3. Refined UI restraint: minimal borderless `18px` Weekly mini donut rings, chart-only semantic colors, and removed `#limitSortSelect` + `#statusFilterChips`.
  4. Configured `.github/workflows/release.yml` for Visual Studio Marketplace Trusted Publishing (`id-token: write` + `vsce publish --oidc`) and created `.agents/skills/vscode-publishing/SKILL.md`.
- **Planned (Upcoming)**: Monitor `quotadeck-v0.3.1` GitHub Release & Marketplace OIDC publish; optional Wave 2 providers or 1-click custom endpoint presets later.
