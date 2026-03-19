/**
 * Cấu hình từ biến môi trường. Fail fast nếu thiếu SECRET_KEY.
 */
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function getSecretKey() {
    const raw = process.env.SECRET_KEY;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
        console.error('FATAL: SECRET_KEY phải được đặt trong môi trường (ví dụ .env).');
        process.exit(1);
    }
    return raw.trim();
}

module.exports = {
    PORT,
    HOST,
    getSecretKey,
    /** Chỉ bật auth khi đặt DASHBOARD_PIN (ví dụ trong .env) */
    getDashboardPin() {
        const pin = process.env.DASHBOARD_PIN;
        return pin && typeof pin === 'string' ? pin.trim() : null;
    },
    /** URL webhook Discord để nhắc vi phạm (để trống = tắt). */
    getDiscordWebhookUrl() {
        const url = process.env.DISCORD_WEBHOOK_URL;
        return url && typeof url === 'string' ? url.trim() : null;
    },
    /** URL bot Discord voice (vd. http://localhost:3001). Nếu set, server POST /announce khi vi phạm/mất kết nối để bot đọc TTS trong kênh thoại. */
    getDiscordVoiceBotUrl() {
        const url = process.env.DISCORD_VOICE_BOT_URL;
        return url && typeof url === 'string' ? url.trim() : null;
    },
    /** Secret để xác thực khi gọi voice bot (header X-Bot-Secret hoặc Authorization: Bearer <secret>). */
    getDiscordVoiceBotSecret() {
        const s = process.env.DISCORD_VOICE_BOT_SECRET;
        return s && typeof s === 'string' ? s.trim() : null;
    },
};
