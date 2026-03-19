# Discord nhắc vi phạm / mất kết nối

Khi bật **DISCORD_WEBHOOK_URL**, server sẽ gửi tin nhắn vào kênh Discord mỗi khi:

1. **Vi phạm thiết bị** — Thiết bị mở app không trong whitelist (embed màu cam).
2. **Mất kết nối thiết bị** — Thiết bị không gửi heartbeat quá 7s (embed màu xám).

Trọng tài chỉ cần theo dõi kênh đó (bật thông báo) để vừa nghe thoại vừa thấy nhắc vi phạm/lỗi.

---

## Cách bật

1. **Tạo Webhook trong Discord**
   - Vào server Discord của giải đấu.
   - Chọn (hoặc tạo) **kênh text** cho trọng tài (vd. `#giám-sát-thiết-bị`).
   - Cài đặt kênh → **Tích hợp** → **Webhook** → **Tạo Webhook**.
   - Đặt tên (vd. `ALAN Monitor`), copy **URL Webhook**.

2. **Cấu hình server**
   - Mở `server/.env`, thêm dòng:
     ```env
     DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxx/yyyy
     ```
   - Khởi động lại server.

3. **Thông báo**
   - Bật thông báo cho kênh đó (Desktop/Mobile) để có âm thanh khi có tin mới.
   - Không cần bot join voice — tin nhắn vào kênh text + notification là đủ để follow.

---

## Tắt

Xóa dòng `DISCORD_WEBHOOK_URL` trong `.env` hoặc để trống; server sẽ không gửi Discord.
