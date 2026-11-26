# Future Providers & Extensible Architecture Plan

> Status: Draft Plan (สำหรับหารือรายละเอียดร่วมกันในรอบถัดไป)

## 1. เป้าหมาย
ออกแบบระบบให้รองรับ Provider เพิ่มเติมนอกจาก `Antigravity` ได้แก่:
- **Claude Code** (`claude`)
- **Codex** (`codex`)
- **Custom / User-Added Providers** (Provider อื่นๆ ที่ผู้ใช้ต้องการเพิ่มเองในอนาคต เช่น Cursor, GitHub Copilot, OpenAI API, Anthropic API, OpenRouter, หรือ Local CLI/HTTP script)

## 2. UI Layout Readiness (รองรับแล้วใน Dashboard)
- **Dynamic Provider Filter Bar (`#providerFilterTabs`)**: สร้างแท็บ `All` + รายชื่อทุก Provider จาก `snapshots` อัตโนมัติ เมื่อเพิ่ม Provider ใหม่ในโค้ด UI จะมีแท็บให้กรองทันที
- **Data-Driven Quota Breakdown (`#quotaBreakdown`)**: เลิก hardcode `agy` โดยวนลูปแสดงทุก Provider ที่เป็น `live` พร้อม Pools ภายในตัว (รองรับทั้ง provider ที่มี 1 pool หรือหลาย pools และทั้ง provider ที่มี 5h/Weekly หรือรูปแบบ window อื่น)
- **Upcoming / Extensible Slots**: Provider ที่อยู่ในสถานะ `coming_soon` หรือ `unavailable` แสดงเป็น Compact Status Row พร้อมป้ายสถานะชัดเจน
- **Collapsible Usage History & Trends**: แยก Analytics Graph ไว้ด้านล่างแบบพับ/กางได้ และเตรียมรองรับการกรอง History ตาม Provider ID ในอนาคต
- **On-Demand Providers Inspector Drawer**: Side panel เปิดเมื่อต้องการเช็คภาพรวม Provider ทั้งหมด + Roadmap slot สำหรับ Add Provider

## 3. แนวทาง Provider Integration ในอนาคต (รอผู้ใช้ตัดสินใจ)
1. **Claude Code (`claude`)**:
   - แนวทาง A: อ่าน OAuth credentials / session usage API (ถ้ามี token หรือ endpoint ที่เสถียร)
   - แนวทาง B: เรียก CLI `/usage` ในรูปแบบคล้าย `agy` (ถ้า Claude CLI รองรับ non-interactive command)
2. **Codex (`codex`)**:
   - ตรวจสอบ Codex CLI / OpenAI auth headers (`ratelimit-*`) หรือ local status command
3. **User-Defined / Custom Providers**:
   - ออกแบบ Schema ใน VS Code Settings (`quotadeck.customProviders`) เช่น `{ id, name, command | endpoint, jsonPathRemaining, resetPath }`
   - รองรับ Command-based provider (รัน CLI แล้ว parse stdout/JSON) และ HTTP-based provider (ดึง JSON endpoint ผ่าน auth env/SecretStorage)
