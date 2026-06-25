require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const config = require('./config');
const { requireAuth, requireEditor, loginRoute, meRoute, logoutRoute, getRoleFromRequest } = require('./middleware/auth');
const { createCrypto } = require('./lib/crypto');
const store = require('./db/store');
const { createBroadcast } = require('./services/broadcast');
const { startNetworkCheck } = require('./services/networkCheck');
const { startDisconnectCheck } = require('./services/disconnectCheck');
const { notifyViolation: discordNotifyViolation, notifyDisconnect: discordNotifyDisconnect } = require('./services/discordNotify');
const { createAdbRouter } = require('./routes/adb');
const { createAdbConnectService } = require('./services/adbConnect');
const { createAdbQueue } = require('./services/adbQueue');
const { attachWsHandler } = require('./ws/handler');
const tournament = require('./config/tournamentLoader');
const auditLog = require('./services/auditLog');

config.getSecretKey();

const crypto = createCrypto(config.getSecretKey);
const { encryptPayload, decryptPayload } = crypto;

const app = express();
const server = http.createServer(app);

const deployMode = config.getDeployMode();
const adbEnabled = !config.isLiveMode();
let tryAdbConnect = null;

const wss = new WebSocket.Server({ server });

const getState = () => ({
    devices: store.devices,
    alerts: store.getAlerts(),
    tableNames: store.getTableNames(),
});

const broadcast = createBroadcast(wss, encryptPayload, getState);

app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'arena-pulse',
        deployMode,
        adbEnabled,
        uptimeSec: Math.floor(process.uptime()),
    });
});

app.get('/api/client-config', (_req, res) => {
    const certPin = config.getCertPinSha256();
    res.json({
        wsSecretKey: config.getSecretKey(),
        deployMode,
        adbEnabled,
        tournamentRegistration: !!config.getTournamentCode(),
        heartbeatIntervalMs: tournament.getHeartbeatIntervalMs(),
        certPinSha256: certPin || '',
    });
});

app.post('/api/auth/login', loginRoute(config.getAuthUsers));
app.post('/api/auth/logout', logoutRoute());

const publicDir = path.join(__dirname, 'public');
const sendPublic = (file) => (_req, res) => {
    res.type('html');
    res.sendFile(path.join(publicDir, file));
};
app.get('/login.html', sendPublic('login.html'));

app.use(requireAuth(config.getAuthUsers));

app.get('/admin.html', (req, res) => {
    if (req.userRole !== 'admin') {
        return res.status(403).type('html').send(
            '<!DOCTYPE html><html><body style="background:#0b0d12;color:#8b93a7;font-family:Inter,sans-serif;padding:2rem">' +
            '<p>Chỉ tài khoản <b style="color:#3d8bfd">admin</b> mới vào được trang này.</p>' +
            '<p><a href="/" style="color:#22c55e">← Quay lại Dashboard</a></p></body></html>'
        );
    }
    sendPublic('admin.html')(req, res);
});

app.get('/api/auth/me', meRoute(config.getAuthUsers));

app.get('/api/session/export', requireEditor, (_req, res) => {
    res.json(store.exportSessionSnapshot());
});

app.post('/api/session/import', requireEditor, (req, res) => {
    const ok = store.importSessionSnapshot(req.body);
    if (!ok) return res.status(400).json({ error: 'Invalid session payload' });
    auditLog.appendAudit('session_import', 'Khôi phục phiên từ JSON', {});
    broadcast.broadcast({
        type: 'update_all',
        devices: store.devices,
        alerts: store.getAlerts(),
        tableNames: store.getTableNames(),
        netConfig: store.getNetConfig(),
        netConfigRemote: store.getNetConfigRemote(),
        tournamentCode: store.getTournamentCode() || '',
    });
    res.json({ ok: true });
});

app.get('/api/config/tournament', requireEditor, (_req, res) => {
    res.json(tournament.getConfig());
});

app.post('/api/config/tournament/reload', requireEditor, (_req, res) => {
    res.json({ ok: true, config: tournament.reload() });
});

