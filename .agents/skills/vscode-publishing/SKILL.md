---
name: vscode-publishing
description: Publish, package, or release VS Code extensions to Visual Studio Marketplace (vsce, Trusted Publishing OIDC, PAT) and Open VSX (ovsx). Use when auditing manifest/vsix readiness, running package/publish commands, configuring GitHub Actions release workflows, shipping pre-releases, or diagnosing inactive/rejected registry releases.
---

# VS Code Extension Publishing

Workflow for packaging `.vsix` artifacts and publishing safely to **Visual Studio Marketplace** and **Open VSX Registry** based on official VS Code publishing rules (`code.visualstudio.com/api/working-with-extensions/publishing-extension`).

## 1. Pre-Publish Gate (Checkable Criteria)

Complete every check before running `vsce publish` or `ovsx publish`:

1. **Manifest (`package.json`)**:
   - `publisher` matches registered Marketplace / Open VSX publisher ID (`pornput-s`).
   - `version` is bumped strictly higher than the latest live registry version (`SemVer`).
   - `categories` use official VS Code categories only (`AI`, `Visualization`, `Other`, etc.); `keywords` count `<= 30`.
   - `icon` points to a crisp PNG (`>= 128x128`, never `.svg`); `repository`, `homepage`, `bugs`, `license`, `README.md`, and `CHANGELOG.md` are present and free of relative broken links.
2. **Packaging Hygiene (`.vscodeignore`)**:
   - Exclude `src/**`, `test/**`, `specs/**`, `.vscode/**`, `tsconfig.json`, `esbuild.js`, `**/*.map`, `node_modules/**`, `.env*`, and old `*.vsix` archives.
3. **Clean Build & Tests**:
   - Run full typecheck (Extension Host + Webview), unit tests, and production bundle compile (`esbuild --production`), then run `bunx @vscode/vsce package --no-dependencies` (use `--no-dependencies` in Bun workspaces to avoid `npm list` failures) and inspect the printed file list and `.vsix` size.
   - Secret safety: never read, print, or commit `.env`, `VSX_TOKEN`, `OVSX_PAT`, or `VSCE_PAT`.

## 2. Choose the Publishing Path

### A. Visual Studio Marketplace — Trusted Publishing OIDC (Recommended for CI)
Secretless GitHub Actions publishing without long-lived Azure DevOps PATs:
1. In **Visual Studio Marketplace Publisher Management** (`https://marketplace.visualstudio.com/manage`) -> **Trusted Publishing** -> **Create**:
   - Set **Repository owner**, **Repository**, **Workflow** (exact `.github/workflows/<file>.yml` filename), and optional **Environment**.
2. In the GitHub Actions job:
   - Grant `permissions: { contents: read, id-token: write }`.
   - Run `@vscode/vsce >= 4.0.2` with `--oidc`:
     ```bash
     bunx @vscode/vsce@latest publish --oidc --packagePath extensions/<name>/<name>-<version>.vsix
     ```
3. **First-time caveat**: A brand-new extension must exist in Visual Studio Marketplace (initial `.vsix` upload via web UI or PAT) before OIDC updates can match and publish subsequent versions.

### B. Visual Studio Marketplace — PAT (Local CLI or Fallback CI)
- Generate an Azure DevOps Personal Access Token with **Organization: All accessible organizations** and scope restricted strictly to **Marketplace -> Manage**.
- Local CLI: `bunx @vscode/vsce login <publisher>` then `bunx @vscode/vsce publish --no-dependencies` (or `--packagePath <file>.vsix -p "$VSCE_PAT"`).

### C. Open VSX Registry (`ovsx` — Cursor, Windsurf, Antigravity, VSCodium)
- Publish packaged archive cleanly using token env var:
  ```bash
  set -a && . ./.env && set +a && bunx ovsx publish extensions/<name>/<name>-<version>.vsix -p "$VSX_TOKEN"
  ```
- Remember Microsoft VS Code searches Visual Studio Marketplace, while Cursor / Windsurf / Antigravity search Open VSX.

### D. Pre-Release Builds
- Pass `--pre-release` (`vsce publish --pre-release` / `ovsx publish` when supported) for preview tracks.
- Follow VS Code's SemVer convention: **odd** minor numbers for pre-releases (`0.3.x`), **even** minor numbers for stable (`0.4.x`).

## 3. Post-Publish Verification

1. Query registry API to confirm the new version flipped active and downloadable:
   - Open VSX: `curl -sL "https://open-vsx.org/api/<publisher>/<name>/<version>"` (if Open VSX shows strikethrough `universal` in UI or `"downloadable": false`, wait 5–15 minutes for the async security scan queue; delete stale inactive versions only if stuck long-term before re-publishing).
2. Confirm GitHub Release assets (`.vsix`) match the exact published tag so standard VS Code users can install via `Install from VSIX...` when Marketplace listing is pending.
