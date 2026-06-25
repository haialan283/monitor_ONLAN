# ArenaPulse — Roadmap nâng cấp 2026

Tài liệu tổng hợp lộ trình phát triển từ trạng thái hiện tại (Android + Node.js + WebSocket + LAN) hướng tới: **vận hành ổn định**, **giám sát giải online (LIVE)**, **ADB LAN tối ưu**, **nền tảng hiện đại**, **AI hỗ trợ vận hành**.

**Nguyên tắc xuyên suốt:** Không làm nặng máy thi đấu · AI chạy trên server · Offline-first (LAN vẫn hoạt động khi mất Internet).

---

## 1. Tầm nhìn & kiến trúc mục tiêu

```mermaid
flowchart TB
    subgraph clients [Clients]
        AND[Android App<br/>heartbeat nhẹ]
        DASH[Dashboard PWA<br/>Vite + TS]
    end

    subgraph server [Server — MCP Demo System / VPS]
        GW[API + WebSocket Hub]
        CFG[Config Service<br/>whitelist, ngưỡng, phiên]
        ADBQ[ADB Worker Queue<br/>chỉ LAN]
        AI[AI Services tùy chọn<br/>anomaly · Ollama · TTS]
    end

    subgraph data [Data]
        SQL[(SQLite<br/>config · stage · alerts)]
        TS[(TimescaleDB tùy chọn<br/>heartbeat history)]
    end

    subgraph notify [Thông báo]
        DC[Discord Webhook]
    end

    AND -->|wss/ws| GW
    DASH -->|https + wss| GW
    GW --> CFG
    GW --> ADBQ
    GW --> AI
    GW --> SQL
    AI --> TS
    GW --> DC
```

---

## 2. Timeline tổng thể

```mermaid
gantt
    title ALAN Monitor — Roadmap 2026
    dateFormat YYYY-MM
    axisFormat %m/%Y

    section P0 Ổn định
    Tối ưu còn lại + config-driven     :p0a, 2026-04, 6w
    Export/Import phiên + filter log    :p0b, after p0a, 4w

    section P1 LIVE
    MCP Demo deploy + Dockerfile   :p1a, 2026-05, 4w
    DEPLOY_MODE + health + env LIVE :p1b, 2026-05, 3w
    Device registration + ngưỡng    :p1c, after p1b, 4w

    section P2 ADB LAN
    Reconnect all + auto-connect        :p2a, 2026-05, 5w
    Trạm USB + tài liệu vận hành        :p2b, after p2a, 3w

    section P3 Nền tảng
    TypeScript + SQLite                 :p3a, 2026-07, 8w
    Dashboard Vite (module hóa)         :p3b, after p3a, 8w

    section P4 AI
    Anomaly detection                   :p4a, 2026-09, 6w
    Ollama tóm tắt + Copilot            :p4b, after p4a, 8w
```

> **Triển khai LIVE:** dùng **MCP Demo System** trong Cursor (`docs/DEPLOY_LIVE.md`). **P0 → P1** là ưu tiên cao nhất.

---

## 3. Trạng thái hiện tại (baseline)

| Hạng mục | Đã có | Chưa có / cần cải thiện |
|----------|-------|-------------------------|
| Heartbeat realtime | ✅ ~2s, AES, delta broadcast | Config interval từ server |
| Anti-cheat | ✅ Whitelist, overlay, log CSV | Whitelist qua file, không sửa code |
| Dashboard | ✅ Stage map, LAN deployer | Paginate log, filter vi phạm |
| ADB LAN | ✅ `connect IP:5555`, script PS1 | Auto-reconnect trên dashboard |
| LIVE | ✅ `wss://` port 443, MCP deploy | Device registration, cert pinning |
| Auth | ✅ Admin / Viewer PIN | Audit log |
| AI | ❌ | Anomaly, tóm tắt, copilot |
| DB | lowdb JSON | SQLite / time-series |

---

## 4. Phase 0 — Ổn định vận hành (6–10 tuần)

**Mục tiêu:** Giải LAN chạy mượt 100+ máy, không rewrite lớn.

```mermaid
flowchart LR
    A[ADB worker queue] --> B[Config file]
    B --> C[Filter + âm thanh]
    C --> D[Export/Import phiên]
    D --> E[Paginate logs]
```

### Deliverables