app.get('/api/admin/settings', requireEditor, (_req, res) => {
    res.json({
        tournamentCode: store.getTournamentCode() || '',
        tournament: tournament.getConfig(),
        deployMode,
    });
});

app.put('/api/admin/settings', requireEditor, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let codeChanged = false;

    if (typeof body.tournamentCode === 'string') {
        const prev = store.getTournamentCode() || '';
        const next = store.setTournamentCode(body.tournamentCode);
        codeChanged = prev !== next;
    }

    const tourPatch = {};
    if (Array.isArray(body.whitelistApps)) tourPatch.whitelistApps = body.whitelistApps;
    if (Array.isArray(body.overlayWhitelistApps)) tourPatch.overlayWhitelistApps = body.overlayWhitelistApps;
    if (Array.isArray(body.noisePackages)) tourPatch.noisePackages = body.noisePackages;
    if (typeof body.heartbeatIntervalMs === 'number') tourPatch.heartbeatIntervalMs = body.heartbeatIntervalMs;
    if (body.disconnectMs === null || typeof body.disconnectMs === 'number') {
        tourPatch.disconnectMs = body.disconnectMs;
    }

    const savedTournament = Object.keys(tourPatch).length ? tournament.saveConfig(tourPatch) : tournament.getConfig();

    if (codeChanged) {
        broadcast.broadcast({
            type: 'tournament_code_updated',
            tournamentCode: store.getTournamentCode() || '',
        });
    }

    auditLog.appendAudit('admin_settings', 'Cập nhật mã giải / whitelist / timing', {
        codeChanged,
        whitelistCount: Array.isArray(body.whitelistApps) ? body.whitelistApps.length : undefined,
    });

    res.json({
        ok: true,
        tournamentCode: store.getTournamentCode() || '',
        tournament: savedTournament,
    });
});

app.get('/api/admin/audit', requireEditor, (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    res.json({ ok: true, entries: auditLog.getRecent(limit) });
});

if (adbEnabled) {
    const uploadDir = path.join(__dirname, 'uploads');
    const localAdb = path.join(__dirname, '..', 'platform-tools', 'adb.exe');
    const adbPath = process.env.ADB_PATH
        ? process.env.ADB_PATH
        : require('fs').existsSync(localAdb)
            ? localAdb
            : process.env.LOCALAPPDATA
                ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
                : 'adb';
    const adbQueue = createAdbQueue();
    const adbService = createAdbConnectService(adbPath, adbQueue);
    tryAdbConnect = (ip) => adbService.connectAdbDevice(ip, 5555);
    app.use('/api/adb', createAdbRouter(uploadDir, adbPath, store, adbService, adbQueue));
} else {
    console.log('[ArenaPulse] DEPLOY_MODE=LIVE — /api/adb disabled');
}

app.get('/', sendPublic('index.html'));
app.get('/index.html', (_req, res) => res.redirect('/'));
app.use('/templates', express.static(path.join(publicDir, 'templates')));
app.use(express.static(publicDir));

const discordWebhookUrl = config.getDiscordWebhookUrl();
const onViolation = (deviceName, app) => {
    discordNotifyViolation(discordWebhookUrl, deviceName, app);
};
const networkCheck = startNetworkCheck(store, broadcast);

attachWsHandler(
    wss,
    store,
    broadcast,
    decryptPayload,
    encryptPayload,
    onViolation,
    (req) => getRoleFromRequest(req, config.getAuthUsers),
    networkCheck.runNow,
    tryAdbConnect
);
const onDisconnect = (deviceName) => {
    discordNotifyDisconnect(discordWebhookUrl, deviceName);
};
const disconnectCheck = startDisconnectCheck(store, broadcast, onDisconnect, {
    getDisconnectMs: () => config.getDisconnectMs(),
});

const PORT = config.PORT;
const HOST = config.HOST;

server.listen(PORT, HOST, () => {
    console.log(`ArenaPulse server running at http://${HOST}:${PORT} [${deployMode}]`);
});
