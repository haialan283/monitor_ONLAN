/**
 * Cấu hình từ biến môi trường. Fail fast nếu thiếu SECRET_KEY.
 */
const PORT = parseInt(process.env.PORT, 10) || 3333;
const HOST = process.env.HOST || '0.0.0.0';

function getDeployMode() {
    const raw = (process.env.DEPLOY_MODE || 'LAN').toString().trim().toUpperCase();
    return raw === 'LIVE' ? 'LIVE' : 'LAN';
}

function isLiveMode() {
    return getDeployMode() === 'LIVE';
}

function getDisconnectMs() {
    try {
        const tourMs = require('./config/tournamentLoader').getTournamentDisconnectMs();
        if (typeof tourMs === 'number' && tourMs >= 3000) return tourMs;
    } catch (_) {
        // tournament config optional at boot
    }
    const n = parseInt(process.env.DISCONNECT_MS, 10);
    if (Number.isFinite(n) && n >= 3000) return Math.min(n, 120000);
    return isLiveMode() ? 12000 : 5000;
}

function getCertPinSha256() {
    const raw = process.env.CERT_PIN_SHA256;
    return raw && typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function getSecretKey() {
    const raw = process.env.SECRET_KEY;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
        console.error('FATAL: SECRET_KEY phải được đặt trong môi trường (ví dụ .env).');
        process.exit(1);
    }
    return raw.trim();
}

/** Mã giải — đọc từ DB (dashboard SET) hoặc env TOURNAMENT_CODE */
function getTournamentCode() {
    return require('./db/store').getTournamentCode();
}

function isTournamentCodeValid(submitted) {
    const expected = getTournamentCode();
    if (!expected) return true;
    const got = (submitted || '').toString().trim();
    return got === expected;
}

module.exports = {
    PORT,
    HOST,
    getDeployMode,
    isLiveMode,
    getDisconnectMs,
    getCertPinSha256,
    getSecretKey,
    getTournamentCode,
    isTournamentCodeValid,
    /**
     * Auth theo tài khoản:
     * - DASHBOARD_ADMIN_USER + DASHBOARD_ADMIN_PASSWORD
     * - DASHBOARD_VIEWER_USER + DASHBOARD_VIEWER_PASSWORD (tùy chọn)
     * Tương thích cũ: nếu chưa có USER/PASSWORD thì dùng PIN (admin/viewer).
     */
    getAuthUsers() {
        const legacyPin = process.env.DASHBOARD_PIN;
        const adminPin = process.env.DASHBOARD_ADMIN_PIN || legacyPin;
        const viewerPin = process.env.DASHBOARD_VIEWER_PIN;

        const adminUser = (process.env.DASHBOARD_ADMIN_USER || (adminPin ? 'admin' : '')).trim();
        const adminPass = (process.env.DASHBOARD_ADMIN_PASSWORD || adminPin || '').trim();
        const viewerUser = (process.env.DASHBOARD_VIEWER_USER || (viewerPin ? 'viewer' : '')).trim();
        const viewerPass = (process.env.DASHBOARD_VIEWER_PASSWORD || viewerPin || '').trim();

        const admin = adminUser && adminPass ? { username: adminUser, password: adminPass } : null;
        const viewer = viewerUser && viewerPass ? { username: viewerUser, password: viewerPass } : null;

        return {
            admin,
            viewer,
            authEnabled: !!(admin || viewer),
        };
    },
    /** URL webhook Discord để nhắc vi phạm (để trống = tắt). */
    getDiscordWebhookUrl() {
        const url = process.env.DISCORD_WEBHOOK_URL;
        return url && typeof url === 'string' ? url.trim() : null;
    },
};