| # | Hạng mục | Mô tả | File / module |
|---|----------|--------|---------------|
| 0.1 | **ADB worker queue** | `list/push/pull` không block event loop Node | `server/routes/adb.js` → worker |
| 0.2 | **Config-driven** | Whitelist, `disconnectMs`, heartbeat interval qua `server/config/tournament.json` | `server/config/`, `ws/handler.js` |
| 0.3 | **SECRET_KEY đồng bộ** | App chỉ dùng `BuildConfig`, bỏ hardcode trong service | `HeartbeatService.kt`, `build.gradle.kts` |
| 0.4 | **Filter "Chỉ vi phạm"** | Tab lọc warning + partial_warning trên dashboard | `server/public/index.html` |
| 0.5 | **Âm thanh cảnh báo** | Beep khi violation/disconnect mới (tùy bật) | Dashboard |
| 0.6 | **Export / Import phiên** | JSON: devices, stage, alerts, tableNames, netConfig | API + nút dashboard |
| 0.7 | **Paginate log panel** | Tối đa 50 nhóm, "Xem thêm" | Dashboard |
| 0.8 | **Export CSV theo thời gian** | Lọc alerts theo khoảng giờ | Dashboard |

### Tiêu chí hoàn thành P0

- [ ] 100 thiết bị heartbeat, dashboard không lag (render throttle giữ nguyên)
- [ ] Push file 10 máy đồng thời không treo server
- [ ] Backup/restore phiên giữa hai ngày thi đấu
- [x] Đổi whitelist không cần sửa code + restart có hướng dẫn

---

## 5. Phase 1 — Giám sát giải ONLINE (LIVE) qua MCP Demo System

**Mục tiêu:** Thí sinh ở nhà kết nối qua Internet; BTC deploy server qua **MCP Demo System** (Docker + TLS + public URL).

```mermaid
sequenceDiagram
    participant Dev as Cursor + MCP
    participant Demo as Demo System
    participant App as Android App
    participant Dash as Dashboard

    Dev->>Demo: create_project → import_repo → deploy
    Demo-->>Dev: get_public_url (HTTPS/WSS)
    App->>Demo: wss://domain:443
    Dash->>Demo: https + wss
```

### Deliverables

| # | Hạng mục | Trạng thái | Mô tả |
|---|----------|------------|--------|
| 1.1 | **`Dockerfile` + `.dockerignore`** | ✅ | Build `server/` — root repo |
| 1.2 | **`DEPLOY_MODE=LIVE`** | ✅ | Tắt `/api/adb`; ẩn nút push trên dashboard |
| 1.3 | **`GET /health`** | ✅ | Healthcheck container + monitoring |
| 1.4 | **`DISCONNECT_MS` env** | ✅ | Ngưỡng LIVE (mặc định 12s khi LIVE) |
| 1.5 | **`docs/DEPLOY_LIVE.md`** | ✅ | Quy trình MCP từng bước |
| 1.6 | **MCP deploy** | ✅ | https://alan-monitor-live-v2.demo.ffol4.vn |
| 1.7 | **Đăng ký thiết bị** | ✅ | Mã giải LIVE + tên đội; Admin SET mã |
| 1.8 | **Certificate pinning** | ✅ | App port 443 + `CERT_PIN_SHA256` / client-config |

### Quy trình MCP (tóm tắt)

1. `create_project` — tạo project ALAN Monitor LIVE  
2. `import_repo` — `https://github.com/haialan283/monitor_ONLAN.git` (branch `live-server-min`)  
3. Cấu hình env trên platform (`SECRET_KEY`, `DEPLOY_MODE=LIVE`, tài khoản admin/viewer, …)  
4. `run_deployment_check` → `deploy` → `get_public_url`  
5. App: domain public, port `443`  

Chi tiết: [`docs/DEPLOY_LIVE.md`](DEPLOY_LIVE.md)

### Cấu hình mẫu LIVE

```env
DEPLOY_MODE=LIVE
PORT=3333
SECRET_KEY=...
DASHBOARD_ADMIN_USER=admin
DASHBOARD_ADMIN_PASSWORD=...
DASHBOARD_VIEWER_USER=viewer
DASHBOARD_VIEWER_PASSWORD=...
DISCONNECT_MS=12000
NET_TCP_TIMEOUT_MS=8000
DISCORD_WEBHOOK_URL=...
TOURNAMENT_CODE=FFWS2026
```

