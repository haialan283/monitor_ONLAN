# Triển khai giải ONLINE (LIVE) — MCP Demo System

Hướng dẫn deploy **ArenaPulse** lên Internet qua **MCP Demo System** (Cursor).

---

## 1. Kiến trúc LIVE

```
Android App  ──wss──►  Demo System (TLS + public URL)  ──►  Node server (Docker)
Dashboard    ──https/wss──►  cùng URL
```

- Thiết bị thí sinh **chỉ kết nối ra** (outbound) — không cần mở port trên router nhà.
- App: **Host** = domain public, **Port** = `443` → `wss://`.
- `DEPLOY_MODE=LIVE` → **tắt `/api/adb`** (không deploy file qua Internet).

---

## 2. Chuẩn bị code

1. Phát triển trên branch **`master`** trong thư mục `server/`.
2. Build branch deploy: `node scripts/build-live-server-min.js` → `_live_min_root/`
3. Push branch **`live-server-min`** (layout phẳng, không file `.html` trong tree).
4. Repo: `https://github.com/haialan283/monitor_ONLAN.git`

---

## 3. Biến môi trường (platform)

| Biến | Mô tả | Ví dụ |
|------|--------|-------|
| `SECRET_KEY` | Trùng app Android | `MonitorTournamentSecretKey2026!` |
| `DEPLOY_MODE` | `LIVE` tắt ADB | `LIVE` |
| `PORT` | Port container | `3333` |
| `DASHBOARD_ADMIN_USER` | Tài khoản admin | `admin` |
| `DASHBOARD_ADMIN_PASSWORD` | Mật khẩu admin | `****` |
| `DASHBOARD_VIEWER_USER` | Viewer (tùy chọn) | `viewer` |
| `DASHBOARD_VIEWER_PASSWORD` | Mật khẩu viewer | `****` |
| `TOURNAMENT_CODE` | Mã giải mặc định (Admin có thể đổi) | `FFWS2026` |
| `CERT_PIN_SHA256` | SHA-256 pin TLS (tùy chọn) | `...` |
| `DISCONNECT_MS` | Ngưỡng mất kết nối (ms) | `12000` |
| `NET_TCP_TIMEOUT_MS` | Probe Internet | `8000` |
| `DISCORD_WEBHOOK_URL` | Discord webhook | `https://discord.com/api/webhooks/...` |

Không commit `server/.env` — cấu hình secret trên Demo System.

---

## 4. Quy trình MCP

**Project LIVE:** `projectId = cmqrtdt40z4i1gc3gzfoi22fr`  
**URL:** https://alan-monitor-live-v2.demo.ffol4.vn

```
import_repo  branch: live-server-min
deploy
get_public_url
```

Sau sửa code: push `live-server-min` → `import_repo` → `deploy`.

---

## 5. Xác minh

- `GET /health` → `{ "ok": true, "service": "arena-pulse", "deployMode": "LIVE", "adbEnabled": false }`
- `/login.html` → đăng nhập username/password
- `/admin.html` → cấu hình mã giải, whitelist (admin only)
- App: domain, port `443`, mã giải, `wsSecretKey` trùng `SECRET_KEY`

---

## 6. LAN vs LIVE

| | LAN | LIVE |
|--|-----|------|
| `DEPLOY_MODE` | `LAN` | `LIVE` |
| ADB | Bật | Tắt |
| App | `ws://IP:3333` | `wss://domain:443` |
| Auth | User/password hoặc PIN legacy | User/password bắt buộc |

---

*Đi kèm `docs/ROADMAP_UPGRADE.md` — Phase 1.*
