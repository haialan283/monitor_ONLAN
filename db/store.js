const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Runtime data (không nên commit). Tự tạo thư mục nếu thiếu.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'db.json');
const adapter = new FileSync(dbPath);
const db = low(adapter);
db.defaults({
    alerts: [],
    tableNames: {},
    netConfig: { dns: '', port: 0 },
    /** Thứ hai: kiểm tra tới host/port ngoài (Internet, máy chủ đối tác, …) */
    netConfigRemote: { dns: '', port: 0 },
    /** Mã giải — thiết bị app phải nhập đúng (ưu tiên DB, fallback env TOURNAMENT_CODE) */
    tournamentCode: '',
    /** Persist stage map placement across restarts */
    stageState: {}, // deviceId -> { slotId, seatLayout }
    /** One-level backup for quick restore */
    stageStateBackup: null, // { savedAtMs, stageState }
    /** Last known ADB endpoint per device (LAN) */
    adbEndpoints: {}, // deviceId -> { ip, port, updatedAtMs }
}).write();

const devices = [];
let isDbDirty = false;

setInterval(() => {
    if (isDbDirty) {
        db.write();
        isDbDirty = false;
    }
}, 5000);

function markDirty() {
    isDbDirty = true;
}

function getAlerts() {
    return db.get('alerts').value();
}

function updateAlerts(fn) {
    const alerts = getAlerts();
    fn(alerts);
    db.set('alerts', alerts).value();
    markDirty();
}

function setAlerts(arr) {
    db.set('alerts', arr).value();
    markDirty();
}

function getTableNames() {
    return db.get('tableNames').value();
}

function updateTableNames(fn) {
    const names = getTableNames();
    fn(names);
    db.set('tableNames', names).value();
    markDirty();
}

function getNetConfig() {
    return db.get('netConfig').value();
}

function setNetConfig(nc) {
    db.set('netConfig', nc).value();
    markDirty();
}

function getNetConfigRemote() {
    const v = db.get('netConfigRemote').value();
    return v && typeof v === 'object' ? v : { dns: '', port: 0 };
}

function setNetConfigRemote(nc) {
    db.set('netConfigRemote', nc).value();
    markDirty();
}

function getTournamentCode() {
    const v = db.get('tournamentCode').value();
    if (typeof v === 'string' && v.trim()) return v.trim();
    const env = process.env.TOURNAMENT_CODE;
    if (typeof env === 'string' && env.trim()) return env.trim();
    return null;
}

function setTournamentCode(code) {
    const trimmed = (code || '').toString().trim();
    db.set('tournamentCode', trimmed).value();
    markDirty();
    return trimmed;
}

function getAdbEndpoints() {
    return db.get('adbEndpoints').value() || {};
}

function setAdbEndpoint(deviceId, ip, port = 5555) {
    if (!deviceId || !ip) return;
    const host = String(ip).trim();
    if (!host) return;
    const endpoints = getAdbEndpoints();
    endpoints[deviceId] = { ip: host, port: port || 5555, updatedAtMs: Date.now() };
    db.set('adbEndpoints', endpoints).value();
    markDirty();
}

function getStageState() {
    return db.get('stageState').value() || {};
}

function getStageStateForDevice(deviceId) {
    const s = getStageState();
    return s && deviceId ? s[deviceId] : null;
}

function setDeviceSlot(deviceId, slotId) {
    const s = getStageState();
    if (!deviceId) return;
    s[deviceId] = { ...(s[deviceId] || {}), slotId: slotId ?? null };
    db.set('stageState', s).value();
    markDirty();
}

function setDeviceSeatLayout(deviceId, seatLayout) {
    const s = getStageState();
    if (!deviceId) return;
    const prev = s[deviceId] || {};
    const prevSeat = prev.seatLayout && typeof prev.seatLayout === 'object' ? prev.seatLayout : {};
    s[deviceId] = { ...prev, seatLayout: { ...prevSeat, ...(seatLayout || {}) } };
    db.set('stageState', s).value();
    markDirty();
}

