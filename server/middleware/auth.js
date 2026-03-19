const crypto = require('crypto');

const COOKIE_NAME = 'alan_sid';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const validSessions = new Map(); // token -> expiry time

function getCookie(req, name) {
    const raw = req.headers.cookie;
    if (!raw) return null;
    const match = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
    return match ? match.slice(name.length + 1) : null;
}

function createSession() {
    const token = crypto.randomBytes(24).toString('hex');
    validSessions.set(token, Date.now() + SESSION_MAX_AGE_MS);
    return token;
}

function isValidSession(token) {
    if (!token) return false;
    const expiry = validSessions.get(token);
    if (!expiry || Date.now() > expiry) {
        validSessions.delete(token);
        return false;
    }
    return true;
}

function clearSession(token) {
    validSessions.delete(token);
}

/**
 * Middleware: nếu DASHBOARD_PIN được đặt thì yêu cầu đăng nhập (cookie alan_sid).
 * Nếu không đặt PIN thì luôn next().
 */
function requireAuth(getDashboardPin) {
    return (req, res, next) => {
        const pin = getDashboardPin();
        if (!pin) return next();

        const token = getCookie(req, COOKIE_NAME);
        if (isValidSession(token)) return next();

        // API request → 401 JSON; trang HTML → redirect login
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized', needLogin: true });
        }
        if (req.path === '/login.html' || req.path === '/api/auth/login') return next();
        res.redirect(302, '/login.html');
    };
}

/**
 * POST /api/auth/login { pin } — kiểm tra PIN, set cookie và trả 200/401.
 */
function loginRoute(getDashboardPin) {
    return (req, res) => {
        const pin = getDashboardPin();
        if (!pin) {
            return res.status(400).json({ error: 'Auth not configured' });
        }
        const submitted = (req.body && req.body.pin) || (req.query && req.query.pin) || '';
        if (submitted !== pin) {
            return res.status(401).json({ error: 'Invalid PIN', needLogin: true });
        }
        const token = createSession();
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Strict`);
        res.json({ ok: true });
    };
}

module.exports = {
    requireAuth,
    loginRoute,
    getCookie,
    isValidSession,
    clearSession,
    COOKIE_NAME,
};
