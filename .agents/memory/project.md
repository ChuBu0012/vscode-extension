# Project Memory — VS Code Extensions Monorepo

## Purpose & Goal
Build customized, high-utility VS Code extensions for personal use and developer workflows, with the ability to cleanly package and share them with friends via `.vsix` or publish them to the VS Code Marketplace.

## Architecture & Stack
- **Architecture**: Monorepo with Bun workspaces (`extensions/*`).
- **Package Manager**: Bun (`bun` v1.3.1).
- **Runtime / Bundler**: TypeScript (ES2022 / Node16) + esbuild.
- **Packaging**: `@vscode/vsce` producing `.vsix` artifacts.
- **Publisher**: `most-too`.

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
- **Completed (`quotadeck` Provider-First Main UI & Public Rename — 2026-11-26)**:
  1. Elevated the clean **Providers** sidebar view to be the single **Main UI** (removed cluttered KPI ring strip, search box, heavy nested `.window-card` boxes, and redundant side drawer).
  2. Renamed extension cleanly to `quotadeck` (`QuotaDeck — AI Usage & Limits`, `extensions/quotadeck`, `quotadeck.*` settings & commands) ready for public Marketplace release.
  3. Kept `List | Grid` layout toggle, `Left | Used` global toggle, Provider/Status filters, Sort (`Grouped`, `Tightest First`, `Most Available`, `Soonest Reset`, `Name A–Z`), inline Status Bar `Bar` switch per pool, and collapsible `Usage History`.
  4. Verified `tsc --noEmit`, `bun test`, `bun run compile`, `package` (`quotadeck-0.1.0.vsix`), uninstalled `most-too.ai-usage-monitor`, and installed `quotadeck-0.1.0.vsix`.
- **Planned (Upcoming)**: Discuss & implement Custom CLI/HTTP Providers per `extensions/quotadeck/specs/future-providers-plan.md`.
