# vscode-extensions

A modern Visual Studio Code extensions monorepo powered by Bun, TypeScript, and esbuild.

## 📁 Repository Structure
```
.
├── Design.md                  # UI/UX Design System & layout tokens
├── docs/                      # Interactive Guides & Documentation
│   ├── ai-usage-monitor-mockup.html # UI Mockup (QuotaDeck)
│   ├── quick-guide.html       # คู่มือฉบับย่อ สรุปทางลัดใน 1 หน้า
│   └── vscode-extension-fundamentals.html # คู่มือพื้นฐานฉบับสมบูรณ์
├── AGENTS.md                  # Agent rules and extension invariants
├── extensions/                # VS Code Extensions
│   ├── quotadeck/             # QuotaDeck — AI Usage & Limits
│   └── starter-extension/     # Baseline template extension
├── .agents/
│   ├── memory/                # Project memory (project.md, rules.md)
│   └── skills/                # Agent skills (vscode-extension-creator)
├── package.json               # Bun monorepo workspace configuration
└── tsconfig.base.json         # Shared TypeScript compiler options
```

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (v1.0+)
- [Visual Studio Code](https://code.visualstudio.com/)

### Install Dependencies
```bash
bun install
```

### Build Extensions
```bash
# Build all extensions
bun run compile

# Build specific extension
bun run --cwd extensions/starter-extension compile
```

### Package into `.vsix` (Share with friends)
```bash
bun run --cwd extensions/starter-extension package
```
Install in VS Code:
1. Open VS Code Extensions view (`Cmd+Shift+X` or `Ctrl+Shift+X`).
2. Click `...` (Views and More Actions) at the top right.
3. Select **Install from VSIX...** and pick the generated `.vsix` file.
