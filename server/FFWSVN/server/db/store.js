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
    /** Persist stage map placement across restarts */
    stageState: {}, // deviceId -> { slotId, seatLayout }
    /** One-level backup for quick restore */
    stageStateBackup: null, // { savedAtMs, stageState }
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
    getStageState,
    getStageStateForDevice,
    setDeviceSlot,
    setDeviceSeatLayout,
    backupStageState,
    restoreStageStateBackup,
    trimAlertsIfNeeded,
    MAX_ALERTS,
};
