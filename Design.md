# Design.md — VS Code Extensions Design System

## 1. Design Philosophy
ระบบออกแบบ UI สำหรับ VS Code Extensions ใน Monorepo นี้ยึดแนวทาง **Minimalist Structural Grid**:
- **Hairline Grids over Heavy Cards**: ใช้เส้นแบ่งบาง `1px` แทนการซ้อนกล่องหรือเงาหนาๆ เพื่อให้หน้าจอดูโปร่ง สะอาด และอ่านข้อมูลได้เร็ว
- **Tabular Clarity**: ตัวเลขสถิติ เปอร์เซ็นต์ และ Token count ต้องใช้ `font-variant-numeric: tabular-nums` เพื่อให้อ่านเปรียบเทียบในแนวตั้งได้ตรงกัน
- **VS Code Native Harmony**: ใน Extension จริง Webview ต้องปรับสีตาม Theme ของผู้ใช้ผ่าน `var(--vscode-*)` โดยรองรับทั้ง **Light** และ **Dark** อย่างสมบูรณ์
- **Calm Status Signaling**: ไม่สแปม Popups ใช้ Status Bar ที่มุมขวาล่างสำหรับการมองผ่านๆ (Glanceable) และใช้ Dashboard สำหรับการวิเคราะห์เชิงลึก
- **No Decorative Emojis / No AI Clichés**: ห้ามใช้ Emoji ตกแต่งหรือข้อความสไตล์ AI ใน UI, Status Bar และเอกสาร ให้ใช้ SVG icons แบบเส้นบาง (stroke 1.5–1.75), ข้อความที่กระชับ, หรือ VS Code Codicons (เฉพาะใน Native VS Code UI) เท่านั้น
- **Progressive Disclosure (UX Rule)**: ห้ามแสดงข้อมูลเชิงเทคนิคที่ผู้ใช้ไม่จำเป็นต้องเห็นตลอดเวลา (เช่น raw file paths, ชื่อไฟล์ภายใน, หรือตัวเลขซ้ำซ้อน) บนหน้าหลัก ให้แสดงเฉพาะข้อมูลหลักที่ช่วยตัดสินใจ (`% remaining`, เวลา reset) ส่วนรายละเอียดเชิงลึกให้ซ่อนไว้แสดงเฉพาะตอน Hover (Tooltip) เท่านั้น

---

## 2. Color Tokens

### Light Palette (Default Reference Aesthetic)
| Token | Hex | Usage |
|---|---|---|
| `--bg-canvas` | `#ffffff` | พื้นหลังหลักของ Dashboard |
| `--bg-subtle` | `#f8fafc` | พื้นหลังแถบข้าง / hover row / input |
| `--bg-muted` | `#f1f5f9` | พื้นหลังปุ่มรอง / badge |
| `--border` | `#e5e7eb` | เส้นแบ่งโครงสร้าง `1px` |
| `--text-primary` | `#0f172a` | หัวข้อและตัวเลขหลัก |
| `--text-secondary` | `#64748b` | คำอธิบายและ label |
| `--text-faint` | `#94a3b8` | ข้อมูลเปรียบเทียบ / timestamp |
| `--accent` | `#1d6ff2` | Primary action, active bar, progress fill |
| `--accent-soft` | `#dbeafe` | Total capacity backdrop ในกราฟแท่ง |
| `--positive` | `#10b981` | Delta ขาขึ้น / Exact badge |
| `--warning` | `#f59e0b` | Estimated badge / ใกล้ถึง Limit |

### Dark Palette (VS Code Dark Adaptation)
| Token | Hex | VS Code Webview Mapping |
|---|---|---|
| `--bg-canvas` | `#0e1726` | `var(--vscode-editor-background)` |
| `--bg-subtle` | `#121e2d` | `var(--vscode-sideBar-background)` |
| `--bg-muted` | `#172638` | `var(--vscode-input-background)` |
| `--border` | `#1f2e42` | `var(--vscode-panel-border)` |
| `--text-primary` | `#f1f5f9` | `var(--vscode-editor-foreground)` |
| `--text-secondary` | `#94a3b8` | `var(--vscode-descriptionForeground)` |
| `--accent` | `#3b82f6` | `var(--vscode-button-background)` |
| `--accent-soft` | `rgba(59, 130, 246, 0.16)` | `var(--vscode-editor-selectionBackground)` |

