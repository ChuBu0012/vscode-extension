# vscode-extension

A Visual Studio Code and Open VSX extensions monorepo powered by Bun, TypeScript, and esbuild.

## Flagship Extension: QuotaDeck

**[QuotaDeck — AI Usage & Limits](extensions/quotadeck/README.md)** (`pornput-s.quotadeck`) monitors exact 5-hour/weekly AI coding rate limits and credit balances across **Antigravity**, **Claude Code**, **Codex**, **OpenRouter**, **DeepSeek**, **Cline / ClinePass**, and user-defined HTTP/CLI endpoints directly inside the editor Status Bar and Dashboard Webview.

- Registry: [Open VSX (`pornput-s/quotadeck`)](https://open-vsx.org/extension/pornput-s/quotadeck)
- Extension Docs: [extensions/quotadeck/README.md](extensions/quotadeck/README.md)
- Changelog: [extensions/quotadeck/CHANGELOG.md](extensions/quotadeck/CHANGELOG.md)
- AI / Answer Engine Index: [llms.txt](llms.txt) | [llms-full.txt](llms-full.txt)

## Repository Structure

```text
.
├── AGENTS.md                        # Monorepo invariants & extension engineering rules
├── Design.md                        # Swiss-grid UI/UX design tokens (Light/Dark VS Code themes)
├── llms.txt                         # Answer Engine Optimization (llms.txt index)
├── llms-full.txt                    # Full machine-readable reference for LLMs & agents
├── docs/                            # Reference guides & UI mockups
│   ├── ai-usage-monitor-mockup.html
│   ├── quick-guide.html
│   └── vscode-extension-fundamentals.html
├── extensions/
│   ├── quotadeck/                   # QuotaDeck — AI Usage & Limits
│   └── starter-extension/           # Minimal baseline extension template
├── .agents/
│   ├── memory/                      # Project memory & confirmed constraints
│   └── skills/                      # Extension development skills
├── package.json                     # Bun monorepo workspace scripts
└── tsconfig.base.json               # Shared strict TypeScript configuration
```

## Development

### Prerequisites
- [Bun](https://bun.sh/) (`>= 1.0`)
- Visual Studio Code `^1.90.0` (or Cursor / Windsurf / Antigravity)

### Install, Typecheck, Test, Build & Package

```bash
# Install workspace dependencies
bun install

# Typecheck & run unit tests for QuotaDeck
cd extensions/quotadeck
bunx tsc --noEmit
bun test

# Bundle all extensions with esbuild
bun run compile

# Package QuotaDeck into a .vsix archive
bun run --cwd extensions/quotadeck package

# Install locally into VS Code
code --install-extension extensions/quotadeck/quotadeck-0.2.0.vsix --force
```

To install via the VS Code UI, open Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`), open the `...` menu, and select **Install from VSIX...**.