function backupStageState() {
    const s = getStageState();
    db.set('stageStateBackup', { savedAtMs: Date.now(), stageState: s }).value();
    markDirty();
}

function restoreStageStateBackup() {
    const b = db.get('stageStateBackup').value();
    if (!b || !b.stageState || typeof b.stageState !== 'object') return false;
    db.set('stageState', b.stageState).value();
    markDirty();
    return true;
}

/** Giới hạn alerts tối đa (trim khi vượt) */
const MAX_ALERTS = 500;

function trimAlertsIfNeeded() {
    const alerts = getAlerts();
    if (alerts.length > MAX_ALERTS) {
        db.set('alerts', alerts.slice(-MAX_ALERTS)).value();
        markDirty();
    }
}

function exportSessionSnapshot() {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        devices: devices.map((d) => ({
            deviceId: d.deviceId,
            deviceName: d.deviceName,
            slotId: d.slotId ?? null,
            seatLayout: d.seatLayout || null,
        })),
        alerts: getAlerts(),
        tableNames: getTableNames(),
        netConfig: getNetConfig(),
        netConfigRemote: getNetConfigRemote(),
        tournamentCode: db.get('tournamentCode').value() || '',
        stageState: getStageState(),
        adbEndpoints: getAdbEndpoints(),
    };
}

function importSessionSnapshot(data) {
    if (!data || typeof data !== 'object') return false;
    if (Array.isArray(data.alerts)) setAlerts(data.alerts);
    if (data.tableNames && typeof data.tableNames === 'object') {
        db.set('tableNames', data.tableNames).value();
    }
    if (data.netConfig && typeof data.netConfig === 'object') setNetConfig(data.netConfig);
    if (data.netConfigRemote && typeof data.netConfigRemote === 'object') setNetConfigRemote(data.netConfigRemote);
    if (typeof data.tournamentCode === 'string') setTournamentCode(data.tournamentCode);
    if (data.adbEndpoints && typeof data.adbEndpoints === 'object') {
        db.set('adbEndpoints', data.adbEndpoints).value();
    }
    const stage = data.stageState && typeof data.stageState === 'object' ? data.stageState : null;
    if (stage) db.set('stageState', stage).value();
    if (Array.isArray(data.devices)) {
        data.devices.forEach((snap) => {
            if (!snap || !snap.deviceId) return;
            const persisted = stage && stage[snap.deviceId] ? stage[snap.deviceId] : null;
            const slotId = snap.slotId ?? persisted?.slotId ?? null;
            const seatLayout = snap.seatLayout || persisted?.seatLayout || { x: 0, y: 0 };
            const idx = devices.findIndex((d) => d.deviceId === snap.deviceId);
            if (idx >= 0) {
                if (snap.deviceName) devices[idx].deviceName = snap.deviceName;
                devices[idx].slotId = slotId;
                devices[idx].seatLayout = { ...(devices[idx].seatLayout || {}), ...seatLayout };
            } else {
                devices.push({
                    deviceId: snap.deviceId,
                    deviceName: snap.deviceName || snap.deviceId,
                    slotId,
                    seatLayout: { x: 0, y: 0, ...seatLayout },
                    status: 'disconnected',
                    battery: 0,
                    isCharging: false,
                    currentApp: '',
                    overlayApp: '',
                    rssi: -100,
                    ipAddress: '',
                    isFtpOpen: false,
                });
            }
        });
    }
    markDirty();
    return true;
}

module.exports = {
    db,
    devices,
    markDirty,
    getAlerts,
    updateAlerts,
    setAlerts,
    getTableNames,
    updateTableNames,
    getNetConfig,
    setNetConfig,
    getNetConfigRemote,
    setNetConfigRemote,
    getTournamentCode,
    setTournamentCode,
    getAdbEndpoints,
    setAdbEndpoint,
    getStageState,
    getStageStateForDevice,
    setDeviceSlot,
    setDeviceSeatLayout,
    backupStageState,
    restoreStageStateBackup,
    trimAlertsIfNeeded,
    exportSessionSnapshot,
    importSessionSnapshot,
    MAX_ALERTS,
};
