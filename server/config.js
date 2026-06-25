/**
 * Cáº¥u hĂ¬nh tá»« biáº¿n mĂ´i trÆ°á»ng. Fail fast náº¿u thiáº¿u SECRET_KEY.
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
        console.error('FATAL: SECRET_KEY pháº£i Ä‘Æ°á»£c Ä‘áº·t trong mĂ´i trÆ°á»ng (vĂ­ dá»¥ .env).');
        process.exit(1);
    }
    return raw.trim();
}

/** MĂ£ giáº£i â€” Ä‘á»c tá»« DB (dashboard SET) hoáº·c env TOURNAMENT_CODE */
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
     * Auth theo tĂ i khoáº£n:
     * - DASHBOARD_ADMIN_USER + DASHBOARD_ADMIN_PASSWORD
     * - DASHBOARD_VIEWER_USER + DASHBOARD_VIEWER_PASSWORD (tĂ¹y chá»n)
     * TÆ°Æ¡ng thĂ­ch cÅ©: náº¿u chÆ°a cĂ³ USER/PASSWORD thĂ¬ dĂ¹ng PIN (admin/viewer).
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
    /** URL webhook Discord Ä‘á»ƒ nháº¯c vi pháº¡m (Ä‘á»ƒ trá»‘ng = táº¯t). */
    getDiscordWebhookUrl() {
        const url = process.env.DISCORD_WEBHOOK_URL;
        return url && typeof url === 'string' ? url.trim() : null;
    },
};
