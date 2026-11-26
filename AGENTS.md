# AGENTS.md — VS Code Extensions Monorepo

## Overview & Architecture
This repository is a **Monorepo for building personal & shareable Visual Studio Code extensions**.
Extensions reside in `extensions/<extension-name>/`.
Package manager & script execution: **Bun** (`bun`).
Bundler: **esbuild** (bundles into `dist/extension.js`).

## Non-Negotiable Extension Invariants
1. **Extension Host Single-Threaded Isolation**: Never perform CPU-intensive blocking synchronous work on the extension host.
2. **Strict Resource Disposal**: All subscriptions (`vscode.commands.registerCommand`, status bar items, event listeners, etc.) MUST be pushed to `context.subscriptions`. Never leave dangling listeners.
3. **Implicit Activation**: Do not use `activationEvents: ["*"]` unless absolutely mandatory. Prefer implicit activation via contribution points in `package.json`.
4. **Webview Security**: When building Webviews, enforce CSP nonces, use `webview.asWebviewUri()`, and restrict `localResourceRoots`.
5. **No Notification Spam**: Never show unsolicited popups via `vscode.window.showInformationMessage`. Use Status Bar items or Output Channels instead.
6. **Publisher ID**: Use `"most-too"` as the default `publisher` in each extension's `package.json`.

## Common Commands
Run from repository root or inside `extensions/<name>`:
- `bun install`: Install all workspace dependencies.
- `bun run compile`: Build all extensions via esbuild.
- `bun run --cwd extensions/<name> compile`: Build a single extension.
- `bun run --cwd extensions/<name> watch`: Watch mode for local development.
- `bun run --cwd extensions/<name> package`: Package into a `.vsix` file (outputs `extensions/<name>/<name>-<version>.vsix`).

## Creating a New Extension
When adding a new extension to this monorepo:
1. Create directory `extensions/<new-extension-name>`.
2. Reference the `vscode-extension-creator` skill (`.agents/skills/vscode-extension-creator/SKILL.md`) for appropriate contribution points and architecture.
3. Configure `package.json` with `publisher: "most-too"` and `main: "./dist/extension.js"`.
4. Extend root `tsconfig.base.json` in `extensions/<new-extension-name>/tsconfig.json`.
5. Include `esbuild.js` and `.vscodeignore`.
6. Verify build with `bun run --cwd extensions/<new-extension-name> compile`.

## Memory & State Tracking
- Keep `.agents/memory/project.md` updated with active extensions, current state, and backlog.
- Keep `.agents/memory/rules.md` updated with confirmed constraints and standards.
