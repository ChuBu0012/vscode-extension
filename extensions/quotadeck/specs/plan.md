# Technical Plan — `quotadeck`

## 1. Architecture & Module Boundaries
```
src/
├── extension.ts               # Activation, wiring, polling timer, commands, strict disposal
├── config.ts                  # Typed config reader + input sanitization/validation
├── calibration.ts             # Pure, testable 7d -> 5h cap estimation logic
├── types.ts                   # Domain types + computeRemainingPct / averageRemainingPct
├── providers/
│   ├── claudeProvider.ts      # Async JSONL scanner (~/.claude/projects) with injectable baseDir
│   ├── codexProvider.ts       # Async JSONL scanner (~/.codex/sessions) with injectable baseDir
│   └── antigravityProvider.ts # Async agy CLI + transcript scanner with injectable deps
├── storage/
│   └── historyStore.ts        # Serialized NDJSON append + compaction + safe readRecent
└── ui/
    ├── statusBar.ts           # Right StatusBarItem + MarkdownString tooltip
    └── dashboardPanel.ts      # WebviewPanel, strict CSP, validated messaging, Design.md UI
```

## 2. Key Technical Improvements & Hardening
1. **Testability via Dependency Injection**:
   - `ClaudeCodeProvider(baseDir?)`, `CodexProvider(baseDir?)`, `AntigravityProvider(options?)` accept optional paths/fetchers defaulting to `os.homedir()` and `execFile('agy', ['models'])`.
   - Extract `calibrateCapsFromSnapshots` into `src/calibration.ts` as a pure function.
2. **Accurate Rolling Window & Memory Safety**:
   - In `ClaudeCodeProvider`, filter individual JSONL entries by `parsed.timestamp` when present (falling back to file `mtimeMs` if absent) so multi-day session files don't inflate the 5h window.
   - In `AntigravityProvider`, cap or safely inspect large `transcript.jsonl` files without crashing on huge buffers, and use case-insensitive matching for `claude` / `hydrogen`.
3. **HistoryStore Compaction & Serialization**:
   - Queue writes sequentially via a promise chain to prevent interleaved NDJSON lines.
   - Compact `history.ndjson` when line count exceeds `MAX_HISTORY_LINES` (2000), keeping the most recent 2000 entries.
   - Validate parsed `HistoryPoint` objects in `readRecent`.
4. **Webview & Message Security**:
   - Validate all incoming Webview messages (`saveCaps` finite positive integers clamped to `[1000, 100_000_000]`, `changeWindow` clamped to `[1, 720]`).
   - Track `onDidReceiveMessage` and `onDidDispose` disposables inside `DashboardPanel` and dispose them on panel close/extension dispose.
   - Remove dead duplicate `#settingsModal` DOM elements so all IDs are unique.
5. **UI Parity with `Design.md` & Mockup**:
   - Add Top Nav Tabs (`Overview`, `Settings`), `⌘K` Search/Filter input, `Recent` / `24h` / `7d` history range selector, interactive chart popover, `Recent Sessions` / `All Model Pools` segmented list, Reset Countdown footer, active preset pill highlighting, and calibration status feedback.

## 3. Verification Strategy
- **Unit Tests (`bun test`)**:
  - `test/claudeProvider.test.ts`
  - `test/codexProvider.test.ts`
  - `test/antigravityProvider.test.ts`
  - `test/historyStore.test.ts`
  - `test/calibration.test.ts`
  - `test/typesAndConfig.test.ts`
- **Typecheck**: `./extensions/quotadeck/node_modules/.bin/tsc -p extensions/quotadeck/tsconfig.json --noEmit`
- **Bundle**: `bun run --cwd extensions/quotadeck compile` & `compile:prod`
- **Package**: `bun run --cwd extensions/quotadeck package` (`.vsix` generation, then clean up `.vsix` if untracked/not meant to be committed per `rules.md`).
