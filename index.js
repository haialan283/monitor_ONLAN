require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const config = require('./config');
const { requireAuth, requireEditor, loginRoute, meRoute, getRoleFromRequest } = require('./middleware/auth');
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

// Fail fast nếu thiếu SECRET_KEY
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
        service: 'alan-monitor',
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
        tournamentCode: config.getTournamentCode() || '',
        heartbeatIntervalMs: tournament.getHeartbeatIntervalMs(),
        certPinSha256: certPin || '',
    });
});

app.post('/api/auth/login', loginRoute(config.getAuthPins));
app.use(requireAuth(config.getAuthPins));
app.get('/api/auth/me', meRoute(config.getAuthPins));

app.get('/api/session/export', requireEditor, (_req, res) => {
    res.json(store.exportSessionSnapshot());
});

app.post('/api/session/import', requireEditor, (req, res) => {
    const ok = store.importSessionSnapshot(req.body);
    if (!ok) return res.status(400).json({ error: 'Invalid session payload' });
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
    console.log('[ALAN] DEPLOY_MODE=LIVE — /api/adb disabled');
}

const dashboardDir = path.join(__dirname, 'dashboard');
const sendDashboard = (file) => (_req, res) => {
    res.type('html');
    res.sendFile(path.join(dashboardDir, file));
};
app.get('/', sendDashboard('monitor.view'));
app.get('/index.html', (_req, res) => res.redirect('/'));
app.get('/login.html', sendDashboard('signin.view'));
app.use('/templates', express.static(path.join(dashboardDir, 'templates')));

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
    (req) => getRoleFromRequest(req, config.getAuthPins),
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
    console.log(`ALAN Server running at http://${HOST}:${PORT} [${deployMode}]`);
});
