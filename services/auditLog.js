const db = require('../db/store').db;

const MAX_ENTRIES = 500;

function appendAudit(action, detail, meta) {
    if (!action || typeof action !== 'string') return;
    const entry = {
        at: new Date().toISOString(),
        action,
        detail: detail && typeof detail === 'string' ? detail : '',
        meta: meta && typeof meta === 'object' ? meta : {},
    };
    const list = db.get('auditLog').value();
    const next = Array.isArray(list) ? [...list, entry] : [entry];
    while (next.length > MAX_ENTRIES) next.shift();
    db.set('auditLog', next).write();
}

function getRecent(limit) {
    const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, MAX_ENTRIES) : 50;
    const list = db.get('auditLog').value();
    if (!Array.isArray(list)) return [];
    return list.slice(-n).reverse();
}

module.exports = { appendAudit, getRecent, MAX_ENTRIES };