### Tiêu chí hoàn thành P1

- [x] `Dockerfile` + `DEPLOY_MODE` + `/health` + tài liệu MCP
- [x] MCP: `deploy` thành công, `get_public_url` truy cập được
- [x] App: BuildConfig key, mã giải, client-config, cert pin (port 443) — cần test 4G
- [x] Dashboard HTTPS, đăng nhập tài khoản, viewer read-only, trang Admin
- [x] ADB API không hoạt động khi `DEPLOY_MODE=LIVE`
- [ ] Discord báo vi phạm + disconnect qua LIVE (cần test thực tế)

---

## 6. Phase 2 — ADB LAN tối ưu (5–8 tuần, song song P1)

**Mục tiêu:** Giảm thao tác USB thủ công; giữ `tcpip 5555` (không QR — phù hợp máy hay restart).

```mermaid
flowchart TB
    subgraph setup [Trước giải / sau reboot]
        HUB[USB Hub + batch script]
        TS[Task Scheduler Watch USB]
    end

    subgraph runtime [Trong giải]
        HB[Heartbeat localIp + isFtpOpen]
        API[POST /api/adb/reconnect-all]
        DASH[LAN Deployer]
    end

    HUB --> HB
    TS --> HB
    HB --> API --> DASH
```

### Deliverables

| # | Hạng mục | Mô tả |
|---|----------|--------|
| 2.1 | **`POST /api/adb/reconnect-all`** | ✅ |
| 2.2 | **Auto-connect khi `isFtpOpen`** | ✅ |
| 2.3 | **Lưu `adbEndpoint` theo deviceId** | ✅ |
| 2.4 | **Nút dashboard** | ✅ |
| 2.5 | **Tích hợp scan LAN** | 🔲 (tùy chọn) |
| 2.6 | **`docs/ADB_LAN_OPS.md`** | ✅ |

### Không làm trong P2 (đã thống nhất)

- ❌ Wireless debugging QR làm luồng chính (mã đổi sau reboot, cổng động)
- ❌ ADB qua Internet

### Tiêu chí hoàn thành P2

- [ ] Sau reboot + chạy batch USB: dashboard deploy file không cần gõ lệnh tay
- [x] Đổi IP trong LAN: một nút reconnect trên dashboard
- [x] Giám sát heartbeat vẫn chạy khi ADB chưa connect

---

## 7. Phase 3 — Hiện đại hóa nền tảng (12–16 tuần)

**Mục tiêu:** Codebase dễ mở rộng, type-safe, DB ổn định hơn lowdb.

```mermaid
flowchart LR
    subgraph monorepo [Cấu trúc mục tiêu]
        PKG[packages/shared-types]
        SRV[apps/server TS]
        WEB[apps/dashboard Vite]
        AND[apps/android]
    end
    PKG --> SRV
    PKG --> WEB
```

### Deliverables

| # | Hạng mục | Mô tả |
|---|----------|--------|
| 3.1 | **Server TypeScript** | Migrate dần `index.js`, `ws/handler.js` |
| 3.2 | **Zod schema** | Validate message WebSocket (`hb`, `assign_slot`, …) |
| 3.3 | **SQLite** | Thay lowdb; migration script từ `db.json` |
| 3.4 | **Dashboard Vite** | Tách `index.html` → components (Stage, Logs, Net) |
| 3.5 | **PWA** | Cache last state, cài trên tablet trọng tài |
| 3.6 | **CI** | GitHub Actions: lint, test server, build APK |
| 3.7 | **Audit log** | ✅ Ghi login, admin settings, clear logs, import phiên |

### Tiêu chí hoàn thành P3

- [ ] Migration lowdb → SQLite không mất dữ liệu stage
- [ ] Shared types đồng bộ app ↔ server ↔ dashboard
- [ ] Dashboard dev hot-reload; production build tách static

---

## 8. Phase 4 — AI hỗ trợ vận hành (10–14 tuần)

**Mục tiêu:** Giảm tải trọng tài; AI trên server (Ollama local khi LAN).

```mermaid
flowchart TB
    HB[Heartbeat stream] --> AD[Anomaly Detector<br/>rule + stats]
    AL[Alerts] --> SUM[Ollama Summarizer<br/>báo cáo tiếng Việt]
    AL --> RAG[Copilot RAG<br/>hỏi đáp log]
    AD --> DASH[Panel AI trên Dashboard]
    SUM --> PDF[Báo cáo / Discord]
    RAG --> DASH
```

