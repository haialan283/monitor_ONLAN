require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const config = require('./config');
const { requireAuth, loginRoute } = require('./middleware/auth');
const { createCrypto } = require('./lib/crypto');
const store = require('./db/store');
const { createBroadcast } = require('./services/broadcast');
const { startNetworkCheck } = require('./services/networkCheck');
const { startDisconnectCheck } = require('./services/disconnectCheck');
const { notifyViolation: discordNotifyViolation, notifyDisconnect: discordNotifyDisconnect, announceToVoiceBot } = require('./services/discordNotify');
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
app.post('/api/auth/login', loginRoute(config.getDashboardPin));
app.use(requireAuth(config.getDashboardPin));

app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'uploads');
const adbPath = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
    : 'adb';
app.use('/api/adb', createAdbRouter(uploadDir, adbPath));

const discordWebhookUrl = config.getDiscordWebhookUrl();
const voiceBotUrl = config.getDiscordVoiceBotUrl();
const voiceBotSecret = config.getDiscordVoiceBotSecret();
const onViolation = (deviceName, app) => {
    discordNotifyViolation(discordWebhookUrl, deviceName, app);
    announceToVoiceBot(voiceBotUrl, voiceBotSecret, 'violation', deviceName, app);
};
attachWsHandler(wss, store, broadcast, decryptPayload, encryptPayload, onViolation);

const networkCheck = startNetworkCheck(store, broadcast);
const onDisconnect = (deviceName) => {
    discordNotifyDisconnect(discordWebhookUrl, deviceName);
    announceToVoiceBot(voiceBotUrl, voiceBotSecret, 'disconnect', deviceName);
};
const disconnectCheck = startDisconnectCheck(store, broadcast, onDisconnect);

const PORT = config.PORT;
const HOST = config.HOST;

server.listen(PORT, HOST, () => {
    console.log(`ALAN Server running at http://${HOST}:${PORT}`);
});
