# Tasks & Completion Evidence — `quotadeck`

| ID | Task | Status | Evidence |
|---|---|---|---|
| T1 | Author spec-kit (`spec.md`, `plan.md`, `tasks.md`) & update `.vscodeignore` | `[x]` | `extensions/quotadeck/specs/{spec,plan,tasks}.md` & `.vscodeignore` (`specs/**`, `test/**` excluded) |
| T2 | Extract & harden `src/calibration.ts`, `src/configValidation.ts`, `src/sanitize.ts` | `[x]` | Extracted pure functions with `NaN`/`Infinity` clamping & config validation |
| T3 | Harden `ClaudeCodeProvider`, `CodexProvider`, `AntigravityProvider` (DI, timestamp windowing, edge cases) | `[x]` | Per-entry timestamp windowing, tail-sampling, DI paths for testing |
| T4 | Harden `HistoryStore` (write serialization, compaction at `MAX_HISTORY_LINES`, schema guard) | `[x]` | Serialized queue + compaction at `MAX_HISTORY_LINES` + malformed line guard |
| T5 | Upgrade `DashboardPanel` UI to match `Design.md` & mockup (Search `⌘K`, History range, Popover, Segmented list, Reset footer, Preset highlight, remove duplicate modal IDs, dispose listeners) | `[x]` | `src/ui/dashboardPanel.ts` updated with full feature parity & `disposePanelResources()` |
| T6 | Add comprehensive `bun test` unit test suite (providers, historyStore, calibration, types/config) | `[x]` | 17 tests across 6 files in `extensions/quotadeck/test/*.test.ts` (17 pass, 0 fail) |
| T7 | Security & robustness audit (CSP, message validation, disposal, async I/O, progressive disclosure) | `[x]` | Verified strict CSP nonce, `onDidReceiveMessage` disposal, `settingsModal` removed |
| T8 | Run `tsc --noEmit`, `bun test`, `bun run compile`, `bun run package`, and update `.agents/memory/project.md` | `[x]` | `tsc --noEmit` 0 errors, `bun test` 17/17 pass, `bun run compile` OK, `vsce package` 16.56 KB `.vsix` |