### Deliverables

| # | Hạng mục | Mô tả | Cần LLM? |
|---|----------|--------|----------|
| 4.1 | **Anomaly detection** | Spike dataBytes, RSSI, disconnect pattern | Không |
| 4.2 | **Ưu tiên cảnh báo** | Score thiết bị trên dashboard | Không |
| 4.3 | **Tóm tắt phiên** | "3 overlay, 1 disconnect cố ý" | Ollama local |
| 4.4 | **Copilot dashboard** | "Ai vi phạm nhiều nhất 30 phút?" | Ollama + RAG |
| 4.5 | **TTS Discord** | Đọc tên bàn + loại vi phạm | Edge TTS / Piper |
| 4.6 | **TimescaleDB** (tùy chọn) | Lưu heartbeat history cho AI | — |

### Nguyên tắc AI

- Không inference trên máy thi đấu
- Không auto phạt — chỉ gợi ý
- LIVE có Internet: API cloud tùy chọn; LAN: **Ollama embedded**

---

## 9. Ma trận ưu tiên (ROI)

```mermaid
quadrantChart
    title Ưu tiên đầu tư
    x-axis Effort thấp --> Effort cao
    y-axis Impact thấp --> Impact cao
    quadrant-1 Làm sớm
    quadrant-2 Kế hoạch dài
    quadrant-3 Có thể hoãn
    quadrant-4 Cân nhắc kỹ
    ADB queue + Export phiên: [0.2, 0.85]
    Config whitelist: [0.15, 0.8]
    LIVE MCP deploy: [0.4, 0.92]
    Reconnect ADB dashboard: [0.35, 0.75]
    Filter + âm thanh: [0.1, 0.7]
    TypeScript SQLite: [0.7, 0.75]
    Anomaly AI: [0.55, 0.65]
    Ollama Copilot: [0.75, 0.6]
    QR wireless ADB: [0.6, 0.25]
```

---

## 10. Phụ thuộc giữa các phase

```mermaid
flowchart TD
    P0[Phase 0 Ổn định] --> P1[Phase 1 LIVE]
    P0 --> P2[Phase 2 ADB LAN]
    P1 --> P3[Phase 3 Nền tảng]
    P2 --> P3
    P3 --> P4[Phase 4 AI]
    P1 -.-> P4
```

- **P0** là nền bắt buộc cho mọi thứ khác.
- **P1 (MCP LIVE)** và **P2 (ADB LAN)** có thể song song.
- **P4 AI** nên sau **P3 SQLite** để có dữ liệu lịch sử tốt.

---

## 11. Checklist nhanh theo vai trò

### Dev backend
- [ ] P0: ADB queue, config file, export/import API
- [ ] P1: MCP deploy, env LIVE trên Demo System
- [ ] P2: reconnect-all API, adbEndpoint store
- [ ] P3: TS + SQLite migration

### Dev Android
- [ ] P0: BuildConfig SECRET_KEY, heartbeat interval từ server
- [ ] P1: Certificate pinning (LIVE)
- [ ] P3: Coroutines refactor (tùy chọn)

### Dev frontend / vận hành
- [ ] P0: Filter vi phạm, âm thanh, paginate logs
- [ ] P2: Nút Reconnect ADB
- [ ] P3: Dashboard Vite

### BTC / vận hành giải
- [ ] P2: Quy trình USB hub + Task Scheduler
- [ ] P1: Nhập domain:443 trên app; xác minh `/health`
- [ ] P4: Bật Ollama trên máy BTC (LAN)

---

## 12. Tài liệu liên quan

| File | Nội dung |
|------|----------|
| `FEATURES_SHOWCASE.md` | Pitch tính năng hiện tại |
| `docs/OPTIMIZATION_AND_ROADMAP.md` | Tối ưu hiệu năng chi tiết |
| `docs/DISCORD_WEBHOOK.md` | Cấu hình Discord |
| `docs/DEPLOY_LIVE.md` | **Triển khai LIVE qua MCP Demo System** |
| `docs/ROADMAP_UPGRADE.md` | **File này** — roadmap tổng thể |

---

*Cập nhật: 2026-06 · P5 (iOS) đã loại khỏi phạm vi · P1 triển khai qua MCP Demo System.*
