const crypto = require('crypto');

const COOKIE_NAME = 'alan_sid';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const validSessions = new Map(); // token -> { expiry, role }

function getCookie(req, name) {
    const raw = req.headers.cookie;
    if (!raw) return null;
    const match = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
    return match ? match.slice(name.length + 1) : null;
}

function createSession(role) {
    const token = crypto.randomBytes(24).toString('hex');
    validSessions.set(token, { expiry: Date.now() + SESSION_MAX_AGE_MS, role: role || 'viewer' });
    return token;
}

function getSession(token) {
    if (!token) return null;
    const session = validSessions.get(token);
    if (!session || Date.now() > session.expiry) {
        validSessions.delete(token);
        return null;
    }
    return session;
}

function isValidSession(token) {
    return !!getSession(token);
}

function getRoleFromToken(token) {
    const s = getSession(token);
    return s ? s.role : null;
}

function safeEqual(a, b) {
    const sa = String(a ?? '');
    const sb = String(b ?? '');
    const bufA = Buffer.from(sa);
    const bufB = Buffer.from(sb);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function resolveRoleFromCredentials(getAuthUsers, username, password) {
    const users = getAuthUsers ? getAuthUsers() : { admin: null, viewer: null, authEnabled: false };
    if (!users.authEnabled) return { role: null, authEnabled: false };

    const u = String(username || '').trim();
    const p = String(password || '');

    if (users.admin && safeEqual(u, users.admin.username) && safeEqual(p, users.admin.password)) {
        return { role: 'admin', authEnabled: true };
    }
    if (users.viewer && safeEqual(u, users.viewer.username) && safeEqual(p, users.viewer.password)) {
        return { role: 'viewer', authEnabled: true };
    }
    return { role: null, authEnabled: true };
}

function getRoleFromRequest(req, getAuthUsers) {
    const users = getAuthUsers ? getAuthUsers() : { authEnabled: false };
    if (!users.authEnabled) return null;
    const token = getCookie(req, COOKIE_NAME);
    return getRoleFromToken(token);
}

function requireEditor(req, res, next) {
    if (req.userRole === 'admin') return next();
    return res.status(403).json({ error: 'Viewer mode: read-only', needEditor: true });
}

function withRole(req, getAuthUsers) {
    req.userRole = getRoleFromRequest(req, getAuthUsers);
    return req.userRole;
}

function clearSession(token) {
    validSessions.delete(token);
}

/**
 * Middleware: yêu cầu đăng nhập (cookie alan_sid) khi đã cấu hình tài khoản.
 */
function requireAuth(getAuthUsers) {
    return (req, res, next) => {
        const users = getAuthUsers ? getAuthUsers() : { authEnabled: false };
        const role = withRole(req, getAuthUsers);

        if (!users.authEnabled) {
            if (req.path.startsWith('/api/')) {
                return res.status(503).json({
                    error: 'Chưa cấu hình tài khoản. Đặt DASHBOARD_ADMIN_USER và DASHBOARD_ADMIN_PASSWORD trên server.',
                    needSetup: true,
                });
            }
            if (req.path === '/login.html') return next();
            return res.redirect(302, '/login.html?setup=1');
        }

        if (role) return next();

        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized', needLogin: true });
        }
        if (req.path === '/login.html') return next();
        return res.redirect(302, '/login.html');
    };
}

/**
 * POST /api/auth/login { username, password } — set cookie + role admin/viewer.
 */
function loginRoute(getAuthUsers) {
    return (req, res) => {
        const username = ((req.body && req.body.username) || (req.query && req.query.username) || '').toString();
        const password = ((req.body && req.body.password) || (req.query && req.query.password) || '').toString();
        const resolved = resolveRoleFromCredentials(getAuthUsers, username, password);
        if (!resolved.authEnabled) {
            return res.status(400).json({ error: 'Auth not configured' });
        }
        if (!resolved.role) {
            return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu', needLogin: true });
        }
        const token = createSession(resolved.role);
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Strict`);
        try {
            require('../services/auditLog').appendAudit('login', `role=${resolved.role}`, {});
        } catch (_) { /* ignore */ }
        res.json({ ok: true, role: resolved.role });
    };
}

/**
 * GET /api/auth/me
 */
function meRoute(getAuthUsers) {
    return (req, res) => {
        const users = getAuthUsers ? getAuthUsers() : { authEnabled: false };
        const role = withRole(req, getAuthUsers);
        if (!users.authEnabled) {
            return res.json({ ok: true, authEnabled: false, needSetup: true });
        }
        if (!role) {
            return res.status(401).json({ ok: false, authEnabled: true, needLogin: true });
        }
        return res.json({ ok: true, authEnabled: true, role });
    };
}

/**
 * POST /api/auth/logout — xóa session + cookie HttpOnly.
 */
function logoutRoute() {
    return (req, res) => {
        const token = getCookie(req, COOKIE_NAME);
        if (token) clearSession(token);
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
        res.json({ ok: true });
    };
}

module.exports = {
    requireAuth,
    requireEditor,
    loginRoute,
    meRoute,
    logoutRoute,
    getRoleFromRequest,
    getCookie,
    isValidSession,
    getRoleFromToken,
    clearSession,
    COOKIE_NAME,
};