---

## 3. Typography & Scale
- **UI Sans**: `"Sukhumvit Set", "Noto Sans Thai", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif`
- **Monospace**: `"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace`
- **Type Scale**:
  - Page Title (`h1`): `24px` / `700` / letter-spacing `-0.02em`
  - KPI Metric: `28px` / `600` / `tabular-nums`
  - Section Title: `15px` / `600`
  - Body & Table: `13px`–`14px` / `1.5`
  - Micro Labels & Badges: `11px`–`12px`

---

## 4. Layout Architecture (`ai-usage-monitor`)

1. **Top Navigation Strip** (`48px` height)
   - แท็บหลัก: `Overview`, `Providers`, `History`, `Logs`, `Settings` (มีเส้นขีดล่างสีเข้มใต้แท็บที่เลือก)
   - ด้านขวา: ช่องค้นหา (`⌘K`) + ปุ่ม Primary Action (`↻ Refresh`) + Theme Switcher (ใน Mockup)
2. **Asymmetric 2-Column Overview Grid** (`64% / 36%` split คั่นด้วยเส้นแบ่งแนวตั้ง `1px`)
   - **Left Column (Analytics & Activity)**:
     - Header + Period Selector (`Today`, `5h Window`, `7 Days`)
     - **3-Cell Hairline KPI Strip**: แบ่ง 3 ช่องด้วยเส้นแนวตั้ง แสดง Active Providers, Lowest Remaining %, และ Est. Tokens Today
     - **Capacity Bar Chart**: กราฟแท่งขอบมน (`border-radius: 10px`) แสดงพื้นหลังสีอ่อน (Cap 100%) ซ้อนด้วยแท่งสีทึบ (Used / Remaining) พร้อม Interactive Hover Popover
     - **Bottom List**: สลับดู `Sessions` หรือ `Providers` แบบ Compact Row
   - **Right Column (Provider Inspector & Model Pool Quotas)**:
     - Action Header (`Providers` + ปุ่ม `Refresh All`)
     - **Provider Rows**: แสดง SVG Icon, ชื่อ Provider, แหล่งข้อมูล (`~/.claude/`, `~/.codex/`, `~/.gemini/antigravity/`) และปุ่มสถานะ/ตั้งค่าทางขวา
     - **Model Pool Sub-bars**: หลอด Progress บาง `4px` แยกตาม Quota Pool ภายในแต่ละ Provider (เช่น Claude: `Standard` / `Fable (Opus)`, Antigravity: `Gemini` / `Claude`, Codex: `Standard`) พร้อม Footer แจ้งเวลา Reset ถัดไป
3. **Right Status Bar (`vscode.StatusBarAlignment.Right`)**
   - แสดงตัวเลขสั้นๆ เช่น `$(pulse) AI: C 74% | X 88% | A 62%` (ใช้ Codicon ไม่มี Emoji)
   - Hover Tooltip แสดงรายละเอียดแยกตาม Model Pool + ป้าย `Est.` / `Exact`
   - คลิกเพื่อเปิดหรือโฟกัสหน้า Dashboard

---

## 5. Data Reliability & Webview Security Rules
- **Transparency**: แสดงป้ายกำกับ `Exact` (ดึงจาก Official API/CLI) หรือ `Est.` (คำนวณจาก Local Logs เทียบกับ Cap) เสมอ
- **Webview Security**: เมื่อพัฒนาเป็น Extension จริง ต้องใช้ Strict CSP + Cryptographic Nonce, `localResourceRoots`, และ `webview.asWebviewUri()`
- **No Unsolicited Popups**: ห้ามเด้ง Notification แจ้งเตือนอัตโนมัติ ให้แสดงสถานะผ่าน Status Bar และ Dashboard เท่านั้น
