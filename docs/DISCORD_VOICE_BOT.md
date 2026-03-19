# Discord Voice Bot – Đọc TTS trong kênh thoại

Trọng tài có thể ở trong kênh thoại; khi có vi phạm hoặc thiết bị mất kết nối, **bot vào kênh thoại và đọc TTS** thay vì phải mở điện thoại xem tin nhắn.

## Cách hoạt động

1. Chạy **bot Discord** riêng: `npm run voice-bot` (trong thư mục `server`).
2. Bot đăng nhập Discord, vào đúng **kênh thoại** (voice channel) theo cấu hình.
3. **Server chính** (ALAN Monitor) khi có vi phạm hoặc mất kết nối sẽ gửi **POST** tới bot (mặc định `http://localhost:3001/announce`).
4. Bot nhận payload, tạo **TTS tiếng Việt** (Google TTS), phát trong kênh thoại.

## Cấu hình

Thêm vào `.env` (có thể copy từ `.env.example`):

| Biến | Bắt buộc | Mô tả |
|------|----------|--------|
| `DISCORD_BOT_TOKEN` | Có | Bot token từ [Discord Developer Portal](https://discord.com/developers/applications) → Application → Bot → Reset Token / Copy. |
| `DISCORD_VOICE_CHANNEL_ID` | Có | ID kênh thoại (bật chế độ nhà phát triển Discord: Cài đặt → Nâng cao → Chế độ nhà phát triển; chuột phải kênh thoại → Sao chép ID). |
| `BOT_HTTP_PORT` | Không | Port HTTP bot lắng (mặc định `3001`). |
| `BOT_SECRET` | Không | Nếu đặt, bot chỉ chấp nhận request có header `X-Bot-Secret` (hoặc `Authorization: Bearer <BOT_SECRET>`). |

Trên **server chính** (cùng file `.env` hoặc máy gọi được bot):

| Biến | Mô tả |
|------|--------|
| `DISCORD_VOICE_BOT_URL` | URL bot, ví dụ `http://localhost:3001`. Khi set, server sẽ POST `/announce` khi có vi phạm / mất kết nối. |
| `DISCORD_VOICE_BOT_SECRET` | Cùng giá trị với `BOT_SECRET` (nếu dùng) để server gửi header khi gọi bot. |

## Chạy

1. Cài dependency (đã có trong `package.json`): `npm install`.
2. **Cài FFmpeg** trên máy (cần cho phát file MP3 trong Discord):
   - Windows: [ffmpeg.org](https://ffmpeg.org/download.html) hoặc `winget install ffmpeg`.
   - Đảm bảo `ffmpeg` có trong PATH.
3. Chạy server chính: `npm start`.
4. Chạy bot (terminal khác): `npm run voice-bot`.

Khi có vi phạm hoặc mất kết nối, server gửi POST tới bot; bot đọc TTS trong kênh thoại (ví dụ: *"Cảnh báo vi phạm. Thiết bị XYZ. Ứng dụng com.xxx."* hoặc *"Thiết bị ABC mất kết nối."*).

## Bảo mật

- Nếu bot và server chạy trên cùng máy, có thể không cần `BOT_SECRET` (bot chỉ lắng `127.0.0.1`).
- Nếu bot lắng trên mạng (hoặc port mở), nên đặt `BOT_SECRET` và `DISCORD_VOICE_BOT_SECRET` giống nhau để chỉ server biết secret mới gọi được.

## Lưu ý

- Bot cần quyền **Kết nối** và **Nói** trong kênh thoại.
- TTS dùng Google TTS (tiếng Việt); giới hạn ~200 ký tự/lần, script đã tự cắt đoạn dài.
