const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'tournament.json');

const DEFAULTS = {
    whitelistApps: [
        'com.dts.freefireth',
        'com.dts.freefiremax',
        'com.android.chrome',
        'com.ops.tournamentmonitor',
        'com.sec.android.app.launcher',
        'com.garena.game.fcmobilevn',
    ],
    overlayWhitelistApps: [],
    noisePackages: [
        'com.android.systemui',
        'com.google.android.permissioncontroller',
        'com.asus.launcher',
        'com.android.permissioncontroller',
        'com.coloros.backuprestore',
    ],
    heartbeatIntervalMs: 2000,
    disconnectMs: null,
};

function mergeDefaults(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        whitelistApps: Array.isArray(src.whitelistApps) ? src.whitelistApps.filter(Boolean) : DEFAULTS.whitelistApps,
        overlayWhitelistApps: Array.isArray(src.overlayWhitelistApps)
            ? src.overlayWhitelistApps.filter(Boolean)
            : DEFAULTS.overlayWhitelistApps,
        noisePackages: Array.isArray(src.noisePackages) ? src.noisePackages.filter(Boolean) : DEFAULTS.noisePackages,
        heartbeatIntervalMs:
            typeof src.heartbeatIntervalMs === 'number' && src.heartbeatIntervalMs >= 1000
                ? Math.min(src.heartbeatIntervalMs, 30000)
                : DEFAULTS.heartbeatIntervalMs,
        disconnectMs:
            typeof src.disconnectMs === 'number' && src.disconnectMs >= 3000
                ? Math.min(src.disconnectMs, 120000)
                : null,
    };
}

function loadFromDisk() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULTS, null, 2)}\n`, 'utf8');
            return mergeDefaults(DEFAULTS);
        }
        const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return mergeDefaults(parsed);
    } catch (e) {
        console.warn('[tournament] load failed, using defaults:', e.message);
        return mergeDefaults(DEFAULTS);
    }
}

let cached = loadFromDisk();

function reload() {
    cached = loadFromDisk();
    console.log('[tournament] config reloaded');
    return cached;
}

function getConfig() {
    return cached;
}

function getWhitelistApps() {
    return cached.whitelistApps;
}

function getOverlayWhitelistApps() {
    return cached.overlayWhitelistApps;
}

function getNoisePackages() {
    return cached.noisePackages;
}

function getHeartbeatIntervalMs() {
    return cached.heartbeatIntervalMs;
}

function getTournamentDisconnectMs() {
    return cached.disconnectMs;
}

function saveConfig(partial) {
    const src = partial && typeof partial === 'object' ? partial : {};
    const next = mergeDefaults({ ...cached, ...src });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    cached = next;
    console.log('[tournament] config saved');
    return next;
}

module.exports = {
    reload,
    getConfig,
    saveConfig,
    getWhitelistApps,
    getOverlayWhitelistApps,
    getNoisePackages,
    getHeartbeatIntervalMs,
    getTournamentDisconnectMs,
    CONFIG_PATH,
};
