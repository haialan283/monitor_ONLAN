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
db.defaults({ alerts: [], tableNames: {}, netConfig: { dns: '', port: 0 } }).write();

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
    trimAlertsIfNeeded,
    MAX_ALERTS,
};
