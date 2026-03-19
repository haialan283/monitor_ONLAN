# ALAN Monitor – Tính năng & Pitch cho đơn vị vận hành giải đấu

**Mục đích:** Tổng hợp tính năng để showcase và pitching cho đơn vị vận hành giải đấu sử dụng hệ thống giám sát thiết bị thi đấu (anti-cheat, realtime, LAN/LIVE).

---

## 1. Tổng quan giá trị

| Giá trị | Mô tả ngắn |
|--------|-------------|
| **Realtime** | Dashboard cập nhật theo thời gian thực qua WebSocket (heartbeat ~2s). |
| **Anti-cheat** | Phát hiện app không được phép (ngoài whitelist), overlay, màn hình khóa. |
| **Dễ vận hành** | Giao diện một màn hình: danh sách thiết bị, bản đồ sân khấu, log vi phạm, mạng. |
| **LAN + LIVE** | Chạy trên mạng nội bộ (LAN) hoặc deploy server ra Internet (ON LIVE) cho giải từ xa. |
| **Tích hợp Discord** | Webhook + bot thoại (TTS) để trọng tài nhận cảnh báo ngay trong Discord. |

---

## 2. Giám sát thiết bị realtime

- **Heartbeat định kỳ (~2s):** Mỗi thiết bị Android gửi trạng thái lên server (app đang mở, pin, màn hình, RAM, WiFi).
- **Trạng thái từng thiết bị:**
  - **Online (xanh):** Đang trong app được phép (whitelist).
  - **Warning (đỏ):** Đang mở app không được phép → vi phạm.
  - **Lock (xám):** Màn hình tắt/khóa.
  - **Disconnected:** Mất kết nối (quá ~7s không heartbeat).
- **Thông tin hiển thị trên card:** Tên thiết bị, pin %, sạc, app hiện tại, RAM (Free/Total), cường độ WiFi (RSSI), IP nội bộ.
- **Phát hiện overlay:** App overlay (draw over) được báo dạng `OVERLAY: <package>` và xử lý đúng whitelist.

---

## 3. Anti-cheat & whitelist

- **Whitelist app:** Chỉ các package trong whitelist được coi là “hợp lệ” (ví dụ: Free Fire TH/Max, Chrome, app giám sát, launcher Samsung). Cấu hình trên server (`server/ws/handler.js`).
- **Cảnh báo vi phạm:** Khi thí sinh mở app khác → trạng thái **warning**, ghi **violation log** (thời gian bắt đầu/kết thúc, tên thiết bị, package).
- **Log vi phạm:** Panel bên phải: nhóm theo thiết bị, có thể mở rộng/thu gọn; ưu tiên thiết bị đang vi phạm; nút **Clear** xóa toàn bộ log.
- **Export báo cáo:** Nút **Download LOGS** → file CSV (UTF-8) danh sách vi phạm (Start Time, End Time, Device Name, App Package) để lưu trữ / báo cáo ban tổ chức.

---

## 4. Dashboard vận hành

- **Waiting list (bên trái):** Thiết bị chưa gán slot hoặc slot = "wait". Kéo thả card vào **Interactive Stage Map** để gán vị trí.
- **Interactive Stage Map (giữa):** Bản đồ sân khấu; kéo thả thiết bị để đặt vị trí (tọa độ x, y); kéo lại để đổi chỗ.
- **Violation Logs (bên phải):** Log vi phạm theo nhóm thiết bị, có trạng thái đang vi phạm / đã kết thúc; thiết bị offline được đánh dấu riêng.
- **Network monitor (header):** Cấu hình IP/host + port để kiểm tra mạng (DNS + TCP); đèn xanh/đỏ, đồ thị độ trễ, cảnh báo lỗi mạng (SYSTEM_NET) vào log.
- **Trạng thái kết nối:** Hiển thị “Đã kết nối” / “Đang kết nối…” / “Mất kết nối” (WebSocket).
- **Bảo vệ dashboard:** Tùy chọn đặt **DASHBOARD_PIN** (env) → trang đăng nhập PIN trước khi vào dashboard và API.

---

## 5. LAN Deployer (chuyển file qua ADB – dùng trên LAN)

- **File explorer:** Từ card thiết bị, bấm icon thư mục (khi thiết bị bật “Mở cổng nhận file”) → mở modal duyệt file trên thiết bị qua ADB (list, vào thư mục, quay lại).
- **Upload file:** Chọn file từ máy vận hành → đẩy vào thư mục hiện tại trên thiết bị (push qua ADB).
- **Download file:** Tải file từ thiết bị về máy vận hành (pull qua ADB).
- **Lưu ý:** Chỉ dùng khi server và thiết bị cùng mạng LAN (hoặc có đường ADB TCP). Mode ON LIVE có thể tắt hoặc không dùng ADB.

---

## 6. Tích hợp Discord

- **Webhook Discord:** Khi có **vi phạm** hoặc **mất kết nối**, server gửi embed vào kênh Discord (cấu hình `DISCORD_WEBHOOK_URL`). Trọng tài nhận thông báo ngay trên Discord.
- **Bot thoại (TTS):** Chạy thêm `npm run voice-bot` (process riêng); bot vào kênh thoại Discord và **đọc TTS** khi có vi phạm/mất kết nối. Trọng tài không cần nhìn màn hình. Cấu hình: `DISCORD_BOT_TOKEN`, `DISCORD_VOICE_CHANNEL_ID`, `DISCORD_VOICE_BOT_URL` + secret từ server chính.

---

## 7. Bảo mật & cấu hình

- **Mã hóa WebSocket:** Payload AES-256-CBC (key từ `SECRET_KEY` env). App và server dùng chung secret.
- **Bảo vệ dashboard:** `DASHBOARD_PIN` → đăng nhập bằng PIN; session cookie (ví dụ 24h).
- **Cấu hình linh hoạt:** Port/Host, chu kỳ kiểm tra mạng (`NET_CHECK_INTERVAL_MS`), Discord webhook/bot qua biến môi trường hoặc `.env` (có `.env.example` mẫu).

---

## 8. Triển khai (LAN vs LIVE)

- **LAN:** Server chạy trên máy trong mạng giải đấu; thiết bị và dashboard cùng WiFi. Có thể dùng ADB (LAN Deployer).
- **LIVE:** Deploy server lên VPS/máy chủ có IP public; mở port (ví dụ 3000) và (nếu dùng HTTPS) reverse proxy hỗ trợ WebSocket. App Android nhập domain/IP + port để kết nối. Khuyến nghị không dùng ADB trên LIVE (chỉ realtime heartbeat + Discord).

---

## 9. Checklist pitch nhanh (bullet cho slide / one-pager)

- Realtime giám sát nhiều thiết bị trên một dashboard.
- Phát hiện app không được phép (whitelist) và overlay → cảnh báo ngay.
- Log vi phạm có thời gian, export CSV cho báo cáo.
- Bản đồ sân khấu tương tác: kéo thả thiết bị, gán bàn/vị trí.
- Giám sát mạng (DNS/TCP, độ trễ) và cảnh báo lỗi mạng.
- Discord: webhook + bot đọc TTS trong kênh thoại cho trọng tài.
- Chạy LAN tại trường thi hoặc LIVE qua Internet.
- Bảo vệ dashboard bằng PIN; mã hóa kênh giám sát.
- (LAN) Deploy file lên thiết bị qua ADB (list/upload/download).

---

*Tài liệu tổng hợp từ codebase ALAN Monitor (Android app + Node server). Có thể dùng cho README, proposal hoặc slide pitching đơn vị vận hành giải đấu.*
