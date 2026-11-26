# Rules & Invariants — VS Code Extensions Monorepo

## Must
- [User Confirmed | 2026-11-25] Use `bun` as the package manager and workspace runner.
- [User Confirmed | 2026-11-25] Store extensions inside `extensions/<name>`.
- [User Confirmed | 2026-11-25] Use `"most-too"` as the default `publisher` in `package.json`.
- [User Confirmed | 2026-11-26] When running `/grill-me` or asking design decisions, ALWAYS use the `ask_question` tool (interactive panel), one question at a time, with a recommended option first. Never ask in plain text only.
- [User Confirmed | 2026-11-26] Do NOT use decorative emojis or AI-generated-sounding phrasing/clichés in UI, Status Bar, documentation, or copy. Use clean minimalist text, tabular numbers, crisp SVG icons (in Webviews), or VS Code Codicons (in native VS Code UI).
- [User Confirmed | 2026-11-26] Progressive Disclosure & Low Cognitive Load (UX Rule): Do NOT clutter primary UI surfaces with technical details users don't need at a glance (e.g. raw file paths, internal filenames, verbose token breakdowns). Show only the primary decision metric (`% remaining`, reset time) by default, and reveal technical details (paths, exact token counts) on hover/tooltip only.
- [Skill Invariant | 2026-11-25] Push all disposables to `context.subscriptions`.
- [Skill Invariant | 2026-11-25] Bundle extensions to `dist/extension.js` via `esbuild`.
- [Skill Invariant | 2026-11-25] Include `.vscodeignore` in every extension to prevent bloating `.vsix`.

## Must Not
- Do not use `activationEvents: ["*"]` without strong architectural justification.
- Do not use npm or yarn to install packages unless explicitly requested (stick to `bun`).
- Do not commit secrets, tokens (e.g., VSCE Personal Access Tokens), or compiled `.vsix` files to git.

## Approved Commands
- `bun install`
- `bun run compile`
- `bun run --cwd extensions/<name> compile`
- `bun run --cwd extensions/<name> watch`
- `bun run --cwd extensions/<name> package`
