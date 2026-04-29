require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const config = require('./config');
const { requireAuth, loginRoute, meRoute, getRoleFromRequest } = require('./middleware/auth');
const { createCrypto } = require('./lib/crypto');
const store = require('./db/store');
const { createBroadcast } = require('./services/broadcast');
const { startNetworkCheck } = require('./services/networkCheck');
const { startDisconnectCheck } = require('./services/disconnectCheck');
const { notifyViolation: discordNotifyViolation, notifyDisconnect: discordNotifyDisconnect } = require('./services/discordNotify');
const { createAdbRouter } = require('./routes/adb');
const { attachWsHandler } = require('./ws/handler');

// Fail fast nếu thiếu SECRET_KEY
config.getSecretKey();

const crypto = createCrypto(config.getSecretKey);
const { encryptPayload, decryptPayload } = crypto;

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

const getState = () => ({
    devices: store.devices,
    alerts: store.getAlerts(),
    tableNames: store.getTableNames(),
});

const broadcast = createBroadcast(wss, encryptPayload, getState);

app.use(express.json());
app.post('/api/auth/login', loginRoute(config.getAuthPins));
app.use(requireAuth(config.getAuthPins));
app.get('/api/auth/me', meRoute(config.getAuthPins));

app.get('/api/client-config', (_req, res) => {
    res.json({
        wsSecretKey: config.getSecretKey(),
    });
});

const uploadDir = path.join(__dirname, 'uploads');
// Prefer project-local platform-tools/adb.exe if present (portable host machines).
const localAdb = path.join(__dirname, '..', 'platform-tools', 'adb.exe');
const adbPath = process.env.ADB_PATH
    ? process.env.ADB_PATH
    : require('fs').existsSync(localAdb)
        ? localAdb
        : process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
            : 'adb';
app.use('/api/adb', createAdbRouter(uploadDir, adbPath));

app.use(express.static(path.join(__dirname, 'public')));

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
    networkCheck.runNow
);
const onDisconnect = (deviceName) => {
    discordNotifyDisconnect(discordWebhookUrl, deviceName);
};
const disconnectCheck = startDisconnectCheck(store, broadcast, onDisconnect);

const PORT = config.PORT;
const HOST = config.HOST;

server.listen(PORT, HOST, () => {
    console.log(`ALAN Server running at http://${HOST}:${PORT}`);
});
