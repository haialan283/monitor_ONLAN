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

function resolveRoleFromPins(getAuthPins, submittedRole, submittedPin) {
    const pins = getAuthPins ? getAuthPins() : { admin: null, viewer: null };
    const adminPin = pins && typeof pins.admin === 'string' && pins.admin ? pins.admin : null;
    const viewerPin = pins && typeof pins.viewer === 'string' && pins.viewer ? pins.viewer : null;
    const authEnabled = !!(adminPin || viewerPin);
    if (!authEnabled) return { role: 'admin', authEnabled };

    const requested = typeof submittedRole === 'string' ? submittedRole.trim().toLowerCase() : '';
    if (requested === 'admin' && submittedPin === adminPin) return { role: 'admin', authEnabled };
    if (requested === 'viewer' && submittedPin === viewerPin) return { role: 'viewer', authEnabled };

    // Backward-compatible auto detect when role not selected.
    if (submittedPin === adminPin) return { role: 'admin', authEnabled };
    if (submittedPin === viewerPin) return { role: 'viewer', authEnabled };
    return { role: null, authEnabled };
}

function getRoleFromRequest(req, getAuthPins) {
    const pins = getAuthPins ? getAuthPins() : { admin: null, viewer: null };
    const authEnabled = !!((pins && pins.admin) || (pins && pins.viewer));
    if (!authEnabled) return 'admin';
    const token = getCookie(req, COOKIE_NAME);
    return getRoleFromToken(token);
}

function requireEditor(req, res, next) {
    if (req.userRole === 'admin') return next();
    return res.status(403).json({ error: 'Viewer mode: read-only', needEditor: true });
}

function withRole(req, getAuthPins) {
    req.userRole = getRoleFromRequest(req, getAuthPins);
    return req.userRole;
}

function clearSession(token) {
    validSessions.delete(token);
}

/**
 * Middleware: nếu có PIN thì yêu cầu đăng nhập (cookie alan_sid).
 * Nếu không đặt PIN thì luôn next() với role admin.
 */
function requireAuth(getAuthPins) {
    return (req, res, next) => {
        const role = withRole(req, getAuthPins);
        if (role) return next();

        // API request → 401 JSON; trang HTML → redirect login
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized', needLogin: true });
        }
        if (req.path === '/login.html' || req.path === '/api/auth/login') return next();
        res.redirect(302, '/login.html');
    };
}

/**
 * POST /api/auth/login { pin, role? } — set cookie + role admin/viewer.
 */
function loginRoute(getAuthPins) {
    return (req, res) => {
        const submittedPin = ((req.body && req.body.pin) || (req.query && req.query.pin) || '').toString();
        const submittedRole = ((req.body && req.body.role) || (req.query && req.query.role) || '').toString();
        const resolved = resolveRoleFromPins(getAuthPins, submittedRole, submittedPin);
        if (!resolved.authEnabled) {
            return res.status(400).json({ error: 'Auth not configured' });
        }
        if (!resolved.role) {
            return res.status(401).json({ error: 'Invalid PIN', needLogin: true });
        }
        const token = createSession(resolved.role);
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Strict`);
        res.json({ ok: true, role: resolved.role });
    };
}

/**
 * GET /api/auth/me
 */
function meRoute(getAuthPins) {
    return (req, res) => {
        const pins = getAuthPins ? getAuthPins() : { admin: null, viewer: null };
        const authEnabled = !!((pins && pins.admin) || (pins && pins.viewer));
        const role = withRole(req, getAuthPins);
        if (!authEnabled) {
            return res.json({ ok: true, authEnabled: false, role: 'admin' });
        }
        if (!role) {
            return res.status(401).json({ ok: false, authEnabled: true, needLogin: true });
        }
        return res.json({ ok: true, authEnabled: true, role });
    };
}

module.exports = {
    requireAuth,
    requireEditor,
    loginRoute,
    meRoute,
    getRoleFromRequest,
    getCookie,
    isValidSession,
    getRoleFromToken,
    clearSession,
    COOKIE_NAME,
};
