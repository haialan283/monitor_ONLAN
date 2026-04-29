/**
 * Cấu hình từ biến môi trường. Fail fast nếu thiếu SECRET_KEY.
 */
const PORT = parseInt(process.env.PORT, 10) || 3333;
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
    /**
     * Auth theo role:
     * - DASHBOARD_ADMIN_PIN: quyền chỉnh sửa
     * - DASHBOARD_VIEWER_PIN: chỉ xem
     * Tương thích ngược: DASHBOARD_PIN sẽ được dùng như admin PIN.
     */
    getAuthPins() {
        const legacy = process.env.DASHBOARD_PIN;
        const admin = process.env.DASHBOARD_ADMIN_PIN || legacy;
        const viewer = process.env.DASHBOARD_VIEWER_PIN;
        return {
            admin: admin && typeof admin === 'string' ? admin.trim() : null,
            viewer: viewer && typeof viewer === 'string' ? viewer.trim() : null,
        };
    },
    /** Giữ lại cho code cũ; map vào admin pin. */
    getDashboardPin() {
        const pin = process.env.DASHBOARD_ADMIN_PIN || process.env.DASHBOARD_PIN;
        return pin && typeof pin === 'string' ? pin.trim() : null;
    },
    /** URL webhook Discord để nhắc vi phạm (để trống = tắt). */
    getDiscordWebhookUrl() {
        const url = process.env.DISCORD_WEBHOOK_URL;
        return url && typeof url === 'string' ? url.trim() : null;
    },
};
