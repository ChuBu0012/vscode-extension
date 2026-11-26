# Specification — `quotadeck`

## 1. Overview
`quotadeck` (QuotaDeck — AI Usage & Limits) is a VS Code extension that monitors usage limits and remaining model-pool quotas across local AI coding tools (**Claude Code**, **Codex**, and **Antigravity**) without requiring external API keys or causing notification spam.

## 2. Functional Requirements

### FR-1: Quota Providers (Non-Blocking Local Inspection)
- **FR-1.1 (`ClaudeCodeProvider`)**: Scans `~/.claude/projects/**/*.jsonl` within the configured rolling window (`windowHours`). Parses per-turn `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and 10% weighted `cache_read_input_tokens`) and timestamps when available, separating `Standard (Sonnet)` and `Fable / Opus` pools. Falls back to byte-size estimation (`bytes / 12`) if `usage` is absent.
- **FR-1.2 (`CodexProvider`)**: Recursively scans `~/.codex/sessions/**/*.jsonl` (bounded depth) within `windowHours` and estimates token usage (`bytes / 14`) into the `Standard Pool`.
- **FR-1.3 (`AntigravityProvider`)**: Queries `agy models` (cached for 10 minutes, 3s timeout, graceful fallback if CLI missing) and scans `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` within `windowHours`, separating `Gemini Pool` and `Claude Pool`.
- **FR-1.4 (Transparency & Graceful Degradation)**: Every provider returns `sourceKind: 'Exact' | 'Est.'`, `available: boolean`, and `note` when local directories are missing. Missing directories never throw unhandled errors.

### FR-2: History Persistence (`HistoryStore`)
- **FR-2.1**: Appends `HistoryPoint` snapshots to `history.ndjson` inside `context.globalStorageUri.fsPath`.
- **FR-2.2**: Serializes concurrent writes and compacts `history.ndjson` when exceeding `MAX_HISTORY_LINES` (2000) so disk usage remains bounded.
- **FR-2.3**: `readRecent(limit)` safely skips malformed NDJSON lines and invalid structures.

### FR-3: Calibration & Configuration
- **FR-3.1**: `calibrateCapsFromSnapshots(weekSnapshots)` estimates 5h window caps from 7-day (168h) local usage (`(used7d / 14) * 1.25` rounded to nearest 10,000, clamped to provider floor).
- **FR-3.2**: Configuration (`pollingIntervalSeconds`, `windowHours`, `caps.*`) is validated and sanitized before persisting to VS Code Global settings.

### FR-4: Status Bar (`StatusBarController`)
- **FR-4.1**: Displays compact glanceable summary on `vscode.StatusBarAlignment.Right`: `$(pulse) AI: C <pct>% | X <pct>% | A <pct>%`.
- **FR-4.2**: Hover tooltip (`MarkdownString`, `isTrusted = false`) lists per-provider, per-pool remaining %, token usage (`k`), and `Est.`/`Exact` source tag.
- **FR-4.3**: Clicking opens or reveals the Dashboard Webview.

### FR-5: Webview Dashboard (`DashboardPanel`) — Parity with `Design.md` & Mockup
- **FR-5.1**: **Top Navigation Strip**: Brand mark, view tabs (`Overview`, `Settings`), Search/Filter input (`⌘K` / `Ctrl+K` shortcut) filtering providers, pools, and sessions, Side Panel toggle (`Hide Panel` / `Show Panel`), and `Refresh` action.
- **FR-5.2**: **3-Cell Hairline KPI Strip**: Active Model Pools (with provider count), Lowest Pool Remaining % (with pool name & reset window), and Estimated Window Tokens (with active window label). Uses `tabular-nums`.
- **FR-5.3**: **Capacity Bar Chart + History Range Selector**: Supports switching chart range (`Recent`, `24h`, `7d`) and interactive hover/click popover showing exact timestamp, remaining %, and token usage.
- **FR-5.4**: **Bottom Segmented List**: Switches between `Recent Sessions` and `All Model Pools`, respecting the active search filter.
- **FR-5.5**: **Right Inspector Column**: Displays `Providers & Model Pools` with SVG icons, `Est.`/`Exact` badge, `4px` pool progress bars, and a **Reset Countdown / Window Footer** showing next window reset estimate and quick `Configure` button.
- **FR-5.6**: **Settings & Plan Limits View**: Auto-Calibrate (`Sync from Logs` with status feedback), Plan Preset pills (highlighting active matching preset), external official usage links (allowlisted `https://claude.ai/` and `https://chatgpt.com/`), and collapsible Advanced Custom Token Caps form (no duplicate DOM IDs).

## 3. Non-Functional Requirements & Invariants
- **NFR-1 (Webview Security)**: Strict CSP (`default-src 'none'`, `script-src 'nonce-<nonce>'`, `style-src ${webview.cspSource} 'unsafe-inline'`), input validation on all Webview → Extension messages, HTML escaping on all dynamic strings.
- **NFR-2 (Extension Host Isolation)**: 100% async file I/O (`fs/promises`) and async child process (`execFile` with timeout).
- **NFR-3 (Strict Disposal)**: All VS Code disposables (`StatusBarItem`, `WebviewPanel`, `onDidReceiveMessage`, `onDidDispose`, `onDidChangeConfiguration`, polling timer, `OutputChannel`) pushed to `context.subscriptions` or disposed cleanly on panel close.
- **NFR-4 (No Notification Spam / No Decorative Emojis)**: Zero `showInformationMessage` popups; zero decorative emojis; crisp SVG icons in Webview and Codicons in Status Bar.
- **NFR-5 (Progressive Disclosure)**: Primary UI shows `% remaining` and reset window; raw file paths and exact token counts appear in hover tooltips only.
